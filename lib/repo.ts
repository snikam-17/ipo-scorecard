import type { Pool } from 'pg';
import type { Ipo } from './types';
import { SEED_IPOS } from './data/seed';

export type Source = 'database' | 'seed';

let pool: Pool | null = null;

async function getPool(): Promise<Pool | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool: PgPool } = await import('pg');
    pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

export async function getAllIpos(): Promise<{ ipos: Ipo[]; source: Source }> {
  const p = await getPool();
  if (!p) return { ipos: SEED_IPOS, source: 'seed' };
  try {
    const { rows } = await p.query('select payload from ipos order by open_date asc nulls last');
    if (rows.length === 0) return { ipos: SEED_IPOS, source: 'seed' };
    return { ipos: rows.map((r) => r.payload as Ipo), source: 'database' };
  } catch (err) {
    // Surface the failure in logs; the UI still shows the demo banner because these records are flagged 'demo'.
    console.error('[repo] database read failed, falling back to demo seed:', err);
    return { ipos: SEED_IPOS, source: 'seed' };
  }
}

export async function getIpoBySlug(slug: string): Promise<Ipo | null> {
  const p = await getPool();
  if (!p) return SEED_IPOS.find((i) => i.slug === slug) ?? null;
  try {
    const { rows } = await p.query('select payload from ipos where slug = $1', [slug]);
    if (rows.length) return rows[0].payload as Ipo;
    return SEED_IPOS.find((i) => i.slug === slug) ?? null;
  } catch (err) {
    console.error('[repo] database read failed, falling back to demo seed:', err);
    return SEED_IPOS.find((i) => i.slug === slug) ?? null;
  }
}
