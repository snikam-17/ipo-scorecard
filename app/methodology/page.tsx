import type { Metadata } from 'next';
import { SEED_IPOS } from '@/lib/data/seed';
import { MODEL_VERSION, rate } from '@/lib/scoring';

export const metadata: Metadata = { title: 'How scores work' };

export default function Methodology() {
  // Factor definitions (weights and rules) do not depend on the company, so any record can supply them.
  const factors = rate(SEED_IPOS[0]).factors;
  const groups = Array.from(new Set(factors.map((f) => f.group)));

  return (
    <main className="wrap method">
      <h1 className="page-title serif">How scores work</h1>
      <p className="lede">
        The score is a deterministic function of numbers a company has filed. Two people feeding the same filing into the
        model get the same score. Model version {MODEL_VERSION}.
      </p>

      <div className="panel">
        <h2>What counts</h2>
        <ul>
          <li>Restated financials from the offer document: revenue, EBITDA, profit after tax, net worth, debt, operating cash flow.</li>
          <li>Issue facts: fresh issue versus offer for sale, objects of the issue, price band, promoter holding before and after.</li>
          <li>Valuation at the upper price band against the median of the peers named in the offer document.</li>
        </ul>

        <h2>What never counts</h2>
        <ul>
          <li>Expected listing gains, price targets or any forecast.</li>
          <li>Grey-market premium, subscription estimates and social-media sentiment.</li>
          <li>Analyst opinions or subscribe/avoid calls.</li>
        </ul>

        <h2>Missing data</h2>
        <p>
          If a factor cannot be computed (for example cash conversion when profit is negative), it is left out and the
          remaining weights are rescaled. Each page shows how much of the total weight had data. Missing data is never
          scored as good or bad.
        </p>

        <h2>Reading the score</h2>
        <ul>
          <li>8.0 and above: very strong fundamentals</li>
          <li>6.5 to 7.9: strong fundamentals</li>
          <li>5.0 to 6.4: average fundamentals</li>
          <li>3.5 to 4.9: weak fundamentals</li>
          <li>Below 3.5: very weak fundamentals</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          The score describes the business as reported. A high score does not mean the price is right or that the shares will
          rise. A low score on a young, loss-making company says it is early, not that it will fail.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 22 }}>
        <h2 style={{ marginTop: 0 }}>Every factor, weight and rule</h2>
        {groups.map((g) => (
          <div className="factor-group" key={g}>
            <h3>
              <span>{g}</span>
              <span>{factors.filter((f) => f.group === g).reduce((s, f) => s + f.weight, 0)}% of score</span>
            </h3>
            <div className="tscroll">
              <table className="t">
                <tbody>
                  {factors
                    .filter((f) => f.group === g)
                    .map((f) => (
                      <tr key={f.key}>
                        <td>
                          <b>{f.label.replace(/ \(.*\)$/, '')}</b>
                          {f.note ? <div className="faint" style={{ fontSize: 13 }}>{f.note}</div> : null}
                        </td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{f.rule}</td>
                        <td>{f.weight}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
