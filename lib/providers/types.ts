import type { IpoListing } from '../types';

export interface SyncResult {
  listings: IpoListing[];
  /** Non-fatal problems (e.g. one IPO's detail call failed and only list data was used). */
  warnings: string[];
}

/** A listing provider turns an external issue feed into canonical IpoListing records. */
export interface ListingProvider {
  name: string;
  fetchListings(): Promise<SyncResult>;
}
