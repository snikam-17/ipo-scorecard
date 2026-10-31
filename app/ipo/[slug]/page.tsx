import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getIpoBySlug } from '@/lib/repo';
import { rate } from '@/lib/scoring';
import { issueType } from '@/lib/metrics';
import { fmtCr, fmtDate, fmtNum, fmtPct, fmtRs, fmtX } from '@/lib/format';
import { Ruler, toneFor } from '@/components/Ruler';
import { FinancialsChart, MarginsChart, PeerBars } from '@/components/Charts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ipo = await getIpoBySlug(slug);
  return { title: ipo ? `${ipo.name} IPO` : 'IPO not found' };
}

const CATEGORY_LABEL = { growth: 'Growth / capex', debt: 'Debt repayment', general: 'General corporate', other: 'Other' } as const;

export default async function IpoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ipo = await getIpoBySlug(slug);
  if (!ipo) notFound();

  const rating = rate(ipo);
  const m = rating.metrics;
  const type = issueType(ipo);
  const tone = toneFor(rating.score);
  const { issue, company, financials, peers } = ipo;
  const groups = ['Growth & profitability', 'Balance sheet & cash', 'Valuation', 'Issue structure'] as const;

  return (
    <main className="wrap">
      <div className="crumb">
        <Link href="/">← All upcoming IPOs</Link>
      </div>

      {ipo.dataSource === 'demo' && (
        <div className="banner" role="note">
          <strong>Demo data.</strong> {ipo.name} is a fictional company. Every number on this page is made up.
        </div>
      )}

      <div className="detail">
        {/* ---------- Left rail: score ---------- */}
        <aside className="rail">
          <div className="panel score-panel">
            <div>
              <span className={`big tone-${tone}`}>{rating.score === null ? 'n/a' : rating.score.toFixed(1)}</span>
              <span className="of">/ 10</span>
            </div>
            <div className={`band tone-${tone}`}>{rating.band}</div>
            <Ruler score={rating.score} />
            <div className="meta">
              Based on {rating.factors.filter((f) => f.score !== null).length} of {rating.factors.length} factors
              ({fmtPct(rating.confidence * 100, 0)} of the weight had data). Model v{rating.modelVersion}.
            </div>
          </div>
          <nav className="panel toc" aria-label="On this page">
            <a href="#facts">Key facts</a>
            <a href="#issue">Issue structure</a>
            <a href="#financials">Financials</a>
            <a href="#shareholding">Shareholding</a>
            <a href="#valuation">Valuation vs peers</a>
            <a href="#score">Score breakdown</a>
            <a href="#history">Company history</a>
            <a href="#sources">Sources</a>
          </nav>
        </aside>

        {/* ---------- Main content ---------- */}
        <div className="content">
          <div className="head-block">
            <h1 className="serif">{ipo.name}</h1>
            <div className="tags">
              <span className="chip">{ipo.sector}</span>
              <span className="chip">{ipo.segment}</span>
              <span className="chip">{ipo.exchange}</span>
              <span className="chip">{ipo.status}</span>
              <span className={`chip ${type === 'Fresh Issue' ? 'fresh' : type === 'Offer for Sale' ? 'ofs' : 'mix'}`}>{type}</span>
            </div>
            <p className="desc">{company.description}</p>
          </div>

          <section className="panel" id="facts">
            <h2>Key facts</h2>
            <p className="sub">
              Valuation figures use the upper price band, the pre-issue share count and the latest reported year ({m.latestFy}).
            </p>
            <dl className="facts">
              <Fact label="Price band" value={`${fmtRs(issue.priceBandLow, 0)} - ${fmtRs(issue.priceBandHigh, 0)}`} />
              <Fact label="Face value" value={fmtRs(issue.faceValue, 0)} />
              <Fact label="Lot size" value={`${issue.lotSize} shares`} />
              <Fact label="Minimum investment" value={fmtRs(m.minInvestment, 0)} small="1 lot, upper band" />
              <Fact label="Issue size" value={fmtCr(m.totalIssueCr)} />
              <Fact label="Market cap at upper band" value={fmtCr(m.marketCapCr)} small="post-issue" />
              <Fact label={`EPS (${m.latestFy})`} value={fmtRs(m.eps)} />
              <Fact label="Book value per share" value={fmtRs(m.bvps)} />
              <Fact label="P/E" value={m.pe === null ? 'Loss-making' : fmtX(m.pe)} />
              <Fact label="P/B" value={fmtX(m.pb)} />
              <Fact label="Return on equity" value={fmtPct(m.roe)} />
              <Fact label="Debt to equity" value={fmtX(m.debtToEquity, 2)} />
              <Fact label="Revenue CAGR" value={fmtPct(m.revenueCagr)} small={`${m.yearsReported} yrs`} />
              <Fact label="PAT margin" value={fmtPct(m.patMargin)} />
            </dl>
          </section>

          <section className="panel" id="issue">
            <h2>Issue structure</h2>
            <p className="sub">
              A fresh issue raises money for the company. An offer for sale (OFS) moves existing shares from selling
              shareholders to new investors, so the company receives nothing from that part.
            </p>

            <div className="sub-h">What is being sold: {fmtCr(m.totalIssueCr)}</div>
            <div className="stack" role="img" aria-label={`Fresh issue ${fmtPct(m.freshSharePct, 0)}, offer for sale ${fmtPct(m.ofsSharePct, 0)}`}>
              {issue.freshIssueCr > 0 && <span style={{ flex: issue.freshIssueCr, background: 'var(--s1)' }} />}
              {issue.ofsCr > 0 && <span style={{ flex: issue.ofsCr, background: 'var(--s2)' }} />}
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--s1)' }} />Fresh issue {fmtCr(issue.freshIssueCr)} ({fmtPct(m.freshSharePct, 0)})</span>
              <span><i style={{ background: 'var(--s2)' }} />Offer for sale {fmtCr(issue.ofsCr)} ({fmtPct(m.ofsSharePct, 0)})</span>
            </div>
            {issue.ofsCr > 0 && (
              <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>
                Promoters sell {fmtPct(issue.ofsFromPromotersPct, 0)} of the offer for sale; other selling shareholders sell the rest.
              </p>
            )}

            <div className="two" style={{ marginTop: 26 }}>
              <div>
                <div className="sub-h">Objects of the fresh issue</div>
                {issue.proceeds.length === 0 ? (
                  <p className="muted" style={{ fontSize: 14 }}>No fresh issue, so the company receives no proceeds.</p>
                ) : (
                  <div className="bar-rows">
                    {issue.proceeds.map((p) => (
                      <div className="bar-row" key={p.purpose}>
                        <div className="lab">
                          <span>{p.purpose} <span className="faint">({CATEGORY_LABEL[p.category]})</span></span>
                          <b>{fmtCr(p.amountCr)}</b>
                        </div>
                        <div className="hbar"><span style={{ width: `${(p.amountCr / issue.freshIssueCr) * 100}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="sub-h">Investor quota</div>
                <div className="stack" role="img" aria-label={`Retail ${issue.quota.retail}%, QIB ${issue.quota.qib}%, NII ${issue.quota.nii}%`}>
                  <span style={{ flex: issue.quota.retail, background: 'var(--s1)' }} />
                  <span style={{ flex: issue.quota.qib, background: 'var(--s2)' }} />
                  <span style={{ flex: issue.quota.nii, background: 'var(--s3)' }} />
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--s1)' }} />Retail {issue.quota.retail}%</span>
                  <span><i style={{ background: 'var(--s2)' }} />Qualified institutions {issue.quota.qib}%</span>
                  <span><i style={{ background: 'var(--s3)' }} />Non-institutional {issue.quota.nii}%</span>
                </div>

                <div className="sub-h" style={{ marginTop: 22 }}>Key dates</div>
                <table className="t">
                  <tbody>
                    <tr><td>Opens</td><td>{fmtDate(issue.openDate)}</td></tr>
                    <tr><td>Closes</td><td>{fmtDate(issue.closeDate)}</td></tr>
                    <tr><td>Allotment</td><td>{fmtDate(issue.allotmentDate)}</td></tr>
                    <tr><td>Listing</td><td>{fmtDate(issue.listingDate)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="two" style={{ marginTop: 22 }}>
              <div>
                <div className="sub-h">Lead managers</div>
                <p className="muted" style={{ fontSize: 14 }}>{issue.leadManagers.join(', ')}</p>
              </div>
              <div>
                <div className="sub-h">Registrar</div>
                <p className="muted" style={{ fontSize: 14 }}>{issue.registrar}</p>
              </div>
            </div>
          </section>

          <section className="panel" id="financials">
            <h2>Financials</h2>
            <p className="sub">Restated figures from the offer document, in ₹ crore. The table below holds the exact numbers behind both charts.</p>
            <div className="two">
              <FinancialsChart data={financials} />
              <MarginsChart data={financials} />
            </div>

            <div className="tscroll" style={{ marginTop: 22 }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>₹ crore</th>
                    {financials.map((f) => <th key={f.fy}>{f.fy}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Revenue" vals={financials.map((f) => fmtNum(f.revenue))} />
                  <Row label="EBITDA" vals={financials.map((f) => fmtNum(f.ebitda))} />
                  <Row label="EBITDA margin" vals={financials.map((f) => fmtPct(f.revenue > 0 ? (f.ebitda / f.revenue) * 100 : null))} />
                  <Row label="Profit after tax" vals={financials.map((f) => fmtNum(f.pat))} hl />
                  <Row label="PAT margin" vals={financials.map((f) => fmtPct(f.revenue > 0 ? (f.pat / f.revenue) * 100 : null))} />
                  <Row label="Net worth" vals={financials.map((f) => fmtNum(f.netWorth))} />
                  <Row label="Total debt" vals={financials.map((f) => fmtNum(f.totalDebt))} />
                  <Row label="Cash flow from operations" vals={financials.map((f) => fmtNum(f.cfo))} />
                  <Row label="Return on equity" vals={financials.map((f) => fmtPct(f.netWorth > 0 ? (f.pat / f.netWorth) * 100 : null))} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" id="shareholding">
            <h2>Shareholding before and after the issue</h2>
            <p className="sub">
              Promoter holding falls when promoters sell in the OFS and when new shares are issued. Computed from the issue size, upper price band and pre-issue holding.
            </p>
            <div className="bar-rows">
              <ShareRow label="Before the IPO" promoter={m.promoterPrePct} pub={m.publicPrePct} />
              <ShareRow label="After the IPO" promoter={m.promoterPostPct} pub={m.publicPostPct} />
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--s1)' }} />Promoters</span>
              <span><i style={{ background: 'var(--s3)' }} />Public and other shareholders</span>
            </div>
          </section>

          <section className="panel" id="valuation">
            <h2>Valuation against listed peers</h2>
            <p className="sub">
              {m.pe === null
                ? `The company reported a loss in ${m.latestFy}, so a price-to-earnings ratio is not meaningful. `
                : `At the upper price band the IPO is priced at ${fmtX(m.pe)} earnings; the peer median is ${fmtX(m.peerMedianPe)}. `}
              {m.pb !== null && `Price to book is ${fmtX(m.pb)} against a peer median of ${fmtX(m.peerMedianPb)}.`}
            </p>
            <div className="charts-3">
              <PeerBars metric="pe" company="This IPO" value={m.pe} peers={peers} />
              <PeerBars metric="pb" company="This IPO" value={m.pb} peers={peers} />
              <PeerBars metric="roe" company="This IPO" value={m.roe} peers={peers} />
            </div>
            <div className="tscroll" style={{ marginTop: 18 }}>
              <table className="t">
                <thead>
                  <tr><th>Company</th><th>P/E</th><th>P/B</th><th>ROE</th><th>PAT margin</th></tr>
                </thead>
                <tbody>
                  <tr className="hl">
                    <td>{ipo.name} (IPO)</td>
                    <td>{m.pe === null ? 'n/m' : fmtX(m.pe)}</td>
                    <td>{fmtX(m.pb)}</td>
                    <td>{fmtPct(m.roe)}</td>
                    <td>{fmtPct(m.patMargin)}</td>
                  </tr>
                  {peers.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.pe === null ? 'n/m' : fmtX(p.pe)}</td>
                      <td>{fmtX(p.pb)}</td>
                      <td>{fmtPct(p.roe)}</td>
                      <td>{fmtPct(p.patMargin)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Peer median</td>
                    <td>{fmtX(m.peerMedianPe)}</td>
                    <td>{fmtX(m.peerMedianPb)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" id="score">
            <h2>Score breakdown</h2>
            <p className="sub">
              Each factor turns one reported number into a 0 to 10 score on a fixed scale. The overall score is the weighted
              average of the factors that have data.
            </p>
            {groups.map((g) => {
              const fs = rating.factors.filter((f) => f.group === g);
              const w = fs.reduce((s, f) => s + f.weight, 0);
              return (
                <div className="factor-group" key={g}>
                  <h3><span>{g}</span><span>{w}% of score</span></h3>
                  {fs.map((f) => (
                    <div className="factor" key={f.key}>
                      <div className="nm">{f.label} <span className="wt">· weight {f.weight}%</span></div>
                      <div className="val">{f.value}</div>
                      <div className="rl"><Ruler score={f.score} size="sm" label={f.score === null ? `${f.label}: no data` : `${f.label}: ${f.score} out of 10`} /></div>
                      <div className={`sc tone-${toneFor(f.score)}`}>{f.score === null ? 'n/a' : f.score.toFixed(1)}</div>
                      <details>
                        <summary>How this is scored</summary>
                        <p>{f.rule}{f.note ? ` ${f.note}` : ''}</p>
                      </details>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>

          <section className="panel" id="history">
            <h2>Company history</h2>
            <p className="sub">Founded {company.founded}, headquartered in {company.headquarters}. Promoters: {company.promoters.join(', ')}.</p>
            <ol className="timeline">
              {company.history.map((h) => (
                <li key={`${h.year}-${h.event}`}>
                  <div className="yr">{h.year}</div>
                  <div className="ev">{h.event}</div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel" id="sources">
            <h2>Sources</h2>
            <p className="sub">Last updated {fmtDate(ipo.updatedAt)}. Data origin: {ipo.dataSource}.</p>
            <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
              {ipo.sourceDocs.map((d) => (
                <li key={d.label}>{d.url ? <a href={d.url} rel="noopener noreferrer">{d.label}</a> : d.label}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function Fact({ label, value, small }: { label: string; value: string; small?: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}{small ? <> <small>{small}</small></> : null}</dd>
    </div>
  );
}

function Row({ label, vals, hl }: { label: string; vals: string[]; hl?: boolean }) {
  return (
    <tr className={hl ? 'hl' : undefined}>
      <td>{label}</td>
      {vals.map((v, i) => <td key={i}>{v}</td>)}
    </tr>
  );
}

function ShareRow({ label, promoter, pub }: { label: string; promoter: number; pub: number }) {
  return (
    <div className="bar-row">
      <div className="lab"><span>{label}</span><b>Promoters {fmtPct(promoter)} · Public {fmtPct(pub)}</b></div>
      <div className="stack" role="img" aria-label={`${label}: promoters ${fmtPct(promoter)}, public ${fmtPct(pub)}`}>
        <span style={{ flex: Math.max(promoter, 0.01), background: 'var(--s1)' }} />
        <span style={{ flex: Math.max(pub, 0.01), background: 'var(--s3)' }} />
      </div>
    </div>
  );
}
