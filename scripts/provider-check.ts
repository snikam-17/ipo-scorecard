/**
 * Checks the listing provider and the listing + facts merge WITHOUT any network or database:
 * the HTTP layer is exercised against a local mock server that serves the response shapes documented at
 * https://upstox.com/developer/api-documentation/get-ipos and .../get-ipo-details.
 */
import http from 'node:http';
import { UpstoxProvider, isRecent, mapExchange, mapListing } from '../lib/providers/upstox';
import { buildEntry } from '../lib/merge';
import { validateFacts, validateListing } from '../lib/validate';
import type { IpoFacts, IpoListing } from '../lib/types';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

/* ---------- mapping ---------- */
check('exchange: both', mapExchange('NSE,BSE') === 'NSE + BSE');
check('exchange: BSE only', mapExchange('BSE') === 'BSE');
check('exchange: missing -> Not stated', mapExchange(null) === 'Not stated');
check('recent: closed yesterday', isRecent('2026-10-30', new Date('2026-10-31T00:00:00Z')));
check('recent: closed 30 days ago is hidden', !isRecent('2026-09-30', new Date('2026-10-31T00:00:00Z')));

const NOW = '2026-10-31T08:00:00.000Z';
const notAnnounced = mapListing(
  { id: 'acme-limited-ipo', name: 'Acme Ltd', status: 'upcoming', issue_type: 'regular', minimum_price: 0, maximum_price: 0 },
  null,
  NOW,
);
check('price band 0 stays 0 (not announced)', notAnnounced.priceBandHigh === 0 && validateListing(notAnnounced).length === 0);

let threw = false;
try {
  mapListing({ id: 'Bad Id!', name: 'x', status: 'open' }, null, NOW);
} catch {
  threw = true;
}
check('rejects unusable id', threw);

/* ---------- merge ---------- */
const listing: IpoListing = {
  ...notAnnounced,
  slug: 'acme-limited-ipo',
  priceBandLow: 90,
  priceBandHigh: 95,
  lotSize: 150,
  faceValue: 10,
  issueSizeCr: 500,
  openDate: '2026-11-05',
  closeDate: '2026-11-09',
  status: 'Upcoming',
};
const facts: IpoFacts = {
  slug: 'acme-limited-ipo',
  asOf: '2026-10-30',
  sourceDocs: [{ label: 'Acme Ltd RHP, filed 30 Oct 2026' }],
  company: { founded: 2001, headquarters: 'Pune', description: 'Test company', promoters: ['A'], history: [{ year: 2001, event: 'Founded' }] },
  issue: {
    freshIssueCr: 300,
    ofsCr: 200,
    ofsFromPromotersPct: 100,
    sharesPreIssueCr: 10,
    promoterHoldingPrePct: 80,
    quota: { retail: 35, qib: 50, nii: 15 },
    proceeds: [{ purpose: 'Capex', category: 'growth', amountCr: 300 }],
    leadManagers: ['LM'],
  },
  financials: [
    { fy: 'FY25', revenue: 400, ebitda: 60, pat: 30, netWorth: 200, totalDebt: 100, cfo: 35 },
    { fy: 'FY26', revenue: 520, ebitda: 80, pat: 44, netWorth: 250, totalDebt: 100, cfo: 50 },
  ],
  peers: [{ name: 'P1', pe: 20, pb: 3, roe: 15, patMargin: 8 }],
};

check('facts validate', validateFacts(facts).length === 0, validateFacts(facts).join('; '));
check('facts without a source are rejected', validateFacts({ ...facts, sourceDocs: [] }).length > 0);
check('quota not summing to 100 is rejected', validateFacts({ ...facts, issue: { ...facts.issue, quota: { retail: 10, qib: 10, nii: 10 } } }).length > 0);

check('no facts -> pending, no score', buildEntry(listing, null).ipo === null && !!buildEntry(listing, null).pendingReason);
check('price band not announced -> pending', buildEntry({ ...listing, priceBandHigh: 0, priceBandLow: 0 }, facts).ipo === null);
const mismatch = buildEntry({ ...listing, issueSizeCr: 650 }, facts);
check('issue size mismatch (500 vs 650) -> needs review, no score', mismatch.ipo === null && /Needs review/.test(mismatch.pendingReason ?? ''));
const ok = buildEntry(listing, facts);
check('complete data -> rated record', ok.ipo !== null && ok.pendingReason === null);
check('price band comes from the live listing', ok.ipo?.issue.priceBandHigh === 95 && ok.ipo?.issue.lotSize === 150);

