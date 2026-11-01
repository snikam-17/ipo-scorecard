# IPO Scorecard

A Next.js + Postgres website that lists every live and upcoming NSE/BSE IPO, keeps itself up to date, and gives each IPO a 0-10 fundamentals score built **only from reported facts**. No listing-gain guesses, no grey-market premium.

## How the data flows

```
Upstox Developer API  --npm run sync (every 30 min)-->  ipo_listings  --\
  live + upcoming NSE/BSE IPOs                           (no hand edits)  \
  status, dates, price band, lot size,                                     >--> website (Neon Postgres)
  issue size, subscription, RHP link                                      /
                                                                         /
data/facts/<id>.json  --npm run facts:load (on git push)-->  ipo_facts --/
  fundamentals typed in from the RHP
  (financials, fresh issue vs OFS, objects of the issue, promoter holding, peers, history)
```

- **Automatic part:** the list of IPOs and everything the exchange feed publishes. New IPOs appear on the site without you doing anything.
- **Manual part:** fundamentals. No exchange feed or free API publishes restated financials, objects of the issue or peer tables in structured form; they live in the RHP. Each IPO gets a facts file. Until it exists the IPO is listed with "Rating pending" instead of a score.
- **Never guessed:** if a value is missing, the page says so. If the facts file and the live feed disagree on issue size by more than 2%, the score is withheld and the page says "Needs review".

### Why Upstox and not NSE/BSE directly

NSE and BSE publish no official public API for IPO listings. The endpoints their websites use are unofficial, need cookie handshakes, change without notice and often refuse cloud servers, so a site built on them breaks without warning and may breach their terms. The Upstox Developer API returns the IPOs open for bidding on NSE and BSE (mainboard and SME) with a documented contract. The provider is isolated in `lib/providers/upstox.ts`, so another feed can be added or swapped without touching the rest.

