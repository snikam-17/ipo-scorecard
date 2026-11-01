/**
 * Canonical IPO record.
 * Units: money in ₹ crore, per-share values in ₹, share counts in crore, percentages as 0-100.
 * Everything here is a reported fact (from the RHP/prospectus or exchange filings).
 * Nothing in this type is a forecast.
 */

export type IssueType = 'Fresh Issue' | 'Offer for Sale' | 'Fresh Issue + OFS';
export type IpoStatus = 'Upcoming' | 'Open' | 'Closed' | 'Listed';
export type Exchange = 'NSE' | 'BSE' | 'NSE + BSE' | 'Not stated';
export type DataSource = 'api' | 'manual' | 'demo';
export type ProceedsCategory = 'growth' | 'debt' | 'general' | 'other';

export interface FinancialYear {
  fy: string; // e.g. "FY26"
  revenue: number;
  ebitda: number;
  pat: number;
  netWorth: number;
  totalDebt: number;
  cfo: number; // cash flow from operations
}

export interface HistoryEvent {
  year: number;
  event: string;
}

export interface ProceedsItem {
  purpose: string;
  category: ProceedsCategory;
  amountCr: number;
}

export interface Peer {
  name: string;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  patMargin: number | null;
}

export interface SourceDoc {
  label: string;
  url?: string;
}

/**
 * Live listing data, synced automatically from the exchange-issue feed (see lib/providers/upstox.ts).
 * Contains only what the feed reports: no financials. Never edited by hand.
 */
export interface IpoListing {
  slug: string;
  name: string;
  symbol: string | null;
  isin: string | null;
  sector: string;
  segment: 'Mainboard' | 'SME';
  exchange: Exchange;
  status: IpoStatus;
  openDate: string | null; // YYYY-MM-DD
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  priceBandLow: number; // 0 = not announced yet
  priceBandHigh: number;
  faceValue: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  subscriptionX: number | null; // overall subscription multiple, e.g. 3.2 = 3.2x
  listingPrice: number | null;
  registrarName: string | null;
  rhpUrl: string | null;
  drhpUrl: string | null;
  syncedAt: string; // ISO timestamp of the sync that produced this record
}

/**
 * Fundamentals entered from the offer document (RHP). Not available from any exchange feed.
 * Loaded from data/facts/<slug>.json with `npm run facts:load`.
 * Price band, lot size, dates and issue size always come from the live listing, never from here.
 */
export interface IpoFacts {
  slug: string;
  company: Ipo['company'];
  issue: {
    freshIssueCr: number;
    ofsCr: number;
    ofsFromPromotersPct: number;
    sharesPreIssueCr: number;
    promoterHoldingPrePct: number;
    quota: { retail: number; qib: number; nii: number };
    proceeds: ProceedsItem[];
    leadManagers: string[];
  };
  financials: FinancialYear[];
  peers: Peer[];
  sourceDocs: SourceDoc[];
  asOf: string; // date the facts were read from the offer document
}

/** What a page renders: the live listing, plus fundamentals and a rating-ready record when available. */
export interface IpoEntry {
  listing: IpoListing;
  facts: IpoFacts | null;
  /** Full record (listing + facts) ready for scoring. Null when it cannot be rated; see `pendingReason`. */
  ipo: Ipo | null;
  pendingReason: string | null;
}

export interface Ipo {
  slug: string;
  name: string;
  sector: string;
  exchange: Exchange;
  segment: 'Mainboard' | 'SME';
  status: IpoStatus;
  dataSource: DataSource;
  sourceDocs: SourceDoc[];
  updatedAt: string; // ISO date

  company: {
    founded: number;
    headquarters: string;
    description: string;
    promoters: string[];
    history: HistoryEvent[];
  };

  issue: {
    openDate: string; // YYYY-MM-DD
    closeDate: string;
    allotmentDate?: string;
    listingDate?: string;
    priceBandLow: number;
    priceBandHigh: number;
    faceValue: number;
    lotSize: number;
    freshIssueCr: number;
    ofsCr: number;
    ofsFromPromotersPct: number; // share of the OFS sold by promoters (rest: other selling shareholders)
    sharesPreIssueCr: number;
    promoterHoldingPrePct: number;
    quota: { retail: number; qib: number; nii: number };
    proceeds: ProceedsItem[]; // objects of the fresh issue; must sum to freshIssueCr
    leadManagers: string[];
    registrar: string;
  };

  financials: FinancialYear[]; // oldest -> newest
  peers: Peer[];
}
