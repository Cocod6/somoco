// Somoco — the AI half of auto-approval
//
// autoApprove.ts checks that a prediction is STRUCTURALLY sound: it names an
// authority, states a UTC deadline, has a void clause, resolves far enough out.
// It says so itself that it has one blind spot, and it is the dangerous one:
//
//   "nothing here judges whether a prediction is APPROPRIATE — a well-formed
//    market about something harmful passes all ten checks."
//
// A market inviting people to bet on when a named private person dies is
// perfectly well-formed. So is a market designed to harass someone. Those are
// exactly what the human click was really for, and they are what this module
// screens, so approval can happen in seconds instead of whenever Coco is at a
// laptop.
//
// FAILS CLOSED. If the API key is missing, the request errors, or the answer
// can't be parsed, the verdict is `hold` — the prediction waits for a human.
// This is the opposite of resolutionSentence.ts, which fails open to null: a
// missing sentence costs a nicety, a missing screen would publish unread.

import type { ResolutionPlan } from '@/lib/predictions/types'

const ANTHROPIC_API_KEY = () => process.env.ANTHROPIC_API_KEY ?? ''
const AI_BASE_URL = 'https://api.anthropic.com'
// Same model the parser uses (Coco's call — cheap and fast, and this is a
// short classification, the task Haiku is best value at).
const MODEL = 'claude-haiku-4-5'

export interface ScreenInput {
  subject: string
  claim: string
  condition: string | null
  category: string | null
  resolutionDate: string | null
  resolutionPlan: ResolutionPlan | null
}

export interface ScreenResult {
  /** True only when the screen positively cleared it. Never true on error. */
  clear: boolean
  /** Why it was held. Empty when clear. Written to be shown to Coco. */
  reason: string
  /** Distinguishes "the model held this" from "the screen could not run". */
  ranClean: boolean
}

/** The house rules. Deliberately about HARM and COHERENCE, not taste. */
const SCREEN_PROMPT = `You are the publication screen for Somoco, a prediction market. A prediction has already passed automated structural checks (it names a source, has a deadline and settlement criteria). Your ONLY job is to decide whether publishing it without a human reading it would be harmful or embarrassing.

HOLD the prediction if any of these are true:
1. It is about the death, injury, illness, imprisonment or misfortune of a specific named person. (Markets on "will X resign / lose the election / be sacked" are FINE — public roles and public outcomes are the point. Death and violence are not.)
2. It targets, mocks, sexualises or invites judgement of a private individual — anyone who is not a public figure, company, team, government or public institution.
3. It encourages, coordinates or rewards anything illegal or violent.
4. It contains hate speech, harassment, or sexual content.
5. It is incoherent, spam, a test entry, or gibberish — text that is not actually a prediction anyone could bet on.
6. Its wording is so ambiguous that two reasonable people would disagree about what settles it, even after reading the criteria.
7. Whoever wrote it could single-handedly force the outcome, so betting against them is a losing game by construction.

APPROVE otherwise. Sport, politics, elections, crypto and token prices, company results, awards, weather, science, culture and ordinary public events are all normal business — do not hold something merely because it is trivial, silly, unlikely, or about money.

Answer with JSON only, no prose, no code fences:
{"verdict": "approve" | "hold", "reason": "<one short sentence, only when holding>"}`

/**
 * Screens one prediction. Never throws — every failure path returns a hold.
 */
export async function screenForAutoApproval(input: ScreenInput): Promise<ScreenResult> {
  if (!ANTHROPIC_API_KEY()) {
    return { clear: false, reason: 'AI screen unavailable (no API key) — held for a human.', ranClean: false }
  }

  const plan = input.resolutionPlan
  const described = [
    `Prediction: ${input.subject} ${input.claim}${input.condition ? ` ${input.condition}` : ''}`,
    `Category: ${input.category ?? 'unknown'}`,
    `Resolves: ${input.resolutionDate ?? 'no date'}`,
    plan?.sources?.length ? `Sources: ${plan.sources.join(', ')}` : 'Sources: none named',
    plan?.criteria ? `Settlement criteria: ${plan.criteria}` : 'Settlement criteria: none',
  ].join('\n')

  let raw: string
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
        // A verdict and one sentence. Anything longer means it ignored the format.
        max_tokens: 300,
        system: SCREEN_PROMPT,
        messages: [{ role: 'user', content: described }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('ai screen HTTP error:', detail.slice(0, 200))
      return { clear: false, reason: 'AI screen failed — held for a human.', ranClean: false }
    }

    const json = await res.json()
    raw = json?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
  } catch (err) {
    console.error('ai screen request failed:', err)
    return { clear: false, reason: 'AI screen failed — held for a human.', ranClean: false }
  }

  // Same defensive extraction the parser uses: take the outermost {...} so a
  // chatty answer still parses.
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  let parsed: { verdict?: unknown; reason?: unknown } | null = null
  try {
    parsed = JSON.parse(start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned)
  } catch {
    parsed = null
  }

  // An unreadable answer is not an approval. Only the literal word clears it —
  // anything else, including a missing verdict, holds.
  if (!parsed || parsed.verdict !== 'approve') {
    const reason = typeof parsed?.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 300)
      : 'Held by the AI screen.'
    return { clear: false, reason, ranClean: parsed !== null }
  }

  return { clear: true, reason: '', ranClean: true }
}
