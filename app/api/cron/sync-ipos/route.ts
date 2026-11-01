import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

/**
 * GET /api/cron/sync-ipos
 *
 * 1. Fetches UPCOMING, OPEN and the latest CLOSED Mainboard + SME IPOs from api.ipoalerts.in
 * 2. Upserts their metadata into Neon (`ipos`, conflict target: symbol)
 * 3. For the IPOs that need it, asks Claude (with web search) for a structured research payload and stores it
 *
 * Secured by `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this automatically when CRON_SECRET is set).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds. If your Vercel plan caps lower, lower this and SYNC_TIME_BUDGET_SECONDS together.

/* ------------------------------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------------------------------- */

const IPO_API_BASE = (process.env.IPO_ALERTS_BASE_URL ?? 'https://api.ipoalerts.in').replace(/\/$/, '');

/** Which AI writes the research. Default: Google Gemini (has a free tier). Set AI_PROVIDER=claude to use Anthropic instead. */
type Provider = 'gemini' | 'claude';
const AI_PROVIDER: Provider = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase() === 'claude' ? 'claude' : 'gemini';
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
const GEMINI_BASE = (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
/** Google's free Gemini tier has no web search. Only set GEMINI_USE_SEARCH=true on a billed Google project. */
const GEMINI_USE_SEARCH = process.env.GEMINI_USE_SEARCH === 'true';
const MODEL = AI_PROVIDER === 'claude' ? CLAUDE_MODEL : GEMINI_MODEL;
/** Does the model get live web search? When false it only sees the data the IPO API supplied, and does NOT produce a rating. */
const GROUNDED = AI_PROVIDER === 'claude' || GEMINI_USE_SEARCH;

const RESEARCH_TTL_HOURS = numEnv('RESEARCH_TTL_HOURS', 72);
const MAX_RESEARCH_PER_RUN = numEnv('MAX_RESEARCH_PER_RUN', AI_PROVIDER === 'gemini' ? 8 : 3);
const MAX_WEB_SEARCHES = numEnv('MAX_WEB_SEARCHES_PER_IPO', 6);
const RECENT_CLOSED_COUNT = 3;
const MIN_TIME_FOR_RESEARCH_MS = 45_000;
const MAX_PAUSE_CONTINUATIONS = 3;

const VERDICT_TAGS = ['Apply for Listing Gains', 'Good for Long Term', 'Avoid', 'High Risk'] as const;
type VerdictTag = (typeof VERDICT_TAGS)[number];

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

type Category = 'MAINBOARD' | 'SME';
type Status = 'UPCOMING' | 'OPEN' | 'CLOSED';

/** The documented ipoalerts IPO object (https://ipoalerts.in/docs/api-reference/ipo-object). All fields optional on read. */
interface RawIpo {
  id?: string;
  name?: string;
  symbol?: string;
  slug?: string;
  type?: string; // "EQ" | "SME" | "DEBT"
  status?: string; // "open" | "closed" | "upcoming" | "listed" | "announced"
  startDate?: string;
  endDate?: string;
  listingDate?: string;
  priceRange?: string; // e.g. "95-100"
  minQty?: number;
  issueSize?: string; // e.g. "192cr"
  about?: string;
  nseInfoUrl?: string;
  prospectusUrl?: string;
  infoUrl?: string;
  gmp?: { aggregations?: { median?: number; mean?: number } } | null;
  subscription?: { timesSubscribed?: number } | null;
  schedule?: Array<{ date?: string; event?: string }>;
  [key: string]: unknown;
}

interface IpoRow {
  symbol: string;
  companyName: string;
  exchange: string | null;
  category: Category;
  status: Status;
  priceBand: string | null;
  lotSize: number | null;
  issueSizeCrores: number | null;
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  gmpAmount: number | null;
  subscriptionRate: number | null;
  about: string | null;
  prospectusUrl: string | null;
  raw: RawIpo;
}

interface Research {
  layman_summary: string;
  business_model: string;
  financial_highlights: { revenue_growth: string; pat_margin: string; debt_equity: string; roe_roce: string };
  pros_strengths: string[];
  cons_risks: string[];
  peer_comparison: string;
  /** null when the model had no web search: a rating needs real financial data. */
  rating_score: number | null;
  verdict_tag: VerdictTag | null;
  /** true = the model could search the web; false = it only saw the IPO API's own data. */
  grounded: boolean;
  /** Extras that make the output checkable. */
  listing_exchange: string | null;
  sources: Array<{ title: string; url: string }>;
  data_gaps: string[];
}

interface ExistingState {
  hasResearch: boolean;
  researchedAt: Date | null;
}

/* ------------------------------------------------------------------------------------------------
 * Small parsing helpers
 * ---------------------------------------------------------------------------------------------- */

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

/** "192cr" -> 192 ; "₹1,200 Cr" -> 1200 ; "45 lakh" -> 0.45 ; no unit -> assumed crore. */
function parseCrores(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /([\d,]+(?:\.\d+)?)\s*(cr|crore|crores|lakh|lakhs|lac)?/i.exec(v.replace(/[₹]|rs\.?/gi, ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  return unit.startsWith('la') ? n / 100 : n;
}

/** "95-100" -> "₹95 - ₹100". Returns null when the band is not announced yet (empty, or zeros). */
function formatPriceBand(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const nums = v.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length === 0 || nums.every((n) => n === 0)) return null;
  if (nums.length === 1) return `₹${nums[0]}`;
  return `₹${nums[0]} - ₹${nums[1]}`;
}

function allotmentDateFrom(schedule: RawIpo['schedule']): string | null {
  if (!Array.isArray(schedule)) return null;
  const hit = schedule.find((s) => typeof s?.event === 'string' && /allot/i.test(s.event) && !/refund|credit/i.test(s.event));
  return isoDate(hit?.date);
}

/* ------------------------------------------------------------------------------------------------
 * ipoalerts.in
 * ---------------------------------------------------------------------------------------------- */

class IpoApiError extends Error {}
/** Invalid/missing key: stop immediately instead of burning more of the (small) request quota. */
class IpoAuthError extends IpoApiError {}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchIpoStatus(status: string, attempt = 0): Promise<{ ipos: RawIpo[]; meta: unknown }> {
  const key = process.env.IPO_ALERTS_API_KEY;
  if (!key) throw new IpoApiError('IPO_ALERTS_API_KEY is not set');

  const params = new URLSearchParams({ status });
  if (process.env.IPO_ALERTS_INCLUDE_GMP === 'true') params.set('includeGmp', 'true');

  const res = await fetch(`${IPO_API_BASE}/ipos?${params}`, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get('X-RateLimit-Retry-After')) || 10, 20) * 1000;
    await sleep(wait);
    return fetchIpoStatus(status, attempt + 1);
  }
  if (res.status === 401) {
    throw new IpoAuthError('ipoalerts rejected the API key (HTTP 401). Check IPO_ALERTS_API_KEY.');
  }
  if (res.status === 403) {
    throw new IpoApiError(`ipoalerts refused status=${status} (HTTP 403): the key is invalid or your ipoalerts plan does not include this query (the free plan returns open IPOs only).`);
  }
  if (!res.ok) throw new IpoApiError(`ipoalerts /ipos?status=${status} responded HTTP ${res.status}`);

  const body = (await res.json()) as { ipos?: unknown; meta?: unknown } | unknown[];
  const list = Array.isArray(body) ? body : Array.isArray(body?.ipos) ? body.ipos : null;
  if (!list) throw new IpoApiError(`ipoalerts /ipos?status=${status} returned an unexpected shape (no "ipos" array)`);
  return { ipos: list as RawIpo[], meta: Array.isArray(body) ? null : (body.meta ?? null) };
}

