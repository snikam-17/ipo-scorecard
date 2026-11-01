import type { Client } from 'pg';
import type { IpoFacts, IpoListing } from './types';
import { buildEntry } from './merge';
import { rate } from './scoring';

/** Insert or update live listings. */
export async function upsertListings(client: Client, listings: IpoListing[]): Promise<void> {
  for (const l of listings) {
    await client.query(
      `insert into ipo_listings (slug, name, segment, status, open_date, close_date, payload, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (slug) do update set
         name = excluded.name, segment = excluded.segment, status = excluded.status,
         open_date = excluded.open_date, close_date = excluded.close_date,
         payload = excluded.payload, synced_at = now()`,
      [l.slug, l.name, l.segment, l.status, l.openDate, l.closeDate, JSON.stringify(l)],
    );
  }
}

/**
 * Remove Upcoming/Open listings that the feed no longer returns (withdrawn or postponed issues).
 * Only called after a clean, non-empty sync, so a feed glitch cannot wipe the site.
 */
export async function pruneUnseen(client: Client, seenSlugs: string[]): Promise<number> {
  const res = await client.query(
    `delete from ipo_listings where status in ('Open','Upcoming') and not (slug = any($1::text[]))`,
    [seenSlugs],
  );
  return res.rowCount ?? 0;
}

export async function upsertFacts(client: Client, facts: IpoFacts): Promise<void> {
  await client.query(
    `insert into ipo_facts (slug, payload, as_of, loaded_at) values ($1,$2,$3, now())
     on conflict (slug) do update set payload = excluded.payload, as_of = excluded.as_of, loaded_at = now()`,
    [facts.slug, JSON.stringify(facts), facts.asOf],
  );
}

export async function recordSyncRun(
  client: Client,
  run: { ok: boolean; listings: number; warnings: string[]; error?: string },
): Promise<void> {
  await client.query(`insert into sync_runs (ok, listings, warnings, error) values ($1,$2,$3,$4)`, [
    run.ok,
    run.listings,
    JSON.stringify(run.warnings),
    run.error ?? null,
  ]);
}

/** Score every rated IPO and store a snapshot when the score, confidence or model version changed. Returns count stored. */
export async function snapshotScores(client: Client): Promise<number> {
  const { rows } = await client.query(
    `select l.payload as listing, f.payload as facts from ipo_listings l left join ipo_facts f on f.slug = l.slug`,
  );
  let stored = 0;
  for (const r of rows) {
    const entry = buildEntry(r.listing, r.facts ?? null);
    if (!entry.ipo) continue;
    const rating = rate(entry.ipo);
    const last = await client.query(
      `select model_ver, score, confidence from ipo_score_snapshots where slug = $1 order by scored_at desc limit 1`,
      [entry.ipo.slug],
    );
    const prev = last.rows[0];
    const same =
      prev &&
      prev.model_ver === rating.modelVersion &&
      Number(prev.score) === rating.score &&
      Math.abs(Number(prev.confidence) - rating.confidence) < 0.005;
    if (same) continue;
    await client.query(
      `insert into ipo_score_snapshots (slug, model_ver, score, confidence, factors) values ($1,$2,$3,$4,$5)`,
      [entry.ipo.slug, rating.modelVersion, rating.score, rating.confidence, JSON.stringify(rating.factors)],
    );
    stored++;
  }
  return stored;
}
