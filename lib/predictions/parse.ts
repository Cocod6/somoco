// Somoco — prediction parsing engine
//
// Extracted from app/api/parse-prediction/route.ts so it can be called from
// server code as well as from the HTTP route. The route is now a thin wrapper
// around parsePredictionText(); its request/response shape is unchanged.
//
// The Polymarket mirror needs this: a raw market question ("Will Apple be the
// largest company in the world by market cap on December 31?") has to become a
// claim in Somoco's house voice ("is the largest company in the world"). A
// regex can't do that — stripping "Will" leaves an infinitive, and conjugating
// the first word blindly turns "traffic returns to normal" into "traffics".

import { CATEGORY_IDS, categorizeText, normalizeCategory } from '@/lib/predictions/categories'
import { fakeParsePrediction } from '@/lib/predictions/fakeParser'
import {
  authorityHintForPrompt,
  DEADLINE_CONVENTION,
  getResolutionRule,
  resolveSources,
  rulesForPrompt,
  VOID_CLAUSE,
} from '@/lib/predictions/resolutionRules'
import type { ParsedPrediction, ResolutionPlan } from '@/lib/predictions/types'

const ANTHROPIC_API_KEY = () => process.env.ANTHROPIC_API_KEY ?? ''
// Real Anthropic Messages API (console.anthropic.com), wired 2026-07-22.
// Auth is the x-api-key header (Bearer is only for OAuth tokens).
// Haiku 4.5 — cheap + fast, ideal for this structured-extraction parse.
const AI_BASE_URL = 'https://api.anthropic.com'
const MODEL = 'claude-haiku-4-5'
// Set USE_FAKE_PARSER=true in .env.local to test without spending any AI credit.
const fakeParserEnabled = () => process.env.USE_FAKE_PARSER === 'true'

/**
 * Replaces the whole resolution-plan section of the prompt for PVP markets.
 *
 * A public market has to be settleable by an authority nobody controls, so the
 * parser is right to refuse "Seyi eats beans before 4pm" — no newspaper will
 * ever report it. A PVP market inverts that: the people betting are the ones
 * who were there, and they settle it by voting. Judging a friend bet against
 * INEC and the Central Bank is the wrong question, and flagging it "not
 * resolvable" is actively wrong — it is resolvable, just not by us.
 */
const PVP_RESOLUTION_RULES = `Resolution plan rules — THIS IS A PVP (FRIEND) MARKET:

This market is settled by the people invited to it, who vote on what happened. Somoco does not resolve it and no outside authority is involved.

Therefore:
- NEVER set needsReview=true because no public/authoritative source exists. There is not supposed to be one. Only set needsReview=true if the claim is genuinely incoherent — not merely private, small, personal, unverifiable by media, or trivial.
- NEVER ask the user to pick something "publicly observable instead". Private, personal and unobservable-by-media events are exactly what this feature is for: what someone ate, who arrived late, who wins a game between friends.
- Set method to "human_review" and sources to ["the people invited to this market"].
- Write criteria as the plain, physical thing the group will vote on, so everyone knows what they are voting about. Name the observable event and the deadline in UTC. Do not name any news outlet, governing body, data feed or institution.
- Do not add a VOID clause about missing confirmation. If the group cannot agree, their named judge decides; that is already handled and is not the criteria's job.

Example criteria for "Seyi Tinubu eats beans before 4pm today": "Resolves YES if Seyi Tinubu eats beans at any point before 16:00 UTC on the resolution date, as agreed by the people invited to this market."`

