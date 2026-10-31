import type { Ipo } from './types';

export interface Metrics {
  upperPrice: number;
  totalIssueCr: number;
  freshSharePct: number;
  ofsSharePct: number;
  minInvestment: number;
  freshSharesCr: number;
  sharesPostCr: number;
  marketCapCr: number;
  latestFy: string;
  eps: number; // on pre-issue shares
  bvps: number; // on pre-issue shares
  pe: number | null;
  pb: number | null;
  roe: number | null;
  patMargin: number | null;
  ebitdaMargin: number | null;
  revenueCagr: number | null;
  debtToEquity: number | null;
  cfoToPat: number | null;
  yearsProfitable: number;
  yearsReported: number;
  promoterPrePct: number;
  promoterPostPct: number;
  publicPrePct: number;
  publicPostPct: number;
  growthProceedsPct: number | null; // share of fresh issue earmarked for growth/capex
  debtProceedsPct: number | null;
  peerMedianPe: number | null;
  peerMedianPb: number | null;
}

export function median(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function computeMetrics(ipo: Ipo): Metrics {
  const { issue, financials, peers } = ipo;
  const upperPrice = issue.priceBandHigh;
  const totalIssueCr = issue.freshIssueCr + issue.ofsCr;
  const freshSharePct = totalIssueCr > 0 ? (issue.freshIssueCr / totalIssueCr) * 100 : 0;
  const ofsSharePct = totalIssueCr > 0 ? (issue.ofsCr / totalIssueCr) * 100 : 0;
  const freshSharesCr = upperPrice > 0 ? issue.freshIssueCr / upperPrice : 0;
  const sharesPostCr = issue.sharesPreIssueCr + freshSharesCr;
  const marketCapCr = upperPrice * sharesPostCr;

  const last = financials[financials.length - 1];
  const first = financials[0];
  const pre = issue.sharesPreIssueCr;

  const eps = last && pre > 0 ? last.pat / pre : 0;
  const bvps = last && pre > 0 ? last.netWorth / pre : 0;

  const revenueCagr =
    financials.length >= 2 && first.revenue > 0 && last.revenue > 0
      ? (Math.pow(last.revenue / first.revenue, 1 / (financials.length - 1)) - 1) * 100
      : null;

  // Promoter holding: promoters sell their share of the OFS; fresh shares dilute everyone.
  const promoterSharesPre = (issue.promoterHoldingPrePct / 100) * pre;
  const ofsShares = upperPrice > 0 ? issue.ofsCr / upperPrice : 0;
  const promoterSold = ofsShares * (issue.ofsFromPromotersPct / 100);
  const promoterPostShares = Math.max(promoterSharesPre - promoterSold, 0);
  const promoterPostPct = sharesPostCr > 0 ? (promoterPostShares / sharesPostCr) * 100 : 0;

  const growthAmt = issue.proceeds.filter((p) => p.category === 'growth').reduce((s, p) => s + p.amountCr, 0);
  const debtAmt = issue.proceeds.filter((p) => p.category === 'debt').reduce((s, p) => s + p.amountCr, 0);

  return {
    upperPrice,
    totalIssueCr,
    freshSharePct,
    ofsSharePct,
    minInvestment: upperPrice * issue.lotSize,
    freshSharesCr,
    sharesPostCr,
    marketCapCr,
    latestFy: last?.fy ?? 'n/a',
    eps,
    bvps,
    pe: eps > 0 ? upperPrice / eps : null,
    pb: bvps > 0 ? upperPrice / bvps : null,
    roe: last && last.netWorth > 0 ? (last.pat / last.netWorth) * 100 : null,
    patMargin: last && last.revenue > 0 ? (last.pat / last.revenue) * 100 : null,
    ebitdaMargin: last && last.revenue > 0 ? (last.ebitda / last.revenue) * 100 : null,
    revenueCagr,
    debtToEquity: last && last.netWorth > 0 ? last.totalDebt / last.netWorth : null,
    cfoToPat: last && last.pat > 0 ? last.cfo / last.pat : null,
    yearsProfitable: financials.filter((f) => f.pat > 0).length,
    yearsReported: financials.length,
    promoterPrePct: issue.promoterHoldingPrePct,
    promoterPostPct,
    publicPrePct: 100 - issue.promoterHoldingPrePct,
    publicPostPct: 100 - promoterPostPct,
    growthProceedsPct: issue.freshIssueCr > 0 ? (growthAmt / issue.freshIssueCr) * 100 : null,
    debtProceedsPct: issue.freshIssueCr > 0 ? (debtAmt / issue.freshIssueCr) * 100 : null,
    peerMedianPe: median(peers.map((p) => p.pe)),
    peerMedianPb: median(peers.map((p) => p.pb)),
  };
}

export function issueType(ipo: Ipo): 'Fresh Issue' | 'Offer for Sale' | 'Fresh Issue + OFS' {
  const { freshIssueCr, ofsCr } = ipo.issue;
  if (freshIssueCr > 0 && ofsCr > 0) return 'Fresh Issue + OFS';
  return ofsCr > 0 ? 'Offer for Sale' : 'Fresh Issue';
}
