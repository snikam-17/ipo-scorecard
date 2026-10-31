import type { Ipo } from './types';

/** Returns a list of problems. Empty list = record is safe to store and score. */
export function validateIpo(x: unknown): string[] {
  const errs: string[] = [];
  const i = x as Partial<Ipo> | null;
  if (!i || typeof i !== 'object') return ['record is not an object'];

  const req = (cond: boolean, msg: string) => {
    if (!cond) errs.push(msg);
  };
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

  req(typeof i.slug === 'string' && /^[a-z0-9-]+$/.test(i.slug), 'slug must be lowercase letters, digits and hyphens');
  req(typeof i.name === 'string' && i.name.length > 0, 'name is required');
  req(typeof i.sector === 'string', 'sector is required');
  req(!!i.company && typeof i.company.description === 'string', 'company.description is required');
  req(Array.isArray(i.company?.history), 'company.history must be an array');

  const s = i.issue;
  req(!!s, 'issue block is required');
  if (s) {
    req(num(s.priceBandLow) && num(s.priceBandHigh), 'price band is required');
    req(num(s.priceBandLow) && num(s.priceBandHigh) && s.priceBandLow <= s.priceBandHigh, 'price band low must be <= high');
    req(num(s.lotSize) && s.lotSize > 0, 'lot size must be > 0');
    req(num(s.freshIssueCr) && num(s.ofsCr) && s.freshIssueCr + s.ofsCr > 0, 'fresh issue + OFS must be > 0');
    req(num(s.sharesPreIssueCr) && s.sharesPreIssueCr > 0, 'sharesPreIssueCr must be > 0');
    req(num(s.promoterHoldingPrePct) && s.promoterHoldingPrePct >= 0 && s.promoterHoldingPrePct <= 100, 'promoter holding must be 0-100');
    if (num(s.freshIssueCr) && Array.isArray(s.proceeds)) {
      const sum = s.proceeds.reduce((t, p) => t + p.amountCr, 0);
      req(Math.abs(sum - s.freshIssueCr) < 0.5, `objects of the issue sum to ${sum}, expected fresh issue ${s.freshIssueCr}`);
    }
    if (s.quota) {
      const q = s.quota.retail + s.quota.qib + s.quota.nii;
      req(Math.abs(q - 100) < 0.5, `investor quotas sum to ${q}, expected 100`);
    }
  }

  req(Array.isArray(i.financials) && i.financials.length >= 1, 'at least one year of financials is required');
  if (Array.isArray(i.financials)) {
    i.financials.forEach((f, idx) => {
      for (const k of ['revenue', 'ebitda', 'pat', 'netWorth', 'totalDebt', 'cfo'] as const) {
        req(num(f[k]), `financials[${idx}].${k} must be a number`);
      }
    });
  }
  req(Array.isArray(i.peers), 'peers must be an array');
  return errs;
}
