import type { Pool } from 'pg';
import type { IpoEntry, IpoFacts, IpoListing } from './types';
import { buildEntry, isCurrent } from './merge';

export type RepoState = 'ok' | 'not_configured' | 'error';

export interface SyncInfo {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastRunError: string | null;
  lastSuccessAt: string | null;
}

export interface RepoResult {
  state: RepoState;
  error?: string;
  entries: IpoEntry[];
  sync: SyncInfo | null;
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool: PgPool } = await import('pg');
    pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

async function readSync(p: Pool): Promise<SyncInfo> {
  const last = await p.query('select ran_at, ok, error from sync_runs order by ran_at desc limit 1');
  const good = await p.query('select ran_at from sync_runs where ok order by ran_at desc limit 1');
  return {
    lastRunAt: last.rows[0] ? new Date(last.rows[0].ran_at).toISOString() : null,
    lastRunOk: last.rows[0] ? last.rows[0].ok : null,
    lastRunError: last.rows[0]?.error ?? null,
    lastSuccessAt: good.rows[0] ? new Date(good.rows[0].ran_at).toISOString() : null,
  };
}

const ENTRY_SQL = `select l.payload as listing, f.payload as facts
                   from ipo_listings l left join ipo_facts f on f.slug = l.slug`;

/**
 * All IPOs worth showing. Never falls back to made-up data: when the database is missing or unreachable the
 * result says so and the page shows that state instead.
 */
export async function getEntries(): Promise<RepoResult> {
  const p = await getPool();
  if (!p) return { state: 'not_configured', entries: [], sync: null };
  try {
    const { rows } = await p.query(ENTRY_SQL);
    const now = new Date();
    const entries = rows
      .map((r) => buildEntry(r.listing as IpoListing, (r.facts as IpoFacts | null) ?? null))
      .filter((e) => isCurrent(e.listing, now));
    return { state: 'ok', entries, sync: await readSync(p) };
  } catch (err) {
    console.error('[repo] database read failed:', err);
    return { state: 'error', error: (err as Error).message, entries: [], sync: null };
  }
}

export async function getEntry(slug: string): Promise<{ state: RepoState; entry: IpoEntry | null; sync: SyncInfo | null }> {
  const p = await getPool();
  if (!p) return { state: 'not_configured', entry: null, sync: null };
  try {
    const { rows } = await p.query(`${ENTRY_SQL} where l.slug = $1`, [slug]);
    if (!rows.length) return { state: 'ok', entry: null, sync: await readSync(p) };
    const entry = buildEntry(rows[0].listing as IpoListing, (rows[0].facts as IpoFacts | null) ?? null);
    return { state: 'ok', entry, sync: await readSync(p) };
  } catch (err) {
    console.error('[repo] database read failed:', err);
    return { state: 'error', entry: null, sync: null };
  }
}