## Set up

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL and UPSTOX_ACCESS_TOKEN
npm run db:init          # creates the tables (safe to re-run)
npm run sync             # pulls live and upcoming IPOs
npm run dev              # http://localhost:3000
```

If you ran the first version of this project's schema, run `db/migrate-v1-to-v2.sql` once before `db:init`.

### Getting an Upstox access token

1. Create an Upstox account and open the Upstox developer apps page (https://account.upstox.com/developer/apps).
2. Create an app and generate an access token.
3. Put it in `UPSTOX_ACCESS_TOKEN`.

**Check token lifetime.** Upstox access tokens may expire (some daily). When the token expires, `npm run sync` fails with a clear message, the site keeps showing the last good data, and shows an "update failed" notice after 24 hours. Check Upstox's current token documentation for a longer-lived option for read-only data, and put the new token in GitHub secrets when it changes.

## Automatic updates (GitHub Actions)

Add these in GitHub: **Settings, Secrets and variables, Actions**:

| Secret | Value |
|---|---|
| `DATABASE_URL` | your Neon pooled connection string |
| `UPSTOX_ACCESS_TOKEN` | the Upstox token |

- `.github/workflows/sync.yml` runs `npm run sync` every 30 minutes on weekdays 08:30-18:30 IST and every 6 hours otherwise. You can also run it by hand from the **Actions** tab.
- `.github/workflows/facts.yml` runs `npm run facts:load` whenever you push a change under `data/facts/`.

Every sync is recorded in `sync_runs`. The site shows "Live data last updated ..." and warns when data is over 24 hours old or the last run failed.

## Adding fundamentals for an IPO

1. Find the listing id: open `/api/ipos` on your site and copy the `slug` (for example `acme-limited-ipo`).
2. Copy `data/facts/_template.json` to `data/facts/<slug>.json`.
3. Fill every field from the **Red Herring Prospectus** (company history, objects of the issue, summary financial information, promoter holding, basis for issue price/peers). Put the figures in ₹ crore, shares in crore. **Do not estimate.** If the RHP does not give a number, do not guess: the loader will reject the file and tell you what is missing.
4. Add at least one `sourceDocs` entry naming the RHP and the date it was filed.
5. `npm run facts:load` (or `git push`, and the workflow loads it).

The loader checks that quotas add up to 100, that objects of the issue equal the fresh issue, that numbers are present, and that a source is named.

## How the score works

`lib/scoring.ts` holds the whole model (version `1.0.0`): 11 factors, weights summing to 100, each mapping one reported number to 0-10 on a published scale (shown on the `/methodology` page and in each IPO's breakdown). Missing factors are dropped and the rest re-weighted; each page shows how much weight had data. Tune thresholds and weights to your own view, then bump `MODEL_VERSION`. Every score change is stored in `ipo_score_snapshots`.

## Deploying (Vercel + Neon)

1. Push to GitHub, import the repo in Vercel, add `DATABASE_URL`, deploy.
2. Set the function region to Mumbai (bom1) under Settings, Functions.
3. Add the two secrets above in GitHub so updates run.

## Project layout

```
app/                 / (list), /ipo/[slug], /methodology, /api/ipos
components/          Ruler (shared 0-10 scale), Charts, SyncNotice
lib/providers/       listing feed adapter (upstox.ts)
lib/merge.ts         joins live listing + facts, decides rated vs "Rating pending"
lib/scoring.ts       the rating model
lib/repo.ts          database reads (never falls back to made-up data)
lib/db-write.ts      upserts, pruning of withdrawn issues, score snapshots
scripts/             db-init, sync, facts-load, score-check, provider-check
data/facts/          one JSON per IPO, read from the RHP
db/schema.sql        tables
lib/fixtures/        test-only sample data (never shown on the site)
```

## Checks

```bash
npm run test:score   # scoring maths and weights
npm run test:feed    # feed mapping, merge rules and HTTP handling against a mock server
npm run typecheck
npm run build
```

## Before you go live

- Confirm every facts file against the RHP; a wrong number is the biggest risk to a facts-only product.
- Keep the "not investment advice" footer. If you publish ratings publicly, check Indian rules on research analyst / investment advice registration with a qualified professional.
- Add privacy policy and contact pages.

## AI research pipeline (ipoalerts.in + Claude) — `/api/cron/sync-ipos`

A second, independent pipeline. It fetches UPCOMING, OPEN and the latest 3 CLOSED Mainboard and SME IPOs from `api.ipoalerts.in`, asks Claude (with web search) for a structured research payload, and upserts everything into the `ipos` table (conflict target: `symbol`).

- Migration: `db/migrations/003_ipos_ai_pipeline.sql` (run it in the Neon SQL Editor).
- Schedule: `vercel.json` (every 6 hours). **Vercel's free Hobby plan only allows one cron run per day and fails the deployment on anything more frequent.** On Hobby, either change the schedule to `0 2 * * *`, or delete the `crons` block and use `docs/trigger-sync.yml` (a GitHub Actions workflow that calls the endpoint every 6 hours).
- Environment variables (in `.env.local` and in Vercel): `DATABASE_URL`, `IPO_ALERTS_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`. Optional tuning variables are listed in `.env.example`.
- Research is bounded: at most `MAX_RESEARCH_PER_RUN` (default 3) IPOs per run, each only when it has no research or the research is older than `RESEARCH_TTL_HOURS` (default 72). Metadata (dates, price band, lot size, GMP, subscription) refreshes on every run for every IPO.
- Calling it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-site>/api/cron/sync-ipos`. The JSON reply shows `processedCount`, `researchedCount`, `researchBacklog`, `failures` and `warnings`.
- The AI output is a machine-generated draft: figures can be wrong. Every stored payload carries `sources`, `data_gaps`, `model` and `generated_at`, and anything shown to users should be labelled AI-generated and not investment advice.

The first pipeline (Upstox + RHP facts files, tables `ipo_listings` / `ipo_facts`) is separate and its site pages do not read the `ipos` table. Choose one as the website's source of truth.
