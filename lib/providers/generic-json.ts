import type { Ipo } from '../types';
import type { IpoProvider } from './types';

/**
 * Generic JSON-over-HTTP provider.
 *
 * Configure with IPO_API_URL / IPO_API_KEY (see .env.example).
 * Vendors all use different field names, so the one function you MUST adapt to your vendor is
 * `normalize()` below: map the vendor's payload to the canonical `Ipo` type in lib/types.ts.
 * Records that fail lib/validate.ts are rejected by the ingest script, never stored half-filled.
 */
export class GenericJsonProvider implements IpoProvider {
  name = 'generic-json';

  async fetchUpcoming(): Promise<Ipo[]> {
    const url = process.env.IPO_API_URL;
    if (!url) throw new Error('IPO_API_URL is not set. Add it to .env (see .env.example).');

    const headers: Record<string, string> = { Accept: 'application/json' };
    const key = process.env.IPO_API_KEY;
    if (key) {
      const header = process.env.IPO_API_KEY_HEADER || 'Authorization';
      headers[header] = header.toLowerCase() === 'authorization' ? `Bearer ${key}` : key;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`IPO API responded ${res.status} ${res.statusText}`);

    const body: unknown = await res.json();
    const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : null;
    if (!rows) throw new Error('IPO API response must be an array or { data: [...] }');

    return rows.map((row) => this.normalize(row));
  }

  /**
   * ADAPT THIS to your vendor. Default: assumes the API already returns the canonical shape and
   * only stamps provenance. Example of a mapped field:
   *
   *   issue: { ...,  priceBandHigh: Number(raw.max_price), lotSize: Number(raw.lot_size) }
   */
  protected normalize(raw: unknown): Ipo {
    const r = raw as Ipo;
    return {
      ...r,
      dataSource: 'api',
      updatedAt: new Date().toISOString().slice(0, 10),
    };
  }
}