function normalize(raw: RawIpo, status: Status): IpoRow | { skip: string } {
  const type = (raw.type ?? '').toUpperCase();
  const category: Category | null = type === 'SME' ? 'SME' : type === 'EQ' || type === '' ? 'MAINBOARD' : null;
  if (!category) return { skip: `${raw.symbol ?? raw.name ?? '?'}: type "${raw.type}" is not Mainboard or SME` };

  const symbol = (raw.symbol || raw.slug || '').trim().toUpperCase();
  if (!symbol) return { skip: `${raw.name ?? raw.id ?? '?'}: no symbol or slug` };
  if (!raw.name) return { skip: `${symbol}: no company name` };

  const gmp = raw.gmp?.aggregations;
  return {
    symbol,
    companyName: raw.name.trim(),
    exchange: typeof raw.exchange === 'string' ? raw.exchange : null, // not in the documented object; AI fills it when missing
    category,
    status,
    priceBand: formatPriceBand(raw.priceRange),
    lotSize: toNum(raw.minQty),
    issueSizeCrores: parseCrores(raw.issueSize),
    openDate: isoDate(raw.startDate),
    closeDate: isoDate(raw.endDate),
    allotmentDate: allotmentDateFrom(raw.schedule),
    listingDate: isoDate(raw.listingDate),
    gmpAmount: toNum(gmp?.median ?? gmp?.mean),
    subscriptionRate: toNum(raw.subscription?.timesSubscribed),
    about: typeof raw.about === 'string' ? raw.about : null,
    prospectusUrl: typeof raw.prospectusUrl === 'string' ? raw.prospectusUrl : null,
    raw,
  };
}