export function buildPrompt(
  text: string,
  todayISO: string,
  userResolutionNote: string,
  pvp = false
): string {
  return `You are the parsing engine for Somoco, a prediction app built on the Intuition protocol.

Today's date is ${todayISO}.

Parse the user's free-text prediction into a structured claim. Respond with ONLY a JSON object — no markdown fences, no extra text. The JSON must have exactly these keys:

{
  "subject": "the entity the prediction is about — short, canonical, reusable name (e.g. 'Bitcoin', 'Arsenal FC', 'Ethereum')",
  "claim": "what is being claimed about the subject — short verb phrase in the third person, as if stating it as fact (e.g. 'reaches $150K', 'wins the Premier League', 'is the largest company in the world'). NEVER start with 'will' and NEVER use the bare infinitive ('be', 'win', 'increase') — write 'is', 'wins', 'increases'.",
  "condition": "the timeframe or condition (e.g. 'before December 2026') — empty string if none stated",
  "category": "the single best-fitting category id from this exact list: ${CATEGORY_IDS.join(', ')}. Use 'football' for association football/soccer, 'sports' for all other sports, 'crypto' for cryptocurrencies/blockchain, 'tech' for tech & AI, 'culture' for movies/music/entertainment, 'other' only if nothing fits.",
  "resolutionDate": "ISO date YYYY-MM-DD when this can be judged true or false. Infer from the text relative to today. If you cannot infer any date, use null.",
  "needsClarification": true or false — only true if resolutionDate is null,
  "clarificationQuestion": "a short friendly question asking when the prediction should be checked — or null if not needed",
  "resolutionPlan": {
    "method": "one of: automated_feed, named_source, human_review",
    "sources": ["the specific data source(s) this will be checked against"],
    "criteria": "the exact, readable true/false condition",
    "needsReview": true or false,
    "reviewReason": "why it needs manual review — or null"
  }
}

Rules:
- A month with no year (e.g. 'before December') means the NEXT occurrence of that month from today.
- 'end of the year' means December 31 of the current year.
- 'end of Q3' means September 30. 'end of Q4' means December 31.
- Keep subject as the most canonical, reusable name — it gets matched against an existing knowledge graph.
- The subject + claim + condition must read as a grammatical English sentence when joined with spaces. Read it back before answering.
- If the input is not a prediction at all, set needsClarification to true and use clarificationQuestion to explain that a prediction is needed.
${pvp ? '- Do NOT use needsClarification to push the user toward a more public or more verifiable prediction. A private, personal or trivial claim is valid here. Only ask for clarification if you genuinely cannot tell WHEN it should be judged.\n' : ''}
${pvp ? PVP_RESOLUTION_RULES : `Resolution plan rules — these are the preset sources per category:
${rulesForPrompt()}
${authorityHintForPrompt(text)}`}

${pvp ? '' : `Using the category's preset rule as the default, and incorporating the user's resolution note if provided, write a precise, readable resolution criteria. Every criteria you write MUST do all four of these:
1. Name the specific authority — "official information from UEFA", never "the official league".
2. State the threshold or the exact observable event that settles it.
3. State the deadline as ${DEADLINE_CONVENTION}. Never use ET or any local timezone.
4. End with an explicit VOID sentence covering the case where the question becomes unanswerable. Use this test to tell VOID and NO apart, and get it right — it decides who keeps real money:
   - The thing simply did not happen, and it had a fair chance to → resolves NO. Silence is a NO. "Arsenal did not win", "the subsidy was never removed", "the price never reached $150K" are all NO, not void. Do NOT write "if no confirmation is published, the market is voided" for a claim like this — the absence of the event IS the answer.
   - The question itself collapsed and can no longer be asked → VOID and refund every stake. The match was cancelled, the election never ran, the competition was abandoned, the exchange delisted the pair, the metric turned out to be undefined or unmeasurable. Nobody was right or wrong, so nobody should win money.

Then work through the category's "must state" list and answer every item that applies. If no authoritative source can settle this prediction at all, set needsReview=true and explain why in reviewReason. Remember: the criteria is a contract, not a headline — if two people who disagree could both read it as supporting them, rewrite it.`}
${userResolutionNote ? `\nThe user's resolution note: "${userResolutionNote}"` : ''}

User's prediction: "${text}"`
}