/* ---------- HTTP layer against a mock feed ---------- */
const LIST_OPEN = { status: 'success', data: [{ id: 'open-co-ipo', name: 'Open Co', status: 'open', issue_type: 'regular', industry: 'Steel', issue_size: 183, minimum_price: 78, maximum_price: 82, bidding_start_date: '2026-10-29', bidding_end_date: '2026-11-02', total_subscription: '2.81' }], meta_data: { page: { page_number: 1, total_pages: 1 } } };
const LIST_UPCOMING = { status: 'success', data: [{ id: 'soon-co-ipo', name: 'Soon Co', status: 'upcoming', issue_type: 'sme', minimum_price: 0, maximum_price: 0 }], meta_data: { page: { page_number: 1, total_pages: 1 } } };
const LIST_CLOSED = {
  status: 'success',
  data: [
    { id: 'old-co-ipo', name: 'Old Co', status: 'closed', issue_type: 'regular', bidding_end_date: '2026-08-01' },
    { id: 'recent-co-ipo', name: 'Recent Co', status: 'closed', issue_type: 'regular', bidding_end_date: '2026-10-28' },
  ],
  meta_data: { page: { page_number: 1, total_pages: 1 } },
};
const DETAILS: Record<string, unknown> = {
  'open-co-ipo': { status: 'success', data: { id: 'open-co-ipo', name: 'Open Co', status: 'open', issue_type: 'regular', industry: 'Steel', issue_size: 183, minimum_price: 78, maximum_price: 82, face_value: 10, lot_size: 182, listing_exchange: 'NSE,BSE', bidding_start_date: '2026-10-29', bidding_end_date: '2026-11-02', total_subscription: '2.81', rhp_url: 'https://example.com/rhp.pdf', timeline: { allotment_date: '2026-11-03', listing_date: '2026-11-05' }, registrar_info: { name: 'Kfin Technologies' } } },
  'recent-co-ipo': { status: 'success', data: { id: 'recent-co-ipo', name: 'Recent Co', status: 'closed', issue_type: 'regular', listing_exchange: 'NSE', bidding_end_date: '2026-10-28' } },
};

const requests: string[] = [];
const server = http.createServer((req, res) => {
  requests.push(`${req.url} auth=${req.headers.authorization}`);
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Bearer test-token') return send(401, { status: 'error' });
  if (url.pathname === '/v2/ipos') {
    const s = url.searchParams.get('status');
    return send(200, s === 'open' ? LIST_OPEN : s === 'upcoming' ? LIST_UPCOMING : LIST_CLOSED);
  }
  const id = url.pathname.replace('/v2/ipos/', '');
  if (id === 'soon-co-ipo') return send(500, { status: 'error' }); // one detail call fails
  return DETAILS[id] ? send(200, DETAILS[id]) : send(404, { status: 'error' });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/v2`;

  const good = await new UpstoxProvider({ baseUrl: base, token: 'test-token' }).fetchListings(new Date('2026-10-31T08:00:00Z'));
  const slugs = good.listings.map((l) => l.slug).sort();
  check('fetches open + upcoming + recent closed only', JSON.stringify(slugs) === JSON.stringify(['open-co-ipo', 'recent-co-ipo', 'soon-co-ipo']), slugs.join(','));
  const open = good.listings.find((l) => l.slug === 'open-co-ipo');
  check('detail fields merged (lot size, exchange, registrar, RHP, dates)', open?.lotSize === 182 && open?.exchange === 'NSE + BSE' && open?.registrarName === 'Kfin Technologies' && open?.rhpUrl === 'https://example.com/rhp.pdf' && open?.allotmentDate === '2026-11-03');
  check('subscription parsed from string', open?.subscriptionX === 2.81);
  const soon = good.listings.find((l) => l.slug === 'soon-co-ipo');
  check('failed detail call degrades to list data with a warning', !!soon && soon.segment === 'SME' && good.warnings.some((w) => w.startsWith('soon-co-ipo')));
  check('sends bearer token', requests.every((r) => r.endsWith('auth=Bearer test-token')));

  let msg = '';
  try {
    await new UpstoxProvider({ baseUrl: base, token: 'wrong' }).fetchListings();
  } catch (e) {
    msg = (e as Error).message;
  }
  check('bad token gives a clear, actionable error', /token/i.test(msg) && /expired|UPSTOX_ACCESS_TOKEN/.test(msg), msg);

  let msg2 = '';
  try {
    await new UpstoxProvider({ baseUrl: base, token: '' }).fetchListings();
  } catch (e) {
    msg2 = (e as Error).message;
  }
  check('missing token gives a clear error', /UPSTOX_ACCESS_TOKEN is not set/.test(msg2));

  server.close();
  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main();