/** All UPCOMING, all OPEN, and the latest 3 CLOSED. */
async function loadIpoRows(warnings: string[]): Promise<{ rows: IpoRow[]; counts: Record<string, number> }> {
  const plan: Array<{ api: string; status: Status; optional?: boolean }> = [
    { api: 'open', status: 'OPEN' },
    { api: 'upcoming', status: 'UPCOMING' },
    { api: 'announced', status: 'UPCOMING', optional: true },
    { api: 'closed', status: 'CLOSED' },
  ];

  const bySymbol = new Map<string, IpoRow>();
  const closed: IpoRow[] = [];
  const counts: Record<string, number> = {};
  let firstError: Error | null = null;

  for (const p of plan) {
    let result;
    try {
      result = await fetchIpoStatus(p.api);
    } catch (e) {
      if (e instanceof IpoAuthError) throw e;
      // One status failing (for example a plan that only allows open IPOs) must not discard what the others returned.
      warnings.push(`status=${p.api} skipped: ${(e as Error).message}`);
      firstError ??= e as Error;
      continue;
    }
    counts[p.api] = result.ipos.length;
    for (const raw of result.ipos) {
      const n = normalize(raw, p.status);
      if ('skip' in n) {
        warnings.push(n.skip);
        continue;
      }
      if (p.status === 'CLOSED') closed.push(n);
      else if (!bySymbol.has(n.symbol)) bySymbol.set(n.symbol, n);
    }
  }

  if (firstError && bySymbol.size === 0 && closed.length === 0) throw firstError; // nothing at all came back

  closed.sort((a, b) => (b.closeDate ?? '').localeCompare(a.closeDate ?? ''));
  for (const c of closed.slice(0, RECENT_CLOSED_COUNT)) if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, c);

  return { rows: [...bySymbol.values()], counts };
}

/* ------------------------------------------------------------------------------------------------
 * Claude research
 * ---------------------------------------------------------------------------------------------- */

const SEARCH_SYSTEM_PROMPT = `You are an equity research analyst for an Indian IPO information website. You write for two audiences at once: beginners who need plain language, and experienced investors who want precise financial metrics.

Rules you must follow:
1. Use web search to find the company's DRHP/RHP (SEBI, NSE, BSE or the company site) and reputable financial coverage. Base every number on a source you actually retrieved.
2. NEVER invent or estimate a figure. If something is not in the sources, write "Not disclosed in sources found" for that field and add a short note to "data_gaps".
3. When you give a financial figure, include the fiscal year and unit (for example "FY25 revenue ₹1,059 Cr").
4. "rating_score" (1.0 to 10.0, one decimal) must rest on reported fundamentals: growth, profitability, leverage, return ratios, cash flow, valuation against listed peers, fresh-issue vs offer-for-sale structure, use of proceeds and promoter/governance signals. Grey market premium and subscription numbers are market-sentiment context only and must not drive the score.
5. "verdict_tag" must be exactly one of: ${VERDICT_TAGS.map((t) => `"${t}"`).join(', ')}.
6. Reply with ONE JSON object and nothing else: no markdown fences, no commentary before or after.`;

