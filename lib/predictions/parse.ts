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
import { getResolutionRule, rulesForPrompt } from '@/lib/predictions/resolutionRules'
import type { ParsedPrediction, ResolutionPlan } from '@/lib/predictions/types'

const ANTHROPIC_API_KEY = () => process.env.ANTHROPIC_API_KEY ?? ''
// Real Anthropic Messages API (console.anthropic.com), wired 2026-07-22.
// Auth is the x-api-key header (Bearer is only for OAuth tokens).
// Haiku 4.5 — cheap + fast, ideal for this structured-extraction parse.
const AI_BASE_URL = 'https://api.anthropic.com'
const MODEL = 'claude-haiku-4-5'
// Set USE_FAKE_PARSER=true in .env.local to test without spending any AI credit.
const fakeParserEnabled = () => process.env.USE_FAKE_PARSER === 'true'

export function buildPrompt(text: string, todayISO: string, userResolutionNote: string): string {
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

Resolution plan rules — these are the preset sources per category:
${rulesForPrompt()}

Using the category's preset rule as the default, and incorporating the user's resolution note if provided, write a precise, readable resolution criteria (state the exact source, threshold, and deadline). If no clear authoritative source exists for this prediction, set needsReview=true and explain why in reviewReason. Remember: the criteria is a contract, not a headline — be unambiguous about edge cases.
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
  parsed: Pick<ParsedPrediction, 'subject' | 'claim' | 'condition'>
): ResolutionPlan {
  const rule = getResolutionRule(category)
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const method = RESOLUTION_METHODS.includes(candidate.method as typeof RESOLUTION_METHODS[number])
    ? (candidate.method as ResolutionPlan['method'])
    : rule.method

  const sources =
    Array.isArray(candidate.sources) && candidate.sources.every(s => typeof s === 'string') && candidate.sources.length > 0
      ? (candidate.sources as string[])
      : rule.defaultSources

  const criteria =
    typeof candidate.criteria === 'string' && candidate.criteria.trim()
      ? candidate.criteria.trim()
      : `Resolves YES if "${parsed.subject} ${parsed.claim} ${parsed.condition}" is confirmed by ${sources[0]}; otherwise resolves NO on the resolution date.`

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
  todayISO = new Date().toISOString().slice(0, 10)
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
        max_tokens: 900,
        messages: [{ role: 'user', content: buildPrompt(text, todayISO, userResolutionNote) }],
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
    parsed
  )

  return { parsed, resolutionPlan }
}
