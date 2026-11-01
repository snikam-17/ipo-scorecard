import { Client } from 'pg';
import { getProvider } from '../lib/providers';
import { validateListing } from '../lib/validate';
import { pruneUnseen, recordSyncRun, snapshotScores, upsertListings } from '../lib/db-write';

/**
 * npm run sync
 * Pulls live and upcoming IPOs from the listing provider, validates, upserts, prunes withdrawn issues,
 * re-scores, and records the run so the site can show "last updated" and you can see failures.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    let listings;
    let warnings: string[] = [];
    try {
      const res = await getProvider().fetchListings();
      listings = res.listings;
      warnings = res.warnings;
    } catch (e) {
      const message = (e as Error).message;
      await recordSyncRun(client, { ok: false, listings: 0, warnings: [], error: message });
      throw e;
    }

    const valid = [];
    for (const l of listings) {
      const errs = validateListing(l);
      if (errs.length) warnings.push(`${l.slug ?? '(no id)'}: rejected (${errs.join('; ')})`);
      else valid.push(l);
    }

    await upsertListings(client, valid);

    let pruned = 0;
    if (valid.length > 0 && warnings.length === 0) {
      pruned = await pruneUnseen(client, valid.map((l) => l.slug));
    } else if (warnings.length > 0) {
      warnings.push('Withdrawn-issue cleanup skipped because this run had warnings.');
    }

    const snapshots = await snapshotScores(client);
    await recordSyncRun(client, { ok: true, listings: valid.length, warnings });

    console.log(`Synced ${valid.length} IPO(s). Pruned ${pruned}. New score snapshots: ${snapshots}.`);
    for (const w of warnings) console.warn(`  warning: ${w}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`Sync failed: ${(e as Error).message}`);
  process.exit(1);
});
