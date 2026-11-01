import type { Exchange, IpoListing, IpoStatus } from '../types';
import type { ListingProvider, SyncResult } from './types';

/**
 * Listing provider backed by the Upstox Developer API (https://upstox.com/developer/api-documentation/get-ipos).
 *
 * Why this and not the NSE/BSE websites directly: neither exchange publishes an official public API for IPO
 * listings. Their website endpoints are unofficial, need browser-style cookie handshakes and commonly refuse
 * requests from cloud servers. Upstox is a SEBI-registered broker whose API returns the IPOs open for bidding on
 * NSE and BSE (mainboard and SME), with a documented, stable contract.
 *
 * Auth: Bearer access token in UPSTOX_ACCESS_TOKEN. Tokens from Upstox may expire; see README.
 * Fields used (all documented): id, name, symbol, isin, industry, status, issue_type, issue_size, minimum_price,
 * maximum_price, bidding_start_date, bidding_end_date, total_subscription, face_value, lot_size, listing_price,
 * listing_exchange, rhp_url, drhp_url, timeline.*, registrar_info.name.
 */

const DEFAULT_BASE = 'https://api.upstox.com/v2';
const PAGE_SIZE = 30; // documented maximum
const RECENT_CLOSED_DAYS = 14;

/* ---------- raw feed shapes (only the fields we read) ---------- */

interface RawListItem {
  id?: string;
  name?: string;
  symbol?: string | null;
  isin?: string | null;
  industry?: string | null;
  status?: string;
  issue_type?: string;
  issue_size?: number | string | null;
  minimum_price?: number | string | null;
  maximum_price?: number | string | null;
  bidding_start_date?: string | null;
  bidding_end_date?: string | null;
  total_subscription?: string | number | null;
}

interface RawDetail extends RawListItem {
  face_value?: number | string | null;
  lot_size?: number | string | null;
  listing_price?: number | string | null;
  listing_exchange?: string | null;
  rhp_url?: string | null;
  drhp_url?: string | null;
  timeline?: {
    allotment_date?: string | null;
    listing_date?: string | null;
    application_start_date?: string | null;
    application_end_date?: string | null;
  } | null;
  registrar_info?: { name?: string | null } | null;
}

interface ListResponse {
  status: string;
  data?: RawListItem[];
  meta_data?: { page?: { page_number?: number; total_pages?: number } };
}

interface DetailResponse {
  status: string;
  data?: RawDetail;
}

/* ---------- pure mapping helpers (unit-tested in scripts/provider-check.ts) ---------- */

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

export function mapStatus(s: string | undefined): IpoStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'open':
      return 'Open';
    case 'upcoming':
      return 'Upcoming';
    case 'closed':
      return 'Closed';
    case 'listed':
      return 'Listed';
    default:
      throw new Error(`unknown IPO status "${s}"`);
  }
}

export function mapExchange(s: string | null | undefined): Exchange {
  const t = (s ?? '').toUpperCase();
  const nse = t.includes('NSE');
  const bse = t.includes('BSE');
  if (nse && bse) return 'NSE + BSE';
  if (nse) return 'NSE';
  if (bse) return 'BSE';
  return 'Not stated';
}

/** Build a canonical listing from list-item fields, enriched by detail fields when we have them. */
export function mapListing(item: RawListItem, detail: RawDetail | null, syncedAt: string): IpoListing {
  const d: RawDetail = { ...item, ...(detail ?? {}) };
  const id = d.id ?? '';
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`unusable IPO id "${id}"`);
  if (!d.name) throw new Error(`IPO ${id} has no name`);

  return {
    slug: id,
    name: d.name,
    symbol: d.symbol ?? null,
    isin: d.isin ?? null,
    sector: d.industry?.trim() || 'Not stated',
    segment: (d.issue_type ?? '').toLowerCase() === 'sme' ? 'SME' : 'Mainboard',
    exchange: mapExchange(d.listing_exchange),
    status: mapStatus(d.status),
    openDate: isoDate(d.bidding_start_date) ?? isoDate(d.timeline?.application_start_date),
    closeDate: isoDate(d.bidding_end_date) ?? isoDate(d.timeline?.application_end_date),
    allotmentDate: isoDate(d.timeline?.allotment_date),
    listingDate: isoDate(d.timeline?.listing_date),
    priceBandLow: num(d.minimum_price) ?? 0,
    priceBandHigh: num(d.maximum_price) ?? 0,
    faceValue: num(d.face_value),
    lotSize: num(d.lot_size),
    issueSizeCr: num(d.issue_size),
    subscriptionX: num(d.total_subscription),
    listingPrice: num(d.listing_price),
    registrarName: d.registrar_info?.name ?? null,
    rhpUrl: d.rhp_url ?? null,
    drhpUrl: d.drhp_url ?? null,
    syncedAt,
  };
}

