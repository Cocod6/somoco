// Somoco — Polymarket import
//
// Pulls live markets from Polymarket's public Gamma API and maps them into the
// shape Somoco already uses (subject / claim / condition + resolution plan).
//
// WHY THIS EXISTS
// lib/predictions/resolutionRules.ts already says the quiet part out loud: the
// RULES are the contract, and badly written criteria are the #1 cause of
// disputes. An imported Polymarket market arrives with its criteria already
// written, already argued over by traders, and already bonded to UMA's
// optimistic oracle. So importing a market imports the hard part for free.
//
// It also closes the loop that Somoco could not close alone: because each
// imported prediction keeps a pointer back to its source market, settlement can
// READ Polymarket's outcome instead of asking a human to judge it. See
// readPolymarketOutcome() at the bottom.
//
// No API key. No auth. Gamma is a public read-only endpoint.

import { categorizeText } from '@/lib/predictions/categories'
import type { ExternalResolutionRef, ResolutionPlan } from '@/lib/predictions/types'

export type { ExternalResolutionRef }

const GAMMA_API = 'https://gamma-api.polymarket.com/markets'
const POLYMARKET_EVENT_URL = 'https://polymarket.com/event'

/** The subset of Gamma's ~100 fields we actually rely on. */
interface GammaMarket {
  id: string
  question: string
  slug: string
  conditionId?: string
  description?: string
  resolutionSource?: string
  endDate?: string
  endDateIso?: string
  image?: string
  icon?: string
  /** JSON-encoded arrays, e.g. '["Yes", "No"]' — Gamma sends them as strings. */
  outcomes?: string
  outcomePrices?: string
  volume?: string
  volumeNum?: number
  volume24hr?: number
  liquidityNum?: number
  active?: boolean
  closed?: boolean
  archived?: boolean
  restricted?: boolean
  acceptingOrders?: boolean
}

/** A Polymarket market mapped into Somoco's vocabulary, ready to preview. */
export interface PolymarketDraft {
  /** Polymarket's own question, verbatim — the headline. */
  question: string
  /** Best-effort split for preview. The AI parser refines this at import time. */
  suggested: { subject: string; claim: string; condition: string }
  /** Somoco category id (politics | crypto | football | …). */
  category: string
  /** ISO YYYY-MM-DD — taken from Polymarket's end date, never guessed. */
  resolutionDate: string | null
  /** Carries Polymarket's real criteria plus the pointer used for settlement. */
  resolutionPlan: ResolutionPlan
  /** Current YES price, 0–1. This is the crowd's probability. */
  yesPrice: number | null
  /** Lifetime volume in USD — the credibility signal. Thin markets are noise. */
  volume: number
  image: string | null
  sourceUrl: string
}

/** Gamma encodes arrays as JSON strings. Returns [] rather than throwing. */
function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