/** Used when the model has no web access (Gemini free tier). It may only restate what the IPO API supplied. */
const PROVIDED_DATA_SYSTEM_PROMPT = `You are a data editor for an Indian IPO information website. You have NO web access in this run. Your only source is the "Known data" block in the user's message.

Rules you must follow:
1. Use ONLY the Known data. Do not use memory for any number, date, financial figure, peer, ratio or claim about this company: these are new IPOs and your memory of them is unreliable.
2. Anything the Known data does not contain (revenue, profit, debt, return ratios, peer multiples, promoter details) must be written exactly as "Not disclosed in sources found", and each gap must be listed in "data_gaps".
3. "layman_summary": 3 plain-language sentences based on the provided description. If the description is missing or too thin, say plainly that little is known yet instead of guessing.
4. "pros_strengths" and "cons_risks": only points that follow from the Known data (for example issue size, price band, subscription level). No sector opinions stated as fact. If nothing can be said, use ["Not enough data provided to assess"].
5. "rating_score" and "verdict_tag" must be null: a rating needs financial data you were not given.
6. "listing_exchange" must be null and "sources" must be [].
7. Reply with ONE JSON object and nothing else: no markdown fences, no commentary before or after.`;

const systemPrompt = () => (GROUNDED ? SEARCH_SYSTEM_PROMPT : PROVIDED_DATA_SYSTEM_PROMPT);

function buildUserPrompt(ipo: IpoRow): string {
  const known = {
    company: ipo.companyName,
    symbol: ipo.symbol,
    category: ipo.category,
    status: ipo.status,
    price_band: ipo.priceBand,
    lot_size: ipo.lotSize,
    issue_size_crores: ipo.issueSizeCrores,
    open_date: ipo.openDate,
    close_date: ipo.closeDate,
    listing_date: ipo.listingDate,
    gmp_amount_rupees: ipo.gmpAmount,
    times_subscribed: ipo.subscriptionRate,
    prospectus_url: ipo.prospectusUrl,
    description_from_data_provider: ipo.about,
  };
  const ratingFields = GROUNDED
    ? `  "rating_score": 0.0,\n  "verdict_tag": "one of the allowed tags",`
    : `  "rating_score": null,\n  "verdict_tag": null,`;
  const intro = GROUNDED
    ? 'Research this Indian IPO and return the JSON object described below.'
    : 'Summarise this Indian IPO from the Known data only and return the JSON object described below.';
  return `${intro}

Known data (from the IPO data provider${GROUNDED ? '; verify against the offer document where you can' : ''}):
${JSON.stringify(known, null, 2)}

Required JSON shape (replace every placeholder with real content):
{
  "layman_summary": "Exactly 3 sentences: what the company does, how it earns money, who buys its products.",
  "business_model": "Detailed explanation of revenue channels and business verticals.",
  "financial_highlights": {
    "revenue_growth": "3-year CAGR or year-by-year growth, with fiscal years",
    "pat_margin": "Profit after tax and margin trend, with fiscal years",
    "debt_equity": "Debt status: borrowings, debt-to-equity",
    "roe_roce": "Return on equity and return on capital employed, with fiscal years"
  },
  "pros_strengths": ["moat or advantage", "industry tailwind"],
  "cons_risks": ["risk factor", "promoter or valuation risk"],
  "peer_comparison": "P/E ratio against listed competitors, naming them; say if the offer document gives no peers",
${ratingFields}
  "listing_exchange": "NSE, BSE or NSE and BSE, or null if not found",
  "sources": [{ "title": "page or document name", "url": "https://..." }],
  "data_gaps": ["anything you could not find"]
}`;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in the reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim().length > 0);
}

