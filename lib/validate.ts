import type { Ipo, IpoFacts, IpoListing } from './types';

/** Checks a facts file (fundamentals read from the offer document). Empty list = safe to load. */
export function validateFacts(x: unknown): string[] {
  const errs: string[] = [];
  const f = x as Partial<IpoFacts> | null;
  if (!f || typeof f !== 'object') return ['facts file is not an object'];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const req = (cond: boolean, msg: string) => {
    if (!cond) errs.push(msg);
  };

  req(typeof f.slug === 'string' && /^[a-z0-9-]+$/.test(f.slug), 'slug must match the live listing id (lowercase letters, digits, hyphens)');
  req(typeof f.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.asOf), 'asOf must be a YYYY-MM-DD date');
  req(Array.isArray(f.sourceDocs) && f.sourceDocs.length > 0 && f.sourceDocs.every((d) => typeof d.label === 'string' && d.label.length > 0), 'at least one sourceDocs entry with a label is required (facts must be traceable)');
  req(!!f.company && typeof f.company.description === 'string' && f.company.description.length > 0, 'company.description is required');
  req(num(f.company?.founded), 'company.founded must be a year');
  req(Array.isArray(f.company?.history), 'company.history must be an array');
  req(Array.isArray(f.company?.promoters), 'company.promoters must be an array');

  const s = f.issue;
  req(!!s, 'issue block is required');
  if (s) {
    req(num(s.freshIssueCr) && s.freshIssueCr >= 0, 'issue.freshIssueCr must be a number >= 0');
    req(num(s.ofsCr) && s.ofsCr >= 0, 'issue.ofsCr must be a number >= 0');
    req(num(s.freshIssueCr) && num(s.ofsCr) && s.freshIssueCr + s.ofsCr > 0, 'fresh issue + OFS must be > 0');
    req(num(s.ofsFromPromotersPct) && s.ofsFromPromotersPct >= 0 && s.ofsFromPromotersPct <= 100, 'issue.ofsFromPromotersPct must be 0-100');
    req(num(s.sharesPreIssueCr) && s.sharesPreIssueCr > 0, 'issue.sharesPreIssueCr must be > 0 (in crore shares)');
    req(num(s.promoterHoldingPrePct) && s.promoterHoldingPrePct >= 0 && s.promoterHoldingPrePct <= 100, 'issue.promoterHoldingPrePct must be 0-100');
    if (s.quota) {
      const q = s.quota.retail + s.quota.qib + s.quota.nii;
      req(Math.abs(q - 100) < 0.5, `quota sums to ${q}, expected 100`);
    } else errs.push('issue.quota is required');
    if (Array.isArray(s.proceeds) && num(s.freshIssueCr)) {
      const sum = s.proceeds.reduce((t, p) => t + p.amountCr, 0);
      req(Math.abs(sum - s.freshIssueCr) < 0.5, `objects of the issue sum to ${sum}, expected the fresh issue ${s.freshIssueCr}`);
    } else errs.push('issue.proceeds must be an array');
    req(Array.isArray(s.leadManagers), 'issue.leadManagers must be an array');
  }

  req(Array.isArray(f.financials) && f.financials.length >= 1, 'at least one year of financials is required');
  if (Array.isArray(f.financials)) {
    f.financials.forEach((r, i) => {
      req(typeof r.fy === 'string' && r.fy.length > 0, `financials[${i}].fy is required`);
      for (const k of ['revenue', 'ebitda', 'pat', 'netWorth', 'totalDebt', 'cfo'] as const) {
        req(num(r[k]), `financials[${i}].${k} must be a number (use the figure from the RHP; do not estimate)`);
      }
    });
  }
  req(Array.isArray(f.peers), 'peers must be an array');
  return errs;
}

/** Checks a live listing from the feed. Empty list = safe to store. */
export function validateListing(x: unknown): string[] {
  const errs: string[] = [];
  const l = x as Partial<IpoListing> | null;
  if (!l || typeof l !== 'object') return ['listing is not an object'];
  if (!l.slug || !/^[a-z0-9-]+$/.test(l.slug)) errs.push('slug is invalid');
  if (!l.name) errs.push('name is missing');
  if (typeof l.priceBandLow !== 'number' || typeof l.priceBandHigh !== 'number') errs.push('price band must be numbers (0 = not announced)');
  else if (l.priceBandHigh > 0 && l.priceBandLow > l.priceBandHigh) errs.push('price band low is above high');
  return errs;
}

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
