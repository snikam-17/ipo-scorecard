import { Client } from 'pg';
import { SEED_IPOS } from '../lib/data/seed';
import { getProvider } from '../lib/providers';
import { rate } from '../lib/scoring';
import { validateIpo } from '../lib/validate';
import type { Ipo } from '../lib/types';

/**
 * Usage:
 *   npm run ingest         -> pull from the configured IPO API, validate, upsert, snapshot scores
 *   npm run ingest:seed    -> load the fictional demo records (for local testing only)
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const useSeed = process.argv.includes('--seed');
  const records: Ipo[] = useSeed ? SEED_IPOS : await getProvider().fetchUpcoming();
  console.log(`Fetched ${records.length} record(s) from ${useSeed ? 'demo seed' : 'IPO API'}.`);

  const client = new Client({ connectionString: url });
  await client.connect();

  let stored = 0;
  let rejected = 0;
  try {
    for (const ipo of records) {
      const errors = validateIpo(ipo);
      if (errors.length) {
        rejected++;
        console.warn(`REJECTED ${ipo?.slug ?? '(no slug)'}:\n  - ${errors.join('\n  - ')}`);
        continue;
      }

      await client.query(
        `insert into ipos (slug, name, sector, segment, status, open_date, close_date, data_source, source_url, payload, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         on conflict (slug) do update set
           name = excluded.name, sector = excluded.sector, segment = excluded.segment, status = excluded.status,
           open_date = excluded.open_date, close_date = excluded.close_date, data_source = excluded.data_source,
           source_url = excluded.source_url, payload = excluded.payload, updated_at = now()`,
        [
          ipo.slug,
          ipo.name,
          ipo.sector,
          ipo.segment,
          ipo.status,
          ipo.issue.openDate,
          ipo.issue.closeDate,
          ipo.dataSource,
          ipo.sourceDocs[0]?.url ?? null,
          JSON.stringify(ipo),
        ],
      );

      const rating = rate(ipo);
      await client.query(
        `insert into ipo_score_snapshots (slug, model_ver, score, confidence, factors) values ($1,$2,$3,$4,$5)`,
        [ipo.slug, rating.modelVersion, rating.score, rating.confidence, JSON.stringify(rating.factors)],
      );
      stored++;
    }
  } finally {
    await client.end();
  }

  console.log(`Done. Stored ${stored}, rejected ${rejected}.`);
  if (rejected > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