/** Strict validation. Throws an Error listing every problem so the model can be told exactly what to fix. */
function validateResearch(x: unknown): Research {
  const o = x as Record<string, unknown>;
  const problems: string[] = [];
  const str = (v: unknown, name: string) => {
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${name} must be a non-empty string`);
  };
  if (!o || typeof o !== 'object') throw new Error('reply is not a JSON object');

  str(o.layman_summary, 'layman_summary');
  str(o.business_model, 'business_model');
  str(o.peer_comparison, 'peer_comparison');
  const fh = o.financial_highlights as Record<string, unknown> | undefined;
  if (!fh || typeof fh !== 'object') problems.push('financial_highlights must be an object');
  else for (const k of ['revenue_growth', 'pat_margin', 'debt_equity', 'roe_roce']) str(fh[k], `financial_highlights.${k}`);
  if (!isStringArray(o.pros_strengths)) problems.push('pros_strengths must be a non-empty array of strings');
  if (!isStringArray(o.cons_risks)) problems.push('cons_risks must be a non-empty array of strings');
  const score = o.rating_score;
  if (GROUNDED) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 10) problems.push('rating_score must be a number from 1 to 10');
    if (!VERDICT_TAGS.includes(o.verdict_tag as VerdictTag)) problems.push(`verdict_tag must be exactly one of: ${VERDICT_TAGS.join(' | ')}`);
  }
  if (problems.length) throw new Error(problems.join('; '));

  // Without web search the model cannot know the exchange or cite sources, so anything it says there is discarded.
  const exch = GROUNDED && typeof o.listing_exchange === 'string' ? o.listing_exchange.trim() : null;
  const allowedExchange = exch && /^(NSE|BSE|NSE and BSE|NSE \+ BSE|BSE and NSE)$/i.test(exch) ? exch : null;
  const sources = GROUNDED && Array.isArray(o.sources)
    ? (o.sources as Array<Record<string, unknown>>)
        .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url as string))
        .map((s) => ({ title: typeof s.title === 'string' ? s.title : String(s.url), url: s.url as string }))
    : [];

  return {
    layman_summary: (o.layman_summary as string).trim(),
    business_model: (o.business_model as string).trim(),
    financial_highlights: {
      revenue_growth: (fh!.revenue_growth as string).trim(),
      pat_margin: (fh!.pat_margin as string).trim(),
      debt_equity: (fh!.debt_equity as string).trim(),
      roe_roce: (fh!.roe_roce as string).trim(),
    },
    pros_strengths: o.pros_strengths as string[],
    cons_risks: o.cons_risks as string[],
    peer_comparison: (o.peer_comparison as string).trim(),
    rating_score: GROUNDED ? Math.round((score as number) * 10) / 10 : null,
    verdict_tag: GROUNDED ? (o.verdict_tag as VerdictTag) : null,
    grounded: GROUNDED,
    listing_exchange: allowedExchange,
    sources,
    data_gaps: Array.isArray(o.data_gaps) ? (o.data_gaps as unknown[]).filter((g): g is string => typeof g === 'string') : [],
  };
}

async function researchWithClaude(client: Anthropic, ipo: IpoRow, deadline: number): Promise<Research> {
  const tools: Anthropic.Messages.ToolUnion[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }];
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: buildUserPrompt(ipo) }];
  let pauses = 0;
  let formatRetries = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining < 20_000) throw new Error('ran out of the time budget during research');

    const res = await client.messages.create(
      { model: MODEL, max_tokens: 6000, system: systemPrompt(), tools, messages },
      { signal: AbortSignal.timeout(remaining - 5_000) },
    );

    if (res.stop_reason === 'pause_turn') {
      if (++pauses > MAX_PAUSE_CONTINUATIONS) throw new Error('research did not finish after repeated pauses');
      messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.MessageParam['content'] });
      continue;
    }
    if (res.stop_reason === 'refusal') throw new Error('the model declined to answer');
    if (res.stop_reason === 'max_tokens') throw new Error('the reply was cut off (max_tokens)');

    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    try {
      return validateResearch(extractJson(text));
    } catch (e) {
      if (formatRetries++ >= 1) throw new Error(`invalid research JSON after a retry: ${(e as Error).message}`);
      messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.MessageParam['content'] });
      messages.push({
        role: 'user',
        content: `Your reply did not meet the required format: ${(e as Error).message}. Reply again with ONLY the corrected JSON object, using the same facts. Do not search again unless a required fact is missing.`,
      });
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Google Gemini research (plain REST, no SDK: POST /v1beta/models/{model}:generateContent)
 * ---------------------------------------------------------------------------------------------- */

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}
type GeminiContent = { role: 'user' | 'model'; parts: Array<{ text: string }> };

async function callGemini(
  contents: GeminiContent[],
  deadline: number,
  attempt = 0,
): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const remaining = deadline - Date.now();
  if (remaining < 20_000) throw new Error('ran out of the time budget during research');

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents,
    // Gemini cannot always combine JSON-only mode with Google Search, so JSON mode is used only without search.
    generationConfig: { maxOutputTokens: 8000, ...(GROUNDED ? {} : { responseMimeType: 'application/json' }) },
    ...(GROUNDED ? { tools: [{ google_search: {} }] } : {}),
  };

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(remaining - 5_000, 90_000)),
  });
  const data = (await res.json().catch(() => ({}))) as GeminiResponse;

  if (res.status === 429) {
    // Free tier: a few requests per minute and a daily cap. Wait once if the wait is short, otherwise give up on this IPO.
    const hinted = Number(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(JSON.stringify(data.error ?? {}))?.[1]);
    const wait = (Number.isFinite(hinted) ? hinted : 15) * 1000 + 1000;
    if (attempt < 1 && wait <= 40_000 && deadline - Date.now() > wait + 25_000) {
      await sleep(wait);
      return callGemini(contents, deadline, attempt + 1);
    }
    throw new Error(`Gemini rate limit or daily quota reached (HTTP 429): ${data.error?.message ?? 'no detail'}`);
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error(`Gemini rejected the request (HTTP ${res.status}): ${data.error?.message ?? 'no detail'}. Check GEMINI_API_KEY and GEMINI_MODEL.`);
  }
  if (res.status === 404) {
    throw new Error(`Gemini model "${GEMINI_MODEL}" was not found for this key (HTTP 404). Set GEMINI_MODEL to a model your key can use.`);
  }
  if (!res.ok) throw new Error(`Gemini responded HTTP ${res.status}: ${data.error?.message ?? 'no detail'}`);

  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${data.promptFeedback.blockReason})`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('the reply was cut off (MAX_TOKENS)');
  if (!text.trim()) throw new Error(`Gemini returned no text (finishReason: ${cand?.finishReason ?? 'unknown'})`);

  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .filter((c) => typeof c.web?.uri === 'string' && /^https?:\/\//.test(c.web.uri))
    .map((c) => ({ title: c.web?.title ?? (c.web?.uri as string), url: c.web?.uri as string }));
  return { text, sources };
}

async function researchWithGemini(ipo: IpoRow, deadline: number): Promise<Research> {
  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: buildUserPrompt(ipo) }] }];
  let formatRetries = 0;

  for (;;) {
    const { text, sources } = await callGemini(contents, deadline);
    try {
      const research = validateResearch(extractJson(text));
      if (GROUNDED && research.sources.length === 0) research.sources = sources;
      return research;
    } catch (e) {
      if (formatRetries++ >= 1) throw new Error(`invalid research JSON after a retry: ${(e as Error).message}`);
      contents.push({ role: 'model', parts: [{ text }] });
      contents.push({
        role: 'user',
        parts: [{ text: `Your reply did not meet the required format: ${(e as Error).message}. Reply again with ONLY the corrected JSON object, using the same facts.` }],
      });
    }
  }
}

