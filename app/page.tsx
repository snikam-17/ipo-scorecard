import Link from 'next/link';
import { getEntries } from '@/lib/repo';
import { rate } from '@/lib/scoring';
import { issueType } from '@/lib/metrics';
import { fmtCr, fmtDate, fmtRs, fmtX } from '@/lib/format';
import type { IpoEntry, IpoStatus } from '@/lib/types';
import { Ruler, toneFor } from '@/components/Ruler';
import { SyncNotice } from '@/components/SyncNotice';

export const dynamic = 'force-dynamic';

const GROUPS: Array<{ status: IpoStatus; title: string; blurb: string }> = [
  { status: 'Open', title: 'Open for bidding now', blurb: 'Bidding is live.' },
  { status: 'Upcoming', title: 'Opening soon', blurb: 'Dates are announced; bidding has not started.' },
  { status: 'Closed', title: 'Closed, awaiting listing', blurb: 'Bidding is over; shares are not trading yet.' },
  { status: 'Listed', title: 'Recently listed', blurb: 'Now trading; shown for two weeks.' },
];

function byDate(a: IpoEntry, b: IpoEntry, desc: boolean): number {
  const x = a.listing.openDate ?? '9999-12-31';
  const y = b.listing.openDate ?? '9999-12-31';
  return desc ? y.localeCompare(x) : x.localeCompare(y);
}

export default async function Home() {
  const res = await getEntries();

  return (
    <main className="wrap">
      <h1 className="page-title serif">Live and upcoming IPOs, scored on reported facts</h1>
      <p className="lede">
        Every IPO open for bidding or announced on NSE and BSE appears here, updated automatically. IPOs whose offer
        document has been read also get a 0 to 10 score from filed financials, issue structure and valuation against peers.
        No listing-gain guesses, no grey-market premium.{' '}
        <Link href="/methodology">See exactly how the score is built.</Link>
      </p>

      {res.state === 'not_configured' && (
        <div className="banner" role="alert">
          <strong>Database not connected.</strong> Set <code>DATABASE_URL</code> and run <code>npm run db:init</code> and{' '}
          <code>npm run sync</code> (see the README). Nothing is shown until real data is loaded.
        </div>
      )}
      {res.state === 'error' && (
        <div className="banner" role="alert">
          <strong>The database could not be read.</strong> Please try again shortly. If you run this site, check the server log.
        </div>
      )}

      {res.state === 'ok' && <SyncNotice sync={res.sync} />}

      {res.state === 'ok' && res.entries.length === 0 && (
        <div className="panel">
          <h2 style={{ fontSize: 19, marginBottom: 6 }}>No IPOs are open or announced right now</h2>
          <p className="muted">
            New issues usually appear a week or less before bidding opens, once the price band is announced. This page
            refreshes itself as soon as one does.
          </p>
        </div>
      )}

      {res.state === 'ok' &&
        GROUPS.map((g) => {
          const rows = res.entries
            .filter((e) => e.listing.status === g.status)
            .sort((a, b) => byDate(a, b, g.status === 'Closed' || g.status === 'Listed'));
          if (rows.length === 0) return null;
          return (
            <section key={g.status} style={{ marginBottom: 26 }} aria-labelledby={`h-${g.status}`}>
              <h2 id={`h-${g.status}`} style={{ fontSize: 18, marginBottom: 2 }}>{g.title} <span className="faint" style={{ fontWeight: 400 }}>({rows.length})</span></h2>
              <p className="faint" style={{ fontSize: 13, marginBottom: 10 }}>{g.blurb}</p>
              <div className="board">
                <div className="board-head" aria-hidden="true">
                  <span>Company</span>
                  <span>Bidding window</span>
                  <span>Price band</span>
                  <span>Issue size</span>
                  <span>Issue type</span>
                  <span>Fundamentals score</span>
                </div>
                {rows.map((e) => (
                  <Row key={e.listing.slug} e={e} />
                ))}
              </div>
            </section>
          );
        })}
    </main>
  );
}

function Row({ e }: { e: IpoEntry }) {
  const l = e.listing;
  const rating = e.ipo ? rate(e.ipo) : null;
  const tone = toneFor(rating?.score ?? null);
  const type = e.ipo ? issueType(e.ipo) : null;
  const chip = type === 'Fresh Issue' ? 'fresh' : type === 'Offer for Sale' ? 'ofs' : 'mix';
  const band = l.priceBandHigh > 0 ? `${fmtRs(l.priceBandLow, 0)} - ${fmtRs(l.priceBandHigh, 0)}` : 'Not announced';

  return (
    <Link href={`/ipo/${l.slug}`} className="board-row">
      <div>
        <div className="row-name">{l.name}</div>
        <div className="row-sub">
          {l.sector} · {l.segment} · {l.exchange}
        </div>
      </div>
      <div>
        <span className="cell-label">Bidding window</span>
        {l.openDate ? `${fmtDate(l.openDate)} - ${fmtDate(l.closeDate ?? undefined)}` : 'Dates not announced'}
      </div>
      <div>
        <span className="cell-label">Price band</span>
        {band}
      </div>
      <div>
        <span className="cell-label">Issue size</span>
        {l.issueSizeCr ? fmtCr(l.issueSizeCr) : 'n/a'}
        {l.subscriptionX !== null && l.subscriptionX > 0 && <div className="row-sub">{fmtX(l.subscriptionX, 2)} subscribed</div>}
      </div>
      <div>
        <span className="cell-label">Issue type</span>
        {type ? <span className={`chip ${chip}`}>{type}</span> : <span className="faint">Pending</span>}
      </div>
      <div className="score-cell">
        {rating ? (
          <>
            <span className={`n tone-${tone}`}>{rating.score === null ? 'n/a' : rating.score.toFixed(1)}</span>
            <div>
              <Ruler score={rating.score} size="sm" />
              <div className="row-sub">{rating.band}</div>
            </div>
          </>
        ) : (
          <span className="chip">Rating pending</span>
        )}
      </div>
    </Link>
  );
}
