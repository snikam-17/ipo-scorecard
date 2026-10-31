import type { Ipo } from './types';
import { computeMetrics, type Metrics } from './metrics';
import { fmtPct, fmtX } from './format';

/**
 * Fact-based scoring model.
 *
 * Every factor is a deterministic function of reported numbers (RHP / prospectus / filings).
 * There are NO forecasts, no listing-gain estimates, no grey-market premium, no subscription guesses.
 * Each factor maps a reported value to 0-10 using a published piecewise-linear scale (see `rule`).
 * The final score is the weight-averaged score of the factors that have data; `confidence` is the
 * share of total weight that was computable. Missing data never counts as good or bad.
 */
export const MODEL_VERSION = '1.0.0';

export interface Factor {
  key: string;
  label: string;
  group: 'Growth & profitability' | 'Balance sheet & cash' | 'Valuation' | 'Issue structure';
  weight: number; // % of total
  score: number | null; // 0-10, null when not computable
  value: string; // the reported/derived fact shown to the reader
  rule: string; // how the value maps to a score
  note?: string;
}

export interface Rating {
  score: number | null;
  band: string;
  confidence: number; // 0-1
  factors: Factor[];
  modelVersion: string;
  metrics: Metrics;
}

type Point = [x: number, score: number];

/** Piecewise-linear interpolation, clamped at both ends. Points must be sorted by x ascending. */
export function scale(x: number, pts: Point[]): number {
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x0, y0] = pts[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function bandFor(score: number | null): string {
  if (score === null) return 'Insufficient data';
  if (score >= 8) return 'Very strong fundamentals';
  if (score >= 6.5) return 'Strong fundamentals';
  if (score >= 5) return 'Average fundamentals';
  if (score >= 3.5) return 'Weak fundamentals';
  return 'Very weak fundamentals';
}

export function rate(ipo: Ipo): Rating {
  const m = computeMetrics(ipo);
  const f: Factor[] = [];

  // ---- Growth & profitability (46%) ----
  f.push({
    key: 'growth',
    label: 'Revenue growth (CAGR)',
    group: 'Growth & profitability',
    weight: 14,
    score: m.revenueCagr === null ? null : scale(m.revenueCagr, [[-10, 0], [0, 2], [10, 5], [20, 7.5], [30, 10]]),
    value: `${fmtPct(m.revenueCagr)} over ${Math.max(m.yearsReported - 1, 0)} yrs`,
    rule: '≤ -10% = 0 · 0% = 2 · 10% = 5 · 20% = 7.5 · ≥ 30% = 10',
  });
  f.push({
    key: 'margin',
    label: `PAT margin (${m.latestFy})`,
    group: 'Growth & profitability',
    weight: 12,
    score: m.patMargin === null ? null : scale(m.patMargin, [[-5, 0], [0, 2], [5, 5], [10, 7.5], [20, 10]]),
    value: fmtPct(m.patMargin),
    rule: '≤ -5% = 0 · 0% = 2 · 5% = 5 · 10% = 7.5 · ≥ 20% = 10',
  });
  f.push({
    key: 'consistency',
    label: 'Profitable years',
    group: 'Growth & profitability',
    weight: 8,
    score: m.yearsReported === 0 ? null : (m.yearsProfitable / m.yearsReported) * 10,
    value: `${m.yearsProfitable} of ${m.yearsReported} reported years`,
    rule: '(profitable years ÷ reported years) × 10',
  });
  f.push({
    key: 'roe',
    label: `Return on equity (${m.latestFy})`,
    group: 'Growth & profitability',
    weight: 14,
    score: m.roe === null ? null : scale(m.roe, [[0, 0], [8, 3], [15, 6.5], [25, 10]]),
    value: fmtPct(m.roe),
    rule: '≤ 0% = 0 · 8% = 3 · 15% = 6.5 · ≥ 25% = 10',
    note: 'PAT ÷ closing net worth.',
  });

  // ---- Balance sheet & cash (18%) ----
  f.push({
    key: 'leverage',
    label: 'Debt to equity',
    group: 'Balance sheet & cash',
    weight: 10,
    score: m.debtToEquity === null ? null : scale(m.debtToEquity, [[0, 10], [0.5, 8.5], [1, 6.5], [2, 3], [3, 0]]),
    value: fmtX(m.debtToEquity, 2),
    rule: '0x = 10 · 0.5x = 8.5 · 1x = 6.5 · 2x = 3 · ≥ 3x = 0',
    note: 'Total debt ÷ net worth. Not comparable across lenders and non-lenders.',
  });
  f.push({
    key: 'cash',
    label: 'Cash conversion (CFO ÷ PAT)',
    group: 'Balance sheet & cash',
    weight: 8,
    score: m.cfoToPat === null ? null : scale(m.cfoToPat, [[0, 0], [0.5, 4], [0.8, 7], [1, 9], [1.2, 10]]),
    value: m.cfoToPat === null ? 'n/a (no positive PAT)' : fmtX(m.cfoToPat, 2),
    rule: '≤ 0x = 0 · 0.5x = 4 · 0.8x = 7 · 1x = 9 · ≥ 1.2x = 10',
    note: 'Scored only when PAT is positive.',
  });

  // ---- Valuation (14%): upper price band vs peer medians ----
  const peRatio = m.pe !== null && m.peerMedianPe ? m.pe / m.peerMedianPe : null;
  f.push({
    key: 'pe',
    label: 'P/E vs peer median',
    group: 'Valuation',
    weight: 10,
    score:
      m.pe === null
        ? 0
        : peRatio === null
          ? null
          : scale(peRatio, [[0.6, 10], [1, 7], [1.5, 4], [2.5, 0]]),
    value:
      m.pe === null
        ? 'P/E not meaningful (loss-making)'
        : `${fmtX(m.pe)} vs peers ${fmtX(m.peerMedianPe)}`,
    rule: 'P/E ÷ peer median: ≤ 0.6 = 10 · 1.0 = 7 · 1.5 = 4 · ≥ 2.5 = 0. Loss-making = 0.',
    note: 'At the upper price band, on pre-issue share count and latest FY EPS.',
  });
  const pbRatio = m.pb !== null && m.peerMedianPb ? m.pb / m.peerMedianPb : null;
  f.push({
    key: 'pb',
    label: 'P/B vs peer median',
    group: 'Valuation',
    weight: 4,
    score: pbRatio === null ? null : scale(pbRatio, [[0.6, 10], [1, 7], [1.5, 4], [2.5, 0]]),
    value: m.pb === null ? 'n/a' : `${fmtX(m.pb)} vs peers ${fmtX(m.peerMedianPb)}`,
    rule: 'P/B ÷ peer median: ≤ 0.6 = 10 · 1.0 = 7 · 1.5 = 4 · ≥ 2.5 = 0',
  });

  // ---- Issue structure (22%) ----
  f.push({
    key: 'fresh',
    label: 'Fresh issue share of the offer',
    group: 'Issue structure',
    weight: 8,
    score: m.freshSharePct === null ? null : scale(m.freshSharePct, [[0, 0], [25, 3], [50, 6], [75, 8.5], [100, 10]]),
    value: `${fmtPct(m.freshSharePct, 0)} fresh · ${fmtPct(m.ofsSharePct, 0)} offer for sale`,
    rule: '0% fresh = 0 · 25% = 3 · 50% = 6 · 75% = 8.5 · 100% = 10',
    note: 'Fresh issue money goes to the company; offer-for-sale money goes to the selling shareholders.',
  });
  f.push({
    key: 'proceeds',
    label: 'Fresh issue funding growth',
    group: 'Issue structure',
    weight: 6,
    score: m.growthProceedsPct === null ? null : (m.growthProceedsPct / 100) * 10,
    value: m.growthProceedsPct === null ? 'n/a (no fresh issue)' : `${fmtPct(m.growthProceedsPct, 0)} to capex / growth`,
    rule: '(growth & capex share of fresh issue) × 10',
    note: 'Debt repayment and general corporate purposes are not counted as growth.',
  });
  f.push({
    key: 'promoter',
    label: 'Promoter holding after the issue',
    group: 'Issue structure',
    weight: 6,
    score: scale(m.promoterPostPct, [[20, 0], [40, 4], [55, 7], [70, 10]]),
    value: `${fmtPct(m.promoterPrePct, 1)} → ${fmtPct(m.promoterPostPct, 1)}`,
    rule: '≤ 20% = 0 · 40% = 4 · 55% = 7 · ≥ 70% = 10',
  });

  const available = f.filter((x) => x.score !== null);
  const availWeight = available.reduce((s, x) => s + x.weight, 0);
  const totalWeight = f.reduce((s, x) => s + x.weight, 0);
  const score =
    availWeight > 0 ? r1(available.reduce((s, x) => s + x.weight * (x.score as number), 0) / availWeight) : null;

  return {
    score,
    band: bandFor(score),
    confidence: totalWeight > 0 ? availWeight / totalWeight : 0,
    factors: f.map((x) => ({ ...x, score: x.score === null ? null : r1(x.score) })),
    modelVersion: MODEL_VERSION,
    metrics: m,
  };
}