/** Picks the configured AI provider. `client` is the Anthropic client (Claude only). */
function researchIpo(client: Anthropic | null, ipo: IpoRow, deadline: number): Promise<Research> {
  return client ? researchWithClaude(client, ipo, deadline) : researchWithGemini(ipo, deadline);
}

/* ------------------------------------------------------------------------------------------------
 * Neon / Postgres
 * ---------------------------------------------------------------------------------------------- */

let pool: Pool | null = null;
function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!pool) pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  return pool;
}

async function loadExisting(db: Pool, symbols: string[]): Promise<Map<string, ExistingState>> {
  const { rows } = await db.query(
    `select symbol, ai_research is not null as has_research, ai_researched_at from ipos where symbol = any($1::text[])`,
    [symbols],
  );
  return new Map(rows.map((r) => [r.symbol as string, { hasResearch: r.has_research as boolean, researchedAt: r.ai_researched_at as Date | null }]));
}

/**
 * INSERT ... ON CONFLICT (symbol) DO UPDATE.
 * Metadata always refreshes. AI columns are only replaced when new research is supplied (COALESCE keeps the old ones),
 * so a metadata-only sync never wipes earlier research.
 */
async function upsertIpo(db: Pool, ipo: IpoRow, research: Research | null): Promise<void> {
  await db.query(
    `insert into ipos (
       symbol, company_name, exchange, category, status, price_band, lot_size, issue_size_crores,
       open_date, close_date, allotment_date, listing_date, gmp_amount, subscription_rate, raw_data,
       ai_research, ai_rating, ai_verdict, ai_researched_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       $16,$17,$18, case when $16::jsonb is null then null else now() end, now()
     )
     on conflict (symbol) do update set
       company_name      = excluded.company_name,
       exchange          = coalesce(excluded.exchange, ipos.exchange),
       category          = excluded.category,
       status            = excluded.status,
       price_band        = excluded.price_band,
       lot_size          = excluded.lot_size,
       issue_size_crores = excluded.issue_size_crores,
       open_date         = excluded.open_date,
       close_date        = excluded.close_date,
       allotment_date    = excluded.allotment_date,
       listing_date      = excluded.listing_date,
       gmp_amount        = excluded.gmp_amount,
       subscription_rate = excluded.subscription_rate,
       raw_data          = excluded.raw_data,
       ai_research       = coalesce(excluded.ai_research, ipos.ai_research),
       ai_rating         = case when excluded.ai_research is not null then excluded.ai_rating  else ipos.ai_rating  end,
       ai_verdict        = case when excluded.ai_research is not null then excluded.ai_verdict else ipos.ai_verdict end,
       ai_researched_at  = coalesce(excluded.ai_researched_at, ipos.ai_researched_at),
       updated_at        = now()`,
    [
      ipo.symbol,
      ipo.companyName,
      ipo.exchange ?? research?.listing_exchange ?? null,
      ipo.category,
      ipo.status,
      ipo.priceBand,
      ipo.lotSize,
      ipo.issueSizeCrores,
      ipo.openDate,
      ipo.closeDate,
      ipo.allotmentDate,
      ipo.listingDate,
      ipo.gmpAmount,
      ipo.subscriptionRate,
      JSON.stringify(ipo.raw),
      research ? JSON.stringify({ ...research, generated_at: new Date().toISOString(), model: MODEL, provider: AI_PROVIDER }) : null,
      research?.rating_score ?? null,
      research?.verdict_tag ?? null,
    ],
  );
}

