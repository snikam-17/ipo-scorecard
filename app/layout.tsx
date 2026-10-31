import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IPO Scorecard', template: '%s | IPO Scorecard' },
  description:
    'A 0-10 fundamentals score for upcoming Indian IPOs, built only from reported facts: financials, issue structure, valuation against peers. No predictions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              IPO<span>Scorecard</span>
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Upcoming IPOs</Link>
              <Link href="/methodology">How scores work</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <p>
            Scores summarise reported fundamentals as filed. They do not predict listing gains or returns and are not
            investment advice. Always read the Red Herring Prospectus before applying.
          </p>
        </footer>
      </body>
    </html>
  );
}
