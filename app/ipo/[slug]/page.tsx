import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getIpo, type IpoRecord } from '@/lib/ipos-repo';
import { fmtCr, fmtDate, fmtDateTime, fmtNum, fmtPct, fmtRs, fmtX } from '@/lib/format';
import { Ruler, toneFor } from '@/components/Ruler';
import { SyncNotice } from '@/components/SyncNotice';

export const dynamic = 'force-dynamic';

// The [slug] folder name is kept; the value in the URL is the IPO's stock symbol, e.g. /ipo/BCSSL.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { ipo } = await getIpo(decodeURIComponent(slug));
  return { title: ipo ? `${ipo.name} IPO` : 'IPO not found' };
}

const STATUS_LABEL = { OPEN: 'Open for bidding', UPCOMING: 'Opening soon', CLOSED: 'Closed' } as const;
const isNotDisclosed = (s: string | null) => s === null || /^not disclosed/i.test(s.trim());

export default async function IpoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { state, ipo } = await getIpo(decodeURIComponent(slug));

  if (state !== 'ok') {
    return (
      <main className="wrap">
        <div className="crumb"><Link href="/">← All IPOs</Link></div>
        <div className="banner" role="alert">
          <strong>{state === 'not_configured' ? 'Database not connected.' : 'The database could not be read.'}</strong> Please try again shortly.
        </div>
      </main>
    );
  }
  if (!ipo) notFound();

  const r = ipo.research;
  const grounded = r?.grounded === true;
  const tone = toneFor(ipo.rating);
  const minBid = ipo.lotSize && ipo.priceBandHigh ? ipo.lotSize * ipo.priceBandHigh : null;
  const gmpPct = ipo.gmpAmount !== null && ipo.priceBandHigh ? (ipo.gmpAmount / ipo.priceBandHigh) * 100 : null;
  const showBusiness = !!r && !isNotDisclosed(r.businessModel);

  return (
    <main className="wrap">
      <div className="crumb">
        <Link href="/">← All IPOs</Link>
      </div>

      <SyncNotice lastUpdatedAt={ipo.updatedAt} />

      <div className="detail">
        {/* ---------- Left rail: rating ---------- */}
        <aside className="rail">
          <div className="panel score-panel">
            {ipo.rating !== null ? (
              <>
                <div>
                  <span className={`big tone-${tone}`}>{ipo.rating.toFixed(1)}</span>
                  <span className="of">/ 10</span>
                </div>
                {ipo.verdict && <div className={`band tone-${tone}`}>{ipo.verdict}</div>}
                <Ruler score={ipo.rating} />
                <div className="meta">AI-generated from web research. Not investment advice. Check the sources below.</div>
              </>
            ) : (
              <>
                <div className="band" style={{ fontSize: 22, margin: '0 0 6px' }}>Rating pending</div>
                <p className="muted" style={{ fontSize: 14 }}>
                  A rating needs the company&apos;s financial statements, which have not been researched for this IPO yet.
                  Nothing is guessed in the meantime.
                </p>
              </>
            )}
          </div>
          <nav className="panel toc" aria-label="On this page">
            <a href="#facts">Key facts</a>
            {showBusiness && <a href="#business">Business</a>}
            {grounded && <a href="#financials">Financial highlights</a>}
            {grounded && (r!.pros.length > 0 || r!.cons.length > 0) && <a href="#proscons">Strengths and risks</a>}
            {r && r.dataGaps.length > 0 && <a href="#gaps">What is not known</a>}
            <a href="#sources">Sources</a>
          </nav>
        </aside>

        {/* ---------- Main content ---------- */}
        <div className="content">
          <div className="head-block">
            <h1 className="serif">{ipo.name}</h1>
            <div className="tags">
              <span className="chip">{STATUS_LABEL[ipo.status]}</span>
              <span className="chip">{ipo.category === 'SME' ? 'SME' : 'Mainboard'}</span>
              {ipo.exchange && <span className="chip">{ipo.exchange}</span>}
              <span className="chip">{ipo.symbol}</span>
            </div>
            {r?.laymanSummary ? (
              <p className="desc">{r.laymanSummary}</p>
            ) : (
              ipo.about && <p className="desc">{ipo.about}</p>
            )}
            <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
              {r
                ? `Summary written by AI${grounded ? ' from web research' : ' from the IPO listing data only; no financial statements were read'}.`
                : 'No AI summary has been generated for this IPO yet.'}{' '}
              It can contain mistakes, so verify against the Red Herring Prospectus.
            </p>
          </div>

          {/* Key facts: all from the IPO listing feed */}
          <section className="panel" id="facts" aria-labelledby="facts-h">
            <h2 id="facts-h">Key facts</h2>
            <p className="sub">From the IPO listing data. Dates are in Indian time.</p>
            <dl className="facts" style={{ margin: 0 }}>
              <Fact label="Status" value={STATUS_LABEL[ipo.status]} />
              <Fact label="Bidding opens" value={ipo.openDate ? fmtDate(ipo.openDate) : 'Not announced'} />
              <Fact label="Bidding closes" value={ipo.closeDate ? fmtDate(ipo.closeDate) : 'Not announced'} />
              <Fact label="Allotment" value={ipo.allotmentDate ? fmtDate(ipo.allotmentDate) : 'Not announced'} />
              <Fact label="Listing" value={ipo.listingDate ? fmtDate(ipo.listingDate) : 'Not announced'} />
              <Fact label="Price band" value={ipo.priceBand ?? 'Not announced'} />
              <Fact label="Lot size" value={ipo.lotSize ? `${fmtNum(ipo.lotSize)} shares` : 'n/a'} />
              <Fact
                label="Minimum bid"
                value={minBid ? fmtRs(minBid, 0) : 'n/a'}
                note={minBid ? '1 lot at the upper price' : undefined}
              />
              <Fact label="Issue size" value={ipo.issueSizeCr ? fmtCr(ipo.issueSizeCr) : 'n/a'} />
              <Fact
                label="Subscription"
                value={ipo.subscriptionX !== null && ipo.subscriptionX > 0 ? fmtX(ipo.subscriptionX, 2) : 'Not available'}
                note={ipo.subscriptionX ? 'times the shares offered' : undefined}
              />
              <Fact
                label="Grey market premium"
                value={ipo.gmpAmount !== null ? fmtRs(ipo.gmpAmount, 0) : 'Not available'}
                note={gmpPct !== null ? `${fmtPct(gmpPct, 1)} of upper price. Unofficial, not a prediction.` : undefined}
              />
            </dl>
          </section>

          {showBusiness && (
            <section className="panel" id="business" aria-labelledby="business-h">
              <h2 id="business-h">Business</h2>
              <p className="sub">How the company makes money.</p>
              <p style={{ maxWidth: '72ch' }}>{r!.businessModel}</p>
            </section>
          )}

          {grounded && r && (
            <section className="panel" id="financials" aria-labelledby="fin-h">
              <h2 id="fin-h">Financial highlights</h2>
              <p className="sub">As found by the AI in public sources. Check each figure against the offer document.</p>
              <dl className="facts" style={{ margin: 0 }}>
                <Fact label="Revenue growth" value={r.revenueGrowth ?? 'Not found'} small />
                <Fact label="Profit after tax" value={r.patMargin ?? 'Not found'} small />
                <Fact label="Debt" value={r.debtEquity ?? 'Not found'} small />
                <Fact label="Return ratios" value={r.roeRoce ?? 'Not found'} small />
              </dl>
              {r.peerComparison && !isNotDisclosed(r.peerComparison) && (
                <p style={{ marginTop: 14, maxWidth: '72ch' }}>
                  <strong>Against listed peers: </strong>
                  {r.peerComparison}
                </p>
              )}
            </section>
          )}

          {grounded && r && (r.pros.length > 0 || r.cons.length > 0) && (
            <section className="panel" id="proscons" aria-labelledby="pc-h">
              <h2 id="pc-h">Strengths and risks</h2>
              <p className="sub">Both sides, as the AI read them from its sources.</p>
              <div className="two">
                <div>
                  <h3 className="sub-h">Strengths</h3>
                  <ul style={{ paddingLeft: 18, display: 'grid', gap: 6, margin: 0 }}>
                    {r.pros.map((p, n) => <li key={n}>{p}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="sub-h">Risks</h3>
                  <ul style={{ paddingLeft: 18, display: 'grid', gap: 6, margin: 0 }}>
                    {r.cons.map((c, n) => <li key={n}>{c}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {r && r.dataGaps.length > 0 && (
            <section className="panel" id="gaps" aria-labelledby="gaps-h">
              <h2 id="gaps-h">What is not known</h2>
              <p className="sub">Things the AI could not find. They are left blank, not guessed.</p>
              <ul style={{ paddingLeft: 18, display: 'grid', gap: 6, margin: 0 }}>
                {r.dataGaps.map((g, n) => <li key={n}>{g}</li>)}
              </ul>
            </section>
          )}

          <Sources ipo={ipo} />
        </div>
      </div>
    </main>
  );
}

function Fact({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd style={small ? { fontSize: 14, fontWeight: 500 } : undefined}>
        {value}
        {note && (
          <>
            <br />
            <small>{note}</small>
          </>
        )}
      </dd>
    </div>
  );
}

function Sources({ ipo }: { ipo: IpoRecord }) {
  const r = ipo.research;
  return (
    <section className="panel" id="sources" aria-labelledby="src-h">
      <h2 id="src-h">Sources</h2>
      <p className="sub">Where this page&apos;s information comes from.</p>
      <ul style={{ paddingLeft: 18, display: 'grid', gap: 6, margin: 0 }}>
        <li>IPO listing data (dates, price band, lot size, issue size, subscription) from the ipoalerts.in data service.</li>
        {ipo.prospectusUrl && (
          <li>
            <a href={ipo.prospectusUrl} target="_blank" rel="noopener noreferrer">Offer document (prospectus)</a>
          </li>
        )}
        {r?.sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
          </li>
        ))}
        {r && !r.grounded && <li>No other sources were consulted for the AI summary.</li>}
      </ul>
      {r && (
        <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>
          AI summary generated {r.generatedAt ? fmtDateTime(r.generatedAt) : fmtDateTime(ipo.researchedAt)}
          {r.model ? ` by ${r.model}` : ''}.
        </p>
      )}
    </section>
  );
}