/**
 * Moves IPOs between sections using their dates, with NO API call: an IPO whose close date has passed becomes CLOSED,
 * and an UPCOMING IPO whose window has started becomes OPEN. Dates are compared in Indian time.
 * This is what keeps the "closed" section right when the data provider stops listing a finished IPO as open
 * (and on the provider's free plan, which cannot list closed IPOs at all). Returns how many rows changed.
 */
async function rollOverStatuses(db: Pool): Promise<number> {
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  const closed = await db.query(
    `update ipos set status = 'CLOSED', updated_at = now()
       where status in ('OPEN','UPCOMING') and close_date is not null and close_date < ${today}`,
  );
  const opened = await db.query(
    `update ipos set status = 'OPEN', updated_at = now()
       where status = 'UPCOMING' and open_date is not null and open_date <= ${today}
         and (close_date is null or close_date >= ${today})`,
  );
  return (closed.rowCount ?? 0) + (opened.rowCount ?? 0);
}

/* ------------------------------------------------------------------------------------------------
 * Which IPOs get fresh research this run
 * ---------------------------------------------------------------------------------------------- */

function pickForResearch(rows: IpoRow[], existing: Map<string, ExistingState>, now = Date.now()): IpoRow[] {
  const rank: Record<Status, number> = { OPEN: 0, UPCOMING: 1, CLOSED: 2 };
  const ttlMs = RESEARCH_TTL_HOURS * 3_600_000;

  return rows
    .filter((r) => {
      const e = existing.get(r.symbol);
      return !e?.hasResearch || !e.researchedAt || now - e.researchedAt.getTime() > ttlMs;
    })
    .sort((a, b) => {
      const aNever = existing.get(a.symbol)?.hasResearch ? 1 : 0;
      const bNever = existing.get(b.symbol)?.hasResearch ? 1 : 0;
      return aNever - bNever || rank[a.status] - rank[b.status] || (a.openDate ?? '9999').localeCompare(b.openDate ?? '9999');
    });
}

