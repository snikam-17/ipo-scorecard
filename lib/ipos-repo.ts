import type { Pool } from 'pg';

/**
 * Reads the `ipos` table that /api/cron/sync-ipos fills. Never falls back to made-up data: when the database is
 * missing or unreachable the result says so and the page shows that state.
 */

export type IpoStatus = 'UPCOMING' | 'OPEN' | 'CLOSED';
export type RepoState = 'ok' | 'not_configured' | 'error';

export interface IpoResearch {
  laymanSummary: string | null;
  businessModel: string | null;
  revenueGrowth: string | null;
  patMargin: string | null;
  debtEquity: string | null;
  roeRoce: string | null;
  pros: string[];
  cons: string[];
  peerComparison: string | null;
  dataGaps: string[];
  sources: Array<{ title: string; url: string }>;
  /** true = the AI could search the web; false = it only saw the IPO listing data. */
  grounded: boolean;
  model: string | null;
  generatedAt: string | null;
}

export interface IpoRecord {
  symbol: string;
  name: string;
  exchange: string | null;
  category: 'MAINBOARD' | 'SME';
  /** Status as stored by the last sync. */
  storedStatus: IpoStatus;
  /** Status worked out from today's date (Indian time), so a finished IPO moves to Closed between syncs. */
  status: IpoStatus;
  priceBand: string | null;
  priceBandHigh: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  gmpAmount: number | null;
  subscriptionX: number | null;
  rating: number | null;
  verdict: string | null;
  research: IpoResearch | null;
  researchedAt: string | null;
  updatedAt: string;
  about: string | null;
  prospectusUrl: string | null;
}

export interface ListResult {
  state: RepoState;
  ipos: IpoRecord[];
  lastUpdatedAt: string | null;
}

const RECENT_CLOSED = 3;

let pool: Pool | null = null;

async function getPool(): Promise<Pool | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool: PgPool } = await import('pg');
    pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

const SELECT_SQL = `
  select symbol, company_name, exchange, category, status, price_band, lot_size, issue_size_crores,
         to_char(open_date, 'YYYY-MM-DD')      as open_date,
         to_char(close_date, 'YYYY-MM-DD')     as close_date,
         to_char(allotment_date, 'YYYY-MM-DD') as allotment_date,
         to_char(listing_date, 'YYYY-MM-DD')   as listing_date,
         gmp_amount, subscription_rate, ai_research, ai_rating, ai_verdict, ai_researched_at, updated_at,
         raw_data ->> 'about' as about, raw_data ->> 'prospectusUrl' as prospectus_url
  from ipos`;

/* ---------- parsing helpers (the AI payload is untrusted JSON, so every field is checked) ---------- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const iso = (v: unknown): string | null => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);

function parseResearch(raw: unknown): IpoResearch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fh = (r.financial_highlights && typeof r.financial_highlights === 'object' ? r.financial_highlights : {}) as Record<string, unknown>;
  const sources = Array.isArray(r.sources)
    ? (r.sources as Array<Record<string, unknown>>)
        .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url as string))
        .map((s) => ({ title: str(s.title) ?? (s.url as string), url: s.url as string }))
    : [];
  return {
    laymanSummary: str(r.layman_summary),
    businessModel: str(r.business_model),
    revenueGrowth: str(fh.revenue_growth),
    patMargin: str(fh.pat_margin),
    debtEquity: str(fh.debt_equity),
    roeRoce: str(fh.roe_roce),
    pros: strs(r.pros_strengths),
    cons: strs(r.cons_risks),
    peerComparison: str(r.peer_comparison),
    dataGaps: strs(r.data_gaps),
    sources,
    grounded: r.grounded === true,
    model: str(r.model),
    generatedAt: str(r.generated_at),
  };
}

/** "₹78 - ₹82" -> 82 */
function upperBand(priceBand: string | null): number | null {
  if (!priceBand) return null;
  const nums = priceBand.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function effectiveStatus(
  stored: IpoStatus,
  openDate: string | null,
  closeDate: string | null,
  today = todayIST(),
): IpoStatus {
  if (stored === 'CLOSED') return 'CLOSED';
  if (closeDate && closeDate < today) return 'CLOSED';
  if (stored === 'UPCOMING' && openDate && openDate <= today) return 'OPEN';
  return stored;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecord(r: any, today: string): IpoRecord {
  const stored = (r.status as IpoStatus) ?? 'UPCOMING';
  return {
    symbol: r.symbol,
    name: r.company_name,
    exchange: str(r.exchange),
    category: r.category === 'SME' ? 'SME' : 'MAINBOARD',
    storedStatus: stored,
    status: effectiveStatus(stored, r.open_date ?? null, r.close_date ?? null, today),
    priceBand: str(r.price_band),
    priceBandHigh: upperBand(r.price_band ?? null),
    lotSize: num(r.lot_size),
    issueSizeCr: num(r.issue_size_crores),
    openDate: r.open_date ?? null,
    closeDate: r.close_date ?? null,
    allotmentDate: r.allotment_date ?? null,
    listingDate: r.listing_date ?? null,
    gmpAmount: num(r.gmp_amount),
    subscriptionX: num(r.subscription_rate),
    rating: num(r.ai_rating),
    verdict: str(r.ai_verdict),
    research: parseResearch(r.ai_research),
    researchedAt: iso(r.ai_researched_at),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
    about: str(r.about),
    prospectusUrl: str(r.prospectus_url),
  };
}

/** Open and upcoming IPOs, plus the most recent closed ones. */
export async function getIpoList(): Promise<ListResult> {
  const p = await getPool();
  if (!p) return { state: 'not_configured', ipos: [], lastUpdatedAt: null };
  try {
    const { rows } = await p.query(SELECT_SQL);
    const today = todayIST();
    const all = rows.map((r) => toRecord(r, today));

    const open = all.filter((i) => i.status === 'OPEN').sort((a, b) => (a.closeDate ?? '9999').localeCompare(b.closeDate ?? '9999'));
    const upcoming = all.filter((i) => i.status === 'UPCOMING').sort((a, b) => (a.openDate ?? '9999').localeCompare(b.openDate ?? '9999'));
    const closed = all
      .filter((i) => i.status === 'CLOSED')
      .sort((a, b) => (b.closeDate ?? '').localeCompare(a.closeDate ?? ''))
      .slice(0, RECENT_CLOSED);

    const lastUpdatedAt = all.reduce<string | null>((m, i) => (m === null || i.updatedAt > m ? i.updatedAt : m), null);
    return { state: 'ok', ipos: [...open, ...upcoming, ...closed], lastUpdatedAt };
  } catch (err) {
    console.error('[ipos-repo] database read failed:', err);
    return { state: 'error', ipos: [], lastUpdatedAt: null };
  }
}

export async function getIpo(symbol: string): Promise<{ state: RepoState; ipo: IpoRecord | null }> {
  const p = await getPool();
  if (!p) return { state: 'not_configured', ipo: null };
  try {
    const { rows } = await p.query(`${SELECT_SQL} where upper(symbol) = upper($1)`, [symbol]);
    return { state: 'ok', ipo: rows.length ? toRecord(rows[0], todayIST()) : null };
  } catch (err) {
    console.error('[ipos-repo] database read failed:', err);
    return { state: 'error', ipo: null };
  }
}
