/**
 * Canonical IPO record.
 * Units: money in ₹ crore, per-share values in ₹, share counts in crore, percentages as 0-100.
 * Everything here is a reported fact (from the RHP/prospectus or exchange filings).
 * Nothing in this type is a forecast.
 */

export type IssueType = 'Fresh Issue' | 'Offer for Sale' | 'Fresh Issue + OFS';
export type IpoStatus = 'Upcoming' | 'Open' | 'Closed' | 'Listed';
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

export interface Ipo {
  slug: string;
  name: string;
  sector: string;
  exchange: 'NSE' | 'BSE' | 'NSE + BSE';
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