/* ------------------------------------------------------------------------------------------------
 * Auth + handler
 * ---------------------------------------------------------------------------------------------- */

function isAuthorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const started = Date.now();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET is not configured on the server' }, { status: 500 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const warnings: string[] = [];
  const failures: Array<{ symbol: string; error: string }> = [];

  try {
    const budgetMs = (numEnv('SYNC_TIME_BUDGET_SECONDS', maxDuration - 40)) * 1000;
    const deadline = started + budgetMs;

    // 1. Fetch + normalise
    const { rows, counts } = await loadIpoRows(warnings);

    // 2. Save metadata for everything first, so the listing is fresh even if research runs out of time
    const db = getPool();
    const rolledOver = await rollOverStatuses(db);
    const existing = await loadExisting(db, rows.map((r) => r.symbol));
    for (const row of rows) await upsertIpo(db, row, null);

    // 3. AI research for the IPOs that need it (bounded by count and by time)
    const needResearch = pickForResearch(rows, existing);
    const queue = needResearch.slice(0, MAX_RESEARCH_PER_RUN);
    let researched = 0;

    if (queue.length > 0) {
      const keyName = AI_PROVIDER === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
      if (!process.env[keyName]) {
        warnings.push(`${keyName} is not set; AI research skipped`);
      } else {
        const client = AI_PROVIDER === 'claude' ? new Anthropic({ maxRetries: 1, timeout: 150_000 }) : null;
        for (const ipo of queue) {
          if (deadline - Date.now() < MIN_TIME_FOR_RESEARCH_MS) {
            warnings.push(`stopped early: not enough time left to research ${ipo.symbol}; it will be picked up next run`);
            break;
          }
          try {
            const research = await researchIpo(client, ipo, deadline);
            await upsertIpo(db, ipo, research);
            researched++;
          } catch (e) {
            failures.push({ symbol: ipo.symbol, error: (e as Error).message });
          }
        }
      }
    }

    console.log(`[sync-ipos] processed=${rows.length} researched=${researched} failures=${failures.length} ms=${Date.now() - started}`);
    return NextResponse.json({
      success: true,
      provider: AI_PROVIDER,
      model: MODEL,
      grounded: GROUNDED,
      processedCount: rows.length,
      statusRollovers: rolledOver, // IPOs moved to CLOSED/OPEN from their dates, no API call
      researchedCount: researched,
      researchBacklog: needResearch.length - researched, // IPOs still waiting for fresh research after this run
      fetched: counts,
      failures,
      warnings,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error('[sync-ipos] failed:', message);
    const hint = /relation "ipos" does not exist/.test(message) ? ' (run db/migrations/003_ipos_ai_pipeline.sql in Neon)' : '';
    return NextResponse.json({ success: false, error: message + hint, warnings, failures, durationMs: Date.now() - started }, { status: 500 });
  }
}
