import Link from 'next/link';
import { getIpoList, type IpoRecord, type IpoStatus } from '@/lib/ipos-repo';
import { fmtCr, fmtDate, fmtNum, fmtX } from '@/lib/format';
import { Ruler, toneFor } from '@/components/Ruler';
import { SyncNotice } from '@/components/SyncNotice';

export const dynamic = 'force-dynamic';

const GROUPS: Array<{ status: IpoStatus; title: string; blurb: string }> = [
  { status: 'OPEN', title: 'Open for bidding now', blurb: 'Bidding is live.' },
  { status: 'UPCOMING', title: 'Opening soon', blurb: 'Announced; bidding has not started.' },
  { status: 'CLOSED', title: 'Recently closed', blurb: 'Bidding is over. The three most recent are shown.' },
];

export default async function Home() {
  const res = await getIpoList();

  return (
    <main className="wrap">
      <h1 className="page-title serif">Live and upcoming IPOs in India</h1>
      <p className="lede">
        IPOs open for bidding or announced on NSE and BSE, updated automatically once a day. Each one has a plain-language
        summary written by AI. A 1 to 10 rating appears only when an IPO&apos;s financials have actually been researched;
        otherwise it says &ldquo;Rating pending&rdquo;. Nothing here is investment advice.{' '}
        <Link href="/methodology">How this works.</Link>
      </p>

      {res.state === 'not_configured' && (
        <div className="banner" role="alert">
          <strong>Database not connected.</strong> Set <code>DATABASE_URL</code> on the server (see the README). Nothing is
          shown until real data is loaded.
        </div>
      )}
      {res.state === 'error' && (
        <div className="banner" role="alert">
          <strong>The database could not be read.</strong> Please try again shortly. If you run this site, check the server
          log and that the <code>ipos</code> table exists.
        </div>
      )}

      {res.state === 'ok' && <SyncNotice lastUpdatedAt={res.lastUpdatedAt} />}

      {res.state === 'ok' && res.ipos.length === 0 && (
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
          const rows = res.ipos.filter((i) => i.status === g.status);
          if (rows.length === 0) return null;
          return (
            <section key={g.status} style={{ marginBottom: 26 }} aria-labelledby={`h-${g.status}`}>
              <h2 id={`h-${g.status}`} style={{ fontSize: 18, marginBottom: 2 }}>
                {g.title} <span className="faint" style={{ fontWeight: 400 }}>({rows.length})</span>
              </h2>
              <p className="faint" style={{ fontSize: 13, marginBottom: 10 }}>{g.blurb}</p>
              <div className="board">
                <div className="board-head" aria-hidden="true">
                  <span>Company</span>
                  <span>Bidding window</span>
                  <span>Price band</span>
                  <span>Issue size</span>
                  <span>Lot size</span>
                  <span>AI rating</span>
                </div>
                {rows.map((i) => (
                  <Row key={i.symbol} i={i} />
                ))}
              </div>
            </section>
          );
        })}
    </main>
  );
}

function Row({ i }: { i: IpoRecord }) {
  const tone = toneFor(i.rating);
  return (
    <Link href={`/ipo/${encodeURIComponent(i.symbol)}`} className="board-row">
      <div>
        <div className="row-name">{i.name}</div>
        <div className="row-sub">
          {i.symbol} · {i.category === 'SME' ? 'SME' : 'Mainboard'}
          {i.exchange ? ` · ${i.exchange}` : ''}
        </div>
      </div>
      <div>
        <span className="cell-label">Bidding window</span>
        {i.openDate ? `${fmtDate(i.openDate)} - ${fmtDate(i.closeDate ?? undefined)}` : 'Dates not announced'}
      </div>
      <div>
        <span className="cell-label">Price band</span>
        {i.priceBand ?? 'Not announced'}
      </div>
      <div>
        <span className="cell-label">Issue size</span>
        {i.issueSizeCr ? fmtCr(i.issueSizeCr) : 'n/a'}
        {i.subscriptionX !== null && i.subscriptionX > 0 && <div className="row-sub">{fmtX(i.subscriptionX, 2)} subscribed</div>}
      </div>
      <div>
        <span className="cell-label">Lot size</span>
        {i.lotSize ? `${fmtNum(i.lotSize)} shares` : 'n/a'}
      </div>
      <div className="score-cell">
        {i.rating !== null ? (
          <>
            <span className={`n tone-${tone}`}>{i.rating.toFixed(1)}</span>
            <div>
              <Ruler score={i.rating} size="sm" />
              <div className="row-sub">{i.verdict ?? 'AI-generated'}</div>
            </div>
          </>
        ) : (
          <span className="chip">Rating pending</span>
        )}
      </div>
    </Link>
  );
}