const RESOLUTION_METHODS = ['automated_feed', 'named_source', 'human_review'] as const

/**
 * Builds the final ResolutionPlan from whatever the AI returned, filling any
 * missing/invalid field from the category's preset rule so the plan is always
 * complete. Also the whole plan for the fake parser (pass raw = undefined).
 */
export function finalizeResolutionPlan(
  raw: unknown,
  category: string,
  parsed: Pick<ParsedPrediction, 'subject' | 'claim' | 'condition'>,
  pvp = false
): ResolutionPlan {
  const rule = getResolutionRule(category)
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  // PVP markets are settled by the invited voters, so the source registry and
  // the needs-review flag simply do not apply. Enforced here rather than left
  // to the prompt: the model still occasionally reaches for a public authority
  // out of habit, and a friend bet flagged "not resolvable" in the UI is a
  // straight lie — the group resolving it is the entire mechanism.
  if (pvp) {
    const predictionText = `${parsed.subject} ${parsed.claim} ${parsed.condition ?? ''}`.trim()
    const offered = typeof candidate.criteria === 'string' ? candidate.criteria.trim() : ''
    // Keep the model's criteria only if it actually wrote one. A refusal —
    // "Not resolvable.", "no credible source could settle this" — is written
    // for a public market and is simply false here, so it falls back to the
    // template rather than being shown to a group who can obviously settle it.
    const isRefusal =
      offered.length < 25 ||
      /not resolvable|cannot be (settled|resolved|verified)|no (credible|public|reliable|authoritative)\s+\w*\s*source|should be voided/i.test(offered)
    const criteria = isRefusal
      ? `Resolves YES if "${predictionText}" turns out to be true, as agreed by the people invited to this market.`
      : offered
    return {
      method: 'human_review',
      sources: ['the people invited to this market'],
      criteria,
      needsReview: false,
      reviewReason: null,
    }
  }

  const method = RESOLUTION_METHODS.includes(candidate.method as typeof RESOLUTION_METHODS[number])
    ? (candidate.method as ResolutionPlan['method'])
    : rule.method

  // Falls back to Somoco's own source registry rather than the category default
  // alone — resolveSources() matches the prediction's text against the named
  // authorities in resolutionRules.ts, so a Ballon d'Or prediction gets France
  // Football rather than a generic "the competition's governing body".
  const predictionText = `${parsed.subject} ${parsed.claim} ${parsed.condition ?? ''}`
  const sources =
    Array.isArray(candidate.sources) && candidate.sources.every(s => typeof s === 'string') && candidate.sources.length > 0
      ? (candidate.sources as string[])
      : resolveSources(predictionText, category)

  // The templated fallback is what the fake parser ships and what a malformed
  // AI response degrades to, so it carries the same conventions the prompt asks
  // for: a named source, a UTC deadline, and void (not NO) when undeterminable.
  const criteria =
    typeof candidate.criteria === 'string' && candidate.criteria.trim()
      ? candidate.criteria.trim()
      : `Resolves YES if "${predictionText.trim()}" is confirmed by ${sources[0]} by ${DEADLINE_CONVENTION}; otherwise resolves NO. ${VOID_CLAUSE}`

  const needsReview = Boolean(candidate.needsReview)
  const reviewReason = needsReview
    ? (typeof candidate.reviewReason === 'string' && candidate.reviewReason.trim()
        ? candidate.reviewReason.trim()
        : 'No clear authoritative resolution source identified.')
    : null

  return { method, sources, criteria, needsReview, reviewReason }
}

/** Thrown for conditions the HTTP route reports with a specific status code. */
export class ParseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export interface ParseResult {
  parsed: ParsedPrediction
  resolutionPlan: ResolutionPlan
}

/**
 * Turns free text into a structured claim. Throws ParseError with the status
 * the caller should report; every other failure is a genuine 500.
 */