/** ISO timestamp → YYYY-MM-DD, the format `predictions.resolution_date` wants. */
function toISODate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** Whole days between two YYYY-MM-DD dates. Both are UTC, so no DST drift. */
export function daysBetween(fromISODate: string, toISODateStr: string): number {
  const from = Date.parse(`${fromISODate}T00:00:00Z`)
  const to = Date.parse(`${toISODateStr}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

// Time clauses Polymarket puts at the end of a question. Longest first so
// "prior to" wins over "to", and the match is anchored to the end of the string.
// NB: 'next' and 'this' are deliberately absent. They read as time words but
// far more often begin a noun phrase — "be the next Prime Minister" got split
// into claim "be the" + condition "next Prime Minister of Ethiopia".
const CONDITION_LEAD = [
  'prior to', 'no later than', 'before the end of', 'by the end of',
  'at the end of', 'through', 'between', 'during', 'before', 'after',
  'until', 'till', 'by', 'in', 'on',
]

/**
 * Best-effort split of "Will X do Y by Z?" into subject / claim / condition.
 *
 * Deliberately dumb and free — it runs over every market in a browse list, so
 * it must not call an AI. Its job is a readable preview; the real split happens
 * at import time through /api/parse-prediction, which is already proven.
 */
export function splitQuestion(question: string, fallbackDate: string | null): {
  subject: string
  claim: string
  condition: string
} {
  let text = question.trim().replace(/\?+$/, '').trim()
  text = text.replace(/^will\s+/i, '')

  // Pull a trailing time clause off the end, if there is one.
  let condition = ''
  for (const lead of CONDITION_LEAD) {
    const re = new RegExp(`\\s+(${lead}\\s+[^,]+)$`, 'i')
    const match = text.match(re)
    if (match) {
      condition = match[1].trim()
      text = text.slice(0, match.index).trim()
      break
    }
  }
  if (!condition) condition = fallbackDate ? `by ${fallbackDate}` : 'no condition'

  // Subject = the leading proper-noun run; claim = the rest.
  const words = text.split(/\s+/)
  const isCapitalised = (w: string | undefined) => !!w && /^[A-Z0-9$"'(]/.test(w)
  // Lowercase words that live INSIDE a name — "Strait of Hormuz", "Bank of
  // England". Only bridged when a capitalised word follows, so "Bitcoin be
  // above" doesn't swallow the verb.
  const CONNECTORS = /^(of|the|de|van|von|al|and|&)$/i

  let cut = 0
  while (cut < words.length) {
    const word = words[cut]
    if (cut === 0 && /^(the|a|an)$/i.test(word)) { cut++; continue }
    if (isCapitalised(word)) { cut++; continue }
    if (CONNECTORS.test(word) && isCapitalised(words[cut + 1])) { cut += 2; continue }
    break
  }

  // A leading article alone is not a subject ("the / price of Bitcoin be above
  // $70,000"). Extend to the first capitalised word, which is the entity the
  // question is really about — yielding "the price of Bitcoin / be above …".
  if (cut <= 1 && /^(the|a|an)$/i.test(words[0] ?? '')) {
    const firstProper = words.findIndex((w, i) => i > 0 && isCapitalised(w))
    cut = firstProper > 0 ? firstProper + 1 : Math.min(3, words.length - 1)
  }

  if (cut === 0) cut = 1
  if (cut >= words.length) cut = Math.max(1, words.length - 1)

  return {
    subject: words.slice(0, cut).join(' ') || question,
    claim: words.slice(cut).join(' ') || 'resolves YES',
    condition,
  }
}

/** Builds the resolution plan an imported market carries. */
function buildResolutionPlan(market: GammaMarket): ResolutionPlan {
  const url = `${POLYMARKET_EVENT_URL}/${market.slug}`
  const external: ExternalResolutionRef = {
    provider: 'polymarket',
    marketId: String(market.id),
    slug: market.slug,
    conditionId: market.conditionId ?? null,
    endDate: market.endDate ?? market.endDateIso ?? null,
    url,
  }

  // Polymarket's `description` IS the resolution contract — it's the text UMA
  // disputes are settled against. Prefer it verbatim over anything we'd write.
  const criteria =
    market.description?.trim() ||
    `Resolves exactly as the Polymarket market "${market.question}" resolves.`

  const sources = ['Polymarket — ' + market.slug, 'UMA Optimistic Oracle']
  if (market.resolutionSource?.trim()) sources.push(market.resolutionSource.trim())

  return {
    // Named source, not human_review: the outcome is machine-readable from
    // Gamma once the market closes. Nobody at Somoco has to adjudicate.
    method: 'named_source',
    sources,
    criteria: criteria.slice(0, 2000),
    needsReview: false,
    reviewReason: null,
    external,
  }
}

/** Maps one Gamma market into a Somoco draft. */
export function mapMarket(market: GammaMarket): PolymarketDraft {
  const resolutionDate = toISODate(market.endDate ?? market.endDateIso)
  const prices = parseJsonArray(market.outcomePrices).map(Number)
  const yesPrice = Number.isFinite(prices[0]) ? prices[0] : null
  const volume = market.volumeNum ?? Number(market.volume ?? 0) ?? 0

  return {
    question: market.question,
    suggested: splitQuestion(market.question, resolutionDate),
    // Question ONLY — never the description. Every Polymarket description opens
    // with "This market will resolve to…", and 'market' is a business keyword,
    // so including it filed the Iran invasion market under Business.
    category: categorizeText(market.question),
    resolutionDate,
    resolutionPlan: buildResolutionPlan(market),
    yesPrice,
    volume: Number.isFinite(volume) ? volume : 0,
    image: market.image ?? market.icon ?? null,
    sourceUrl: `${POLYMARKET_EVENT_URL}/${market.slug}`,
  }
}

export interface FetchOptions {
  /** How many drafts to return after filtering. Default 20, hard cap 100. */
  limit?: number
  /** Skip markets below this lifetime USD volume. Default 10,000. */
  minVolume?: number
  /** Only return this Somoco category id. */
  category?: string
  /** Case-insensitive substring match on the question. */
  search?: string
  /**
   * Skip markets resolving sooner than this many days from now. Default 0 (no
   * floor) so browsing shows everything; the mirror sets its own floor, because
   * an unattended import that lands a market resolving today gives nobody time
   * to take a position on it.
   */
  minDaysToResolution?: number
}

export interface FetchResult {
  drafts: PolymarketDraft[]
  /** Why markets were dropped — surfaced so the count is never a mystery. */
  skipped: {
    notBinary: number
    noEndDate: number
    /** Past its end date but not yet settled — Polymarket still lists these. */
    expired: number
    /** Resolves too soon to be worth importing. See minDaysToResolution. */
    tooSoon: number
    belowVolume: number
    filtered: number
  }
  /** How many raw markets Gamma returned before any filtering. */
  scanned: number
}

/**
 * Fetches open Polymarket markets and maps the usable ones.
 *
 * Only Yes/No markets are imported. Polymarket also runs pairwise markets
 * ("Cardinals vs. Yankees") whose outcomes are the two team names — those don't
 * fit a subject/claim/condition triple cleanly, so they're counted in
 * `skipped.notBinary` rather than mangled into one.
 */
export async function fetchPolymarketDrafts(options: FetchOptions = {}): Promise<FetchResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const minVolume = options.minVolume ?? 10_000
  const minDays = Math.max(options.minDaysToResolution ?? 0, 0)

  // Over-fetch: most of what Gamma returns gets filtered out below, and asking
  // for exactly `limit` would routinely come back near-empty.
  const params = new URLSearchParams({
    closed: 'false',
    active: 'true',
    archived: 'false',
    limit: '250',
    order: 'volume24hr',
    ascending: 'false',
  })

  const res = await fetch(`${GAMMA_API}?${params}`, {
    headers: { accept: 'application/json' },
    // Gamma is a live price feed; a cached response would show stale odds.
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Polymarket API returned ${res.status}`)
  }

  const raw: unknown = await res.json()
  const markets: GammaMarket[] = Array.isArray(raw) ? raw : []
  const skipped = { notBinary: 0, noEndDate: 0, expired: 0, tooSoon: 0, belowVolume: 0, filtered: 0 }
  const drafts: PolymarketDraft[] = []
  const search = options.search?.trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)

  for (const market of markets) {
    if (drafts.length >= limit) break

    const outcomes = parseJsonArray(market.outcomes).map(o => o.toLowerCase())
    if (outcomes.length !== 2 || !outcomes.includes('yes') || !outcomes.includes('no')) {
      skipped.notBinary++
      continue
    }
    if (!market.endDate && !market.endDateIso) {
      skipped.noEndDate++
      continue
    }

    const draft = mapMarket(market)

    // Polymarket keeps a market listed as open between its end date and UMA
    // settling it, so "active" markets with a past deadline are common. They're
    // useless to import: nobody can predict something whose window has closed.
    if (!draft.resolutionDate || draft.resolutionDate < today) {
      skipped.expired++
      continue
    }
    // A market that resolves today or tomorrow is technically importable and
    // practically useless: by the time it appears in the feed the window is
    // closing. `expired` above only drops dates STRICTLY in the past, which is
    // how "Bitcoin above $62,000 on August 4" got imported on August 4.
    if (minDays > 0 && daysBetween(today, draft.resolutionDate) < minDays) {
      skipped.tooSoon++
      continue
    }
    if (draft.volume < minVolume) {
      skipped.belowVolume++
      continue
    }
    if (options.category && draft.category !== options.category) {
      skipped.filtered++
      continue
    }
    if (search && !draft.question.toLowerCase().includes(search)) {
      skipped.filtered++
      continue
    }

    drafts.push(draft)
  }

  return { drafts, skipped, scanned: markets.length }
}

/**
 * Reads the settled outcome of an imported market.
 *
 * This is the payoff of keeping the pointer: an imported prediction can be
 * resolved from Polymarket's own settlement instead of an admin's judgement.
 * Returns null while the market is still open — the caller should leave the
 * prediction unresolved rather than guessing.
 *
 * Maps onto `predictions.resolution_status`: 'resolved_true' | 'resolved_false'.
 */
export async function readPolymarketOutcome(
  external: ExternalResolutionRef
): Promise<'resolved_true' | 'resolved_false' | null> {
  const res = await fetch(`${GAMMA_API}/${encodeURIComponent(external.marketId)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null

  const market = (await res.json()) as GammaMarket
  if (!market?.closed) return null

  // A closed Polymarket market prices its winning outcome at 1 and the loser at
  // 0. Anything in between means settlement is still in progress (or disputed),
  // so we report nothing rather than resolving on a mid price.
  const prices = parseJsonArray(market.outcomePrices).map(Number)
  const yes = prices[0]
  if (yes >= 0.99) return 'resolved_true'
  if (yes <= 0.01) return 'resolved_false'
  return null
}