/** A closed IPO is worth showing only until it has been listed for a while. */
export function isRecent(closeDate: string | null, now: Date, days = RECENT_CLOSED_DAYS): boolean {
  if (!closeDate) return true;
  const t = Date.parse(`${closeDate}T00:00:00Z`);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t <= days * 86_400_000;
}

/* ---------- HTTP ---------- */

export class UpstoxProvider implements ListingProvider {
  name = 'upstox';
  private base: string;
  private token: string;

  constructor(opts?: { baseUrl?: string; token?: string }) {
    this.base = (opts?.baseUrl ?? process.env.UPSTOX_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
    this.token = opts?.token ?? process.env.UPSTOX_ACCESS_TOKEN ?? '';
  }

  private async get<T>(path: string, attempt = 0): Promise<T> {
    if (!this.token) {
      throw new Error('UPSTOX_ACCESS_TOKEN is not set. See README, "Live data".');
    }
    const res = await fetch(`${this.base}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
    });

    if (res.status === 429 && attempt < 4) {
      const wait = 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
      return this.get<T>(path, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Upstox rejected the access token (HTTP ${res.status}). The token is probably expired: generate a new one and update UPSTOX_ACCESS_TOKEN.`,
      );
    }
    if (!res.ok) throw new Error(`Upstox ${path} responded HTTP ${res.status} ${res.statusText}`);

    const body = (await res.json()) as T & { status?: string };
    if (body.status && body.status !== 'success') throw new Error(`Upstox ${path} returned status "${body.status}"`);
    return body;
  }

  private async listAll(status: 'open' | 'upcoming' | 'closed', maxPages: number): Promise<RawListItem[]> {
    const out: RawListItem[] = [];
    let page = 1;
    let total = 1;
    while (page <= total && page <= maxPages) {
      const r = await this.get<ListResponse>(`/ipos?status=${status}&page_number=${page}&records=${PAGE_SIZE}`);
      out.push(...(r.data ?? []));
      total = r.meta_data?.page?.total_pages ?? page;
      page++;
    }
    return out;
  }

  async fetchListings(now = new Date()): Promise<SyncResult> {
    const syncedAt = now.toISOString();
    const warnings: string[] = [];

    const [open, upcoming, closed] = await Promise.all([
      this.listAll('open', 10),
      this.listAll('upcoming', 10),
      this.listAll('closed', 20),
    ]);

    const items = [...open, ...upcoming, ...closed.filter((c) => isRecent(isoDate(c.bidding_end_date), now))];
    const seen = new Set<string>();
    const unique = items.filter((i) => i.id && !seen.has(i.id) && seen.add(i.id));

    const listings: IpoListing[] = [];
    const queue = [...unique];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        let detail: RawDetail | null = null;
        try {
          detail = (await this.get<DetailResponse>(`/ipos/${encodeURIComponent(item.id as string)}`)).data ?? null;
        } catch (e) {
          // Auth problems affect every call, so stop instead of silently degrading all records.
          if (e instanceof Error && /token/i.test(e.message)) throw e;
          warnings.push(`${item.id}: detail call failed (${(e as Error).message}); using list data only`);
        }
        try {
          listings.push(mapListing(item, detail, syncedAt));
        } catch (e) {
          warnings.push(`${item.id}: skipped (${(e as Error).message})`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    return { listings, warnings };
  }
}
