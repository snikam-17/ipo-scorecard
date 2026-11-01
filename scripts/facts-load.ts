import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { validateFacts } from '../lib/validate';
import { snapshotScores, upsertFacts } from '../lib/db-write';
import type { IpoFacts } from '../lib/types';

/**
 * npm run facts:load
 * Loads data/facts/<slug>.json (files starting with "_" are templates and skipped).
 * Each file holds fundamentals copied from the RHP for one IPO. See data/facts/_template.json and the README.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const dir = process.env.FACTS_DIR ?? join(process.cwd(), 'data', 'facts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  if (files.length === 0) {
    console.log('No facts files found in data/facts. Copy _template.json to <listing-id>.json and fill it from the RHP.');
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  let loaded = 0;
  let rejected = 0;
  try {
    for (const file of files) {
      let facts: IpoFacts;
      try {
        facts = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      } catch (e) {
        rejected++;
        console.warn(`REJECTED ${file}: not valid JSON (${(e as Error).message})`);
        continue;
      }
      const errs = validateFacts(facts);
      if (facts.slug && file !== `${facts.slug}.json`) errs.push(`file name must be ${facts.slug}.json`);
      if (errs.length) {
        rejected++;
        console.warn(`REJECTED ${file}:\n  - ${errs.join('\n  - ')}`);
        continue;
      }
      await upsertFacts(client, facts);
      loaded++;
    }
    const snapshots = await snapshotScores(client);
    console.log(`Loaded ${loaded} facts file(s), rejected ${rejected}. New score snapshots: ${snapshots}.`);
    if (rejected > 0) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
