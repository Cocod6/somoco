// Somoco — the one-line explanation attached to a resolution
//
// The receipt columns (schema.sql, 2026-08-18) give a resolution somewhere to
// say WHY. This writes that sentence so the resolver doesn't have to, and so
// every resolution reads the same way instead of depending on who was typing.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE THAT MATTERS MORE THAN THE PROSE:
//
// This model is told the claim, the outcome, and the named source. It is NOT
// told what actually happened — it has no feed, no browsing, no knowledge of
// the event. So it must never add a fact: no dates the claim didn't carry, no
// prices, no scores, no "after trading above $150,000 in November". Those
// details would be invented, and a receipt that invents its evidence is worse
// than no receipt at all — it manufactures the exact confidence the receipt
// exists to justify.
//
// It restates. The source link is what carries the proof.
//
// FAILS OPEN: any error returns null and the caller stores no note. A missing
// sentence costs a nicety; blocking a resolution that already happened
// on-chain would cost far more.

const ANTHROPIC_API_KEY = () => process.env.ANTHROPIC_API_KEY ?? ''
const AI_BASE_URL = 'https://api.anthropic.com'
const MODEL = 'claude-haiku-4-5'

export type SentenceOutcome = 'resolved_true' | 'resolved_false' | 'voided'

export interface SentenceInput {
  subject: string
  claim: string
  condition: string | null
  outcome: SentenceOutcome
  /** Where it can be checked, when there is one. */
  sourceUrl?: string | null
  /** Named authority from the resolution plan, e.g. "France Football". */
  sourceName?: string | null
  /**
   * For a void, WHY it collapsed — the one thing no model can infer. Without
   * it a void gets a neutral template rather than an invented reason.
   */
  humanReason?: string | null
}

const SENTENCE_PROMPT = `You write the single sentence that explains how a prediction market settled. It is shown to people who staked money on it.

You will be told the prediction, the outcome, and the source. You will NOT be told what actually happened in the world, and you must not pretend otherwise.

ABSOLUTE RULES:
- Invent NOTHING. No dates, prices, scores, names, events or details that are not in the input. If you do not know a specific, do not mention it.
- Restate the claim and the outcome, and name the source if one is given. That is all.
- One sentence. Plain English. No more than 30 words.
- Write about the claim in the past tense, as a settled matter.
- Never editorialise, congratulate, apologise, or address the reader.
- Do not start with "This prediction" — start with the subject of the claim.

Outcome meanings:
- resolved_true: the claim happened as stated.
- resolved_false: the claim did not happen. Silence counts as not happening.
- voided: the question could no longer be settled and every stake was refunded in full. If a reason is supplied, use it; if not, say only that it could no longer be settled and stakes were refunded. NEVER say the source refunded the stakes — the source only publishes outcomes; the refund is the market's own doing. Prefer the passive: "stakes were refunded".

Reply with the sentence and nothing else — no quotes, no preamble, no JSON.`

/** The neutral fallback for a void with no human reason given. */
const VOID_TEMPLATE =
  'Voided — this question could no longer be settled, and every stake was refunded in full.'

/**
 * Writes the sentence. Returns null if the AI is unavailable or misbehaves,
 * except for voids, which always have an honest template to fall back on.
 */
export async function writeResolutionSentence(input: SentenceInput): Promise<string | null> {
  const fallback = input.outcome === 'voided' ? VOID_TEMPLATE : null

  if (!ANTHROPIC_API_KEY()) return fallback

  const described = [
    `Prediction: ${input.subject} ${input.claim}${input.condition ? ` ${input.condition}` : ''}`,
    `Outcome: ${input.outcome}`,
    input.sourceName ? `Source: ${input.sourceName}` : null,
    input.sourceUrl ? `Source link: ${input.sourceUrl}` : null,
    input.humanReason ? `Reason given by the resolver: ${input.humanReason}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const res = await fetch(`${AI_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        // One sentence. A long answer is a wrong answer here.
        max_tokens: 150,
        system: SENTENCE_PROMPT,
        messages: [{ role: 'user', content: described }],
      }),
    })

    if (!res.ok) {
      console.error('resolution sentence HTTP error:', (await res.text()).slice(0, 200))
      return fallback
    }

    const json = await res.json()
    const text: string = json?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    const sentence = text.trim().replace(/^["']|["']$/g, '')

    // A refusal, an empty answer or an essay all mean the same thing here:
    // don't store it. The column stays null and the UI says so plainly.
    if (!sentence || sentence.length > 400) return fallback

    return sentence
  } catch (err) {
    console.error('resolution sentence request failed:', err)
    return fallback
  }
}
