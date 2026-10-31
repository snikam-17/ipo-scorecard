# IPO Scorecard

A Next.js + Postgres website that scores upcoming Indian IPOs from 0 to 10 using **reported facts only**: financials, issue structure (fresh issue vs offer for sale), objects of the issue, shareholding, and valuation against peers. No predictions, no grey-market premium, no listing-gain guesses.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `DATABASE_URL` the site runs on **fictional demo data** (3 made-up companies, clearly bannered). Nothing on screen is a real filing until you connect a feed.

## Connect a database and real data

```bash
cp .env.example .env          # set DATABASE_URL, IPO_API_URL, IPO_API_KEY
npm run db:init               # creates tables from db/schema.sql
npm run ingest                # pulls from the IPO API, validates, upserts, snapshots scores
```

1. Pick an IPO data API (or start with manual entry from the RHP).
2. Open `lib/providers/generic-json.ts` and edit `normalize()` to map the vendor's fields to the `Ipo` type in `lib/types.ts`.
3. `lib/validate.ts` rejects incomplete or inconsistent records (price band, quotas summing to 100, objects of the issue summing to the fresh issue). Rejected records are never stored half-filled.
4. Run `npm run ingest` on a schedule (cron / GitHub Actions) so new IPOs and updated RHPs flow in.

Each ingest also writes a row to `ipo_score_snapshots` (score, confidence, per-factor values, model version), so you can show how a rating changed over time.

## How the score works

`lib/scoring.ts` holds the whole model (version `1.0.0`). 11 factors, weights sum to 100:

| Group | Factor | Weight |
|---|---|---|
| Growth & profitability | Revenue CAGR | 14 |
| | PAT margin | 12 |
| | Profitable years | 8 |
| | Return on equity | 14 |
| Balance sheet & cash | Debt to equity | 10 |
| | CFO / PAT | 8 |
| Valuation | P/E vs peer median | 10 |
| | P/B vs peer median | 4 |
| Issue structure | Fresh issue share | 8 |
| | Fresh issue funding growth | 6 |
| | Promoter holding after issue | 6 |

Each factor maps one number to 0-10 with a piecewise-linear scale shown on the page. Missing factors are dropped and the rest re-weighted; the page shows how much weight had data. **Tune the thresholds and weights to your own view**, then bump `MODEL_VERSION`.

## Project layout

```
app/                 pages: / (list), /ipo/[slug] (detail), /methodology, /api/ipos
components/          Ruler (the shared 0-10 scale), Charts (Recharts)
lib/types.ts         canonical Ipo record
lib/metrics.ts       derived numbers (P/E, P/B, ROE, market cap, post-issue holding ...)
lib/scoring.ts       the rating model
lib/validate.ts      record validation
lib/repo.ts          Postgres reads, demo-seed fallback
lib/providers/       data-feed adapters
scripts/             db-init, ingest, score-check
db/schema.sql        tables
```

## Checks

```bash
npm run test:score   # scale maths, record validation, weights = 100, score ordering
npm run typecheck
npm run build
```

## Before you go live

- Replace demo data and confirm every number against the RHP; wrong data is the biggest risk to a facts-only product.
- Keep the "not investment advice" footer. If you publish ratings commercially, check Indian regulations on research analyst / investment advice registration with a qualified professional.
- Add peer data you trust: the valuation factors depend on the peers named in the offer document.
