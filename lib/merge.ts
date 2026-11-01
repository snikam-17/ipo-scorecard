import type { Ipo, IpoEntry, IpoFacts, IpoListing } from './types';
import { validateIpo } from './validate';

/** Largest gap allowed between the facts file's issue size and the live feed's issue size. */
const ISSUE_SIZE_TOLERANCE = 0.02;

/**
 * Combine a live listing with the fundamentals file into an entry the pages can render.
 * Live fields (price band, lot size, dates, issue size, status) always come from the listing.
 * When the data cannot support an honest rating, `ipo` is null and `pendingReason` says why.
 * The site never guesses a value to fill a gap.
 */
export function buildEntry(listing: IpoListing, facts: IpoFacts | null): IpoEntry {
  const pending = (reason: string): IpoEntry => ({ listing, facts, ipo: null, pendingReason: reason });

  if (!facts) return pending('Fundamentals from the offer document are not loaded yet, so there is no score.');
  if (listing.priceBandHigh <= 0) return pending('The price band is not announced yet. Valuation needs it, so there is no score yet.');
  if (!listing.lotSize || listing.lotSize <= 0) return pending('The lot size is not published yet, so there is no score yet.');
  if (!listing.openDate || !listing.closeDate) return pending('Bidding dates are not announced yet, so there is no score yet.');

  const factsIssue = facts.issue.freshIssueCr + facts.issue.ofsCr;
  if (listing.issueSizeCr && Math.abs(factsIssue - listing.issueSizeCr) / listing.issueSizeCr > ISSUE_SIZE_TOLERANCE) {
    return pending(
      `Needs review: the loaded facts add up to ₹${Math.round(factsIssue)} Cr but the live feed reports an issue size of ₹${Math.round(
        listing.issueSizeCr,
      )} Cr. The RHP may have changed. Update the facts file to restore the score.`,
    );
  }

  const sourceDocs = [...facts.sourceDocs];
  if (listing.rhpUrl) sourceDocs.push({ label: 'Red Herring Prospectus (link from the live feed)', url: listing.rhpUrl });
  else if (listing.drhpUrl) sourceDocs.push({ label: 'Draft Red Herring Prospectus (link from the live feed)', url: listing.drhpUrl });

  const ipo: Ipo = {
    slug: listing.slug,
    name: listing.name,
    sector: listing.sector,
    exchange: listing.exchange,
    segment: listing.segment,
    status: listing.status,
    dataSource: 'api',
    sourceDocs,
    updatedAt: listing.syncedAt.slice(0, 10),
    company: facts.company,
    issue: {
      openDate: listing.openDate,
      closeDate: listing.closeDate,
      allotmentDate: listing.allotmentDate ?? undefined,
      listingDate: listing.listingDate ?? undefined,
      priceBandLow: listing.priceBandLow,
      priceBandHigh: listing.priceBandHigh,
      faceValue: listing.faceValue ?? 0,
      lotSize: listing.lotSize,
      freshIssueCr: facts.issue.freshIssueCr,
      ofsCr: facts.issue.ofsCr,
      ofsFromPromotersPct: facts.issue.ofsFromPromotersPct,
      sharesPreIssueCr: facts.issue.sharesPreIssueCr,
      promoterHoldingPrePct: facts.issue.promoterHoldingPrePct,
      quota: facts.issue.quota,
      proceeds: facts.issue.proceeds,
      leadManagers: facts.issue.leadManagers,
      registrar: listing.registrarName ?? 'Not stated',
    },
    financials: facts.financials,
    peers: facts.peers,
  };

  const errors = validateIpo(ipo);
  if (errors.length) return pending(`The loaded facts are incomplete: ${errors.join('; ')}.`);

  return { listing, facts, ipo, pendingReason: null };
}

/** Is this entry still worth showing? Old closed/listed IPOs drop off the home page. */
export function isCurrent(listing: IpoListing, now = new Date(), days = 14): boolean {
  if (listing.status === 'Open' || listing.status === 'Upcoming') return true;
  const ref = listing.listingDate ?? listing.closeDate;
  if (!ref) return true;
  const t = Date.parse(`${ref}T00:00:00Z`);
  return Number.isNaN(t) || now.getTime() - t <= days * 86_400_000;
}
