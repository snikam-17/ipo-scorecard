import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How this works' };

export default function Methodology() {
  return (
    <main className="wrap method">
      <h1 className="page-title serif">How this works</h1>
      <p className="lede">
        This site lists live and upcoming Indian IPOs and explains each one in plain language. Here is exactly where the
        information comes from and what it can and cannot tell you.
      </p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Where the data comes from</h2>
        <ul>
          <li>
            Dates, price band, lot size, issue size and subscription numbers come from the ipoalerts.in IPO data service.
            They are copied as given and are not edited.
          </li>
          <li>The site checks for new and changed IPOs once a day. An IPO moves to &ldquo;Recently closed&rdquo; automatically once its closing date has passed.</li>
          <li>Grey market premium, where shown, is an unofficial market figure. It is not a prediction and never changes a rating.</li>
        </ul>

        <h2>The summaries</h2>
        <ul>
          <li>The plain-language summary and other text are written by an AI model, not by a person.</li>
          <li>
            Without web research, the AI only sees the IPO listing data. It is told to write &ldquo;Not disclosed&rdquo;
            for anything it does not have, and not to use its memory for figures.
          </li>
          <li>When web research is enabled, the AI also reads public sources, and the page lists them under Sources.</li>
          <li>AI can still make mistakes. Check every number against the Red Herring Prospectus before you act.</li>
        </ul>

        <h2>The 1 to 10 rating</h2>
        <ul>
          <li>A rating appears only when the financial statements have been researched. Until then the page says &ldquo;Rating pending&rdquo;.</li>
          <li>A rating is an AI-written opinion about the business as reported. It is not a forecast of listing gains or share price.</li>
          <li>Subscription levels and grey market premium are not used to produce the rating.</li>
        </ul>

        <h2>What this site is not</h2>
        <p>
          It is not investment advice, a recommendation to apply or avoid an IPO, or a prediction of returns. Investing in
          IPOs involves risk. Read the offer document and speak to a registered adviser if you need advice.
        </p>
      </div>
    </main>
  );
}