export async function parsePredictionText(
  text: string,
  userResolutionNote = '',
  todayISO = new Date().toISOString().slice(0, 10),
  pvp = false
): Promise<ParseResult> {
  if (!text.trim()) throw new ParseError('Please type a prediction first.', 400)

  const fake = fakeParserEnabled()
  if (!fake && !ANTHROPIC_API_KEY()) {
    throw new ParseError(
      'ANTHROPIC_API_KEY is missing from .env.local — add it and restart the dev server.',
      500
    )
  }

  // The AI response carries the parse fields plus a raw resolutionPlan that
  // gets validated/completed by finalizeResolutionPlan below.
  let parsedFields: Omit<ParsedPrediction, 'originalText'> & { resolutionPlan?: unknown }

  if (fake) {
    parsedFields = fakeParsePrediction(text, todayISO)
  } else {
    const aiRes = await fetch(`${AI_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        // Raised from 900 on 2026-08-11: criteria now have to name an
        // authority, pin the edge cases in the category's "must state" list,
        // and carry a void clause. Good criteria run long, and a truncated
        // response silently degrades to the generic template in
        // finalizeResolutionPlan() — which is exactly what we're moving away from.
        max_tokens: 1600,
        messages: [{ role: 'user', content: buildPrompt(text, todayISO, userResolutionNote, pvp) }],
      }),
    })

    if (!aiRes.ok) {
      const detail = await aiRes.text()
      throw new ParseError(`AI parser error: ${detail.slice(0, 200)}`, 502)
    }

    const aiJson = await aiRes.json()
    const rawText: string =
      aiJson?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''

    // Strip fences and any stray prose around the JSON object — take the
    // outermost {...} span so a chatty response still parses.
    const cleaned = rawText.replace(/```json|```/g, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    const jsonSlice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned

    let candidate: unknown
    try {
      candidate = JSON.parse(jsonSlice)
    } catch {
      candidate = null
    }
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new ParseError(
        `Could not read the AI response. Raw response was: ${rawText.slice(0, 400) || '(empty)'}`,
        502
      )
    }
    parsedFields = candidate as Omit<ParsedPrediction, 'originalText'> & { resolutionPlan?: unknown }
  }

  const parsed: ParsedPrediction = {
    subject: parsedFields.subject ?? '',
    claim: parsedFields.claim ?? '',
    condition: parsedFields.condition ?? '',
    category: '', // set below, once condition fallback has run
    resolutionDate: parsedFields.resolutionDate ?? null,
    needsClarification: Boolean(parsedFields.needsClarification),
    clarificationQuestion: parsedFields.clarificationQuestion ?? null,
    originalText: text,
  }

  // If no condition was stated, fall back to the resolution date instead of
  // leaving it blank — "by 2026-12-31" is far more useful on the graph than
  // a generic placeholder, and doing this BEFORE the dedup check in the route
  // means the search and the actual on-chain creation use the same text.
  if (!parsed.condition && parsed.resolutionDate) {
    parsed.condition = `by ${parsed.resolutionDate}`
  } else if (!parsed.condition) {
    parsed.condition = 'no condition'
  }

  // Category: trust the AI's classification when it's a known id; otherwise
  // keyword-derive from the final text.
  parsed.category =
    normalizeCategory(parsedFields.category) ??
    categorizeText(`${parsed.subject} ${parsed.claim} ${parsed.condition}`)

  const resolutionPlan = finalizeResolutionPlan(
    fake ? undefined : parsedFields.resolutionPlan,
    parsed.category,
    parsed,
    pvp
  )

  // A PVP market has no public source to point at, so the only clarification
  // worth asking for is WHEN to judge it. Anything else the model came back
  // with — "pick something publicly observable instead" — is advice for a
  // market this isn't, and it reads to the user as a rejection.
  if (pvp && parsed.resolutionDate) {
    parsed.needsClarification = false
    parsed.clarificationQuestion = null
  }

  return { parsed, resolutionPlan }
}
