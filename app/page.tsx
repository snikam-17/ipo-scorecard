import Link from 'next/link';
import { getAllIpos } from '@/lib/repo';
import { rate } from '@/lib/scoring';
import { issueType } from '@/lib/metrics';
import { fmtCr, fmtDate, fmtRs } from '@/lib/format';
import { Ruler, toneFor } from '@/components/Ruler';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const { ipos } = await getAllIpos();

  const rows = ipos.map((ipo) => ({ ipo, rating: rate(ipo), type: issueType(ipo) }));
  const bySort = sort === 'score' ? 'score' : 'date';
  rows.sort((a, b) =>
    bySort === 'score'
      ? (b.rating.score ?? -1) - (a.rating.score ?? -1)
      : a.ipo.issue.openDate.localeCompare(b.ipo.issue.openDate),
  );

  const hasDemo = ipos.some((i) => i.dataSource === 'demo');

  return (
    <main className="wrap">
      {hasDemo && (
        <div className="banner" role="note">
          <strong>Demo data.</strong> These companies and numbers are fictional and exist only to show how the site
          works. Connect a data feed (see README) to replace them with real filings.
        </div>
      )}

      <h1 className="page-title serif">Upcoming IPOs, scored on reported facts</h1>
      <p className="lede">
        Each IPO gets a 0 to 10 score from its filed financials, issue structure and valuation against listed peers.
        No listing-gain guesses, no grey-market premium, no subscription forecasts.{' '}
        <Link href="/methodology">See exactly how the score is built.</Link>
      </p>

      <div className="toolbar">
        <span className="muted">Sort by</span>
        <span className="seg">
          <Link href="/" aria-current={bySort === 'date'}>Open date</Link>
          <Link href="/?sort=score" aria-current={bySort === 'score'}>Score</Link>
        </span>
        <span className="faint">{rows.length} IPOs</span>
      </div>

      <div className="board">
        <div className="board-head" aria-hidden="true">
          <span>Company</span>
          <span>Opens - closes</span>
          <span>Price band</span>
          <span>Issue size</span>
          <span>Issue type</span>
          <span>Fundamentals score</span>
        </div>

        {rows.map(({ ipo, rating, type }) => {
          const tone = toneFor(rating.score);
          const chip = type === 'Fresh Issue' ? 'fresh' : type === 'Offer for Sale' ? 'ofs' : 'mix';
          return (
            <Link key={ipo.slug} href={`/ipo/${ipo.slug}`} className="board-row">
              <div>
                <div className="row-name">{ipo.name}</div>
                <div className="row-sub">
                  {ipo.sector} · {ipo.segment} · {ipo.exchange}
                  {ipo.dataSource === 'demo' ? ' · demo' : ''}
                </div>
              </div>
              <div>
                <span className="cell-label">Opens - closes</span>
                {fmtDate(ipo.issue.openDate)} - {fmtDate(ipo.issue.closeDate)}
              </div>
              <div>
                <span className="cell-label">Price band</span>
                {fmtRs(ipo.issue.priceBandLow, 0)} - {fmtRs(ipo.issue.priceBandHigh, 0)}
              </div>
              <div>
                <span className="cell-label">Issue size</span>
                {fmtCr(ipo.issue.freshIssueCr + ipo.issue.ofsCr)}
              </div>
              <div>
                <span className="cell-label">Issue type</span>
                <span className={`chip ${chip}`}>{type}</span>
              </div>
              <div className="score-cell">
                <span className={`n tone-${tone}`}>{rating.score === null ? 'n/a' : rating.score.toFixed(1)}</span>
                <div>
                  <Ruler score={rating.score} size="sm" />
                  <div className="row-sub">{rating.band}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
