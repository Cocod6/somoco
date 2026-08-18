// Somoco — auto-approval assessment
//
// Approval is the gate that decides what the whole app shows publicly, and it
// currently costs Coco a manual click on every single prediction. Now that
// resolutionRules.ts gives predictions a real, named authority and a criteria
// contract, most of what that click was checking has become machine-checkable.
//
// THIS MODULE ONLY ASSESSES. It approves nothing and writes nothing. It answers
// "would this prediction be safe to approve without a human reading it?" and
// lists the reasons it wouldn't. Wiring it to the approve route is a separate,
// deliberate decision — see the three blockers in the doc comment below.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT A HUMAN APPROVAL ACTUALLY DOES TODAY (all three, not just the flag):
//   1. flips approval_status → the prediction becomes publicly visible
//   2. creates the on-chain settlement market, so people can stake on it
//   3. moderates the attached image, which goes public at the same moment
//
// Only (1) is a database write. (2) is `createMarket`, which is `onlyOwner` on
// MarketFactory and is signed in Coco's BROWSER — so anything approved by a
// server job lands in the feed with NO pool and nobody can stake on it. That is
// the same defect the Polymarket mirror had before the pool backfill. (3) has
// no machine substitute at all.
//
// Hence the rule this module encodes: a prediction can only clear automatically
// if it is structurally complete AND carries nothing that needs human eyes.
// Everything else keeps its manual click.

import { getResolutionRule, findAuthorities } from '@/lib/predictions/resolutionRules'
import type { ResolutionPlan } from '@/lib/predictions/types'

/** The minimum a prediction row needs for an assessment. */
export interface AssessableRow {
  subject: string
  claim: string
  condition: string | null
  category: string | null
  resolution_date: string | null
  resolution_plan: ResolutionPlan | null
  image_url: string | null
  creator_address: string
}

export interface AutoApprovalResult {
  /** True only if every check passed. */
  eligible: boolean
  /** Why not — empty when eligible. Written to be shown to a human. */
  blockers: string[]
  /** Passed checks, for the audit trail. */
  passed: string[]
}

/**
 * How far ahead a prediction must resolve to clear automatically. Matches the
 * mirror's `minDaysToResolution` default. A market that resolves in two days
 * has no time to attract a counterparty, and a market with one side staked is
 * a market that pays nobody.
 */
export const MIN_DAYS_TO_RESOLUTION = 7

/** Criteria shorter than this are a headline, not a contract. */
const MIN_CRITERIA_LENGTH = 80

function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = Date.UTC(y, (m || 1) - 1, d || 1)
  const today = new Date()
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - todayUTC) / 86_400_000)
}

/**
 * Does the plan name an authority Somoco actually recognises, rather than one
 * the AI invented? This is what makes the source registry load-bearing instead
 * of decorative: a plausible-sounding but unknown source is exactly the case a
 * human should look at.
 */
function namesKnownAuthority(row: AssessableRow, plan: ResolutionPlan): boolean {
  // A prediction mirrored from an external market is the STRONGEST case here,
  // not the weakest: its outcome is read mechanically by /api/settle from the
  // source that already published it, so no human judgement is involved at all.
  // Without this branch the check flagged every mirrored row as "may be
  // invented" — precisely backwards.
  if (plan.external?.provider === 'polymarket') return true

  const category = row.category ?? 'other'
  const rule = getResolutionRule(category)
  const text = `${row.subject} ${row.claim} ${row.condition ?? ''}`
  const known = [
    ...findAuthorities(text, rule.id).map(s => s.name),
    ...rule.primary.map(s => s.name),
  ].map(s => s.toLowerCase())

  // A source counts as recognised if it shares a distinctive word with one of
  // the authorities Somoco knows for this prediction. Substring matching in
  // both directions, because the AI writes "official information from UEFA
  // (uefa.com)" where the registry says "official information from UEFA".
  return plan.sources.some(source => {
    const s = source.toLowerCase()
    return known.some(k => s.includes(k) || k.includes(s) || sharesKeyword(s, k))
  })
}

/** Distinctive-word overlap, ignoring the boilerplate every source string has. */
const BOILERPLATE = new Set([
  'official', 'information', 'from', 'the', 'a', 'an', 'and', 'or', 'of', 'for',
  'source', 'sources', 'data', 'announcement', 'statement', 'results', 'result',
  'consensus', 'credible', 'reporting', 'body', 'governing', 'relevant', 'as',
  'applicable', 'its', 'leadership', 'company', 'price', 'spot',
])
function sharesKeyword(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(s.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !BOILERPLATE.has(w)))
  const wa = words(a)
  for (const w of words(b)) if (wa.has(w)) return true
  return false
}

/**
 * Is the creator judging their own outcome? "coco becomes the greatest of all
 * time" and "Somoco becomes the world's largest prediction market" both pass
 * every structural check and are both unresolvable by anyone but the person who
 * profits from the answer. Always a human decision.
 */
function isSelfReferential(row: AssessableRow): boolean {
  const subject = row.subject.toLowerCase().trim()
  const first = /^(i|me|my|we|our)\b/.test(subject)
  const house = /\b(somoco|coco)\b/.test(subject)
  const shortAddress = row.creator_address.slice(2, 8).toLowerCase()
  return first || house || subject.includes(shortAddress)
}

/**
 * Assess one prediction. Pure — no I/O, no writes.
 *
 * `openClaimKeys` is optional; pass the set of already-live claim keys to catch
 * a duplicate of an existing open market.
 */
export function assessAutoApproval(
  row: AssessableRow,
  openClaimKeys?: Set<string>
): AutoApprovalResult {
  const blockers: string[] = []
  const passed: string[] = []
  const check = (ok: boolean, pass: string, fail: string) => {
    if (ok) passed.push(pass)
    else blockers.push(fail)
  }

  // ── 1. The parts a human can't be asked to re-derive ──────────────────────
  const plan = row.resolution_plan
  if (!plan) {
    blockers.push('No resolution plan at all — nothing says how this would be judged.')
    return { eligible: false, blockers, passed }
  }

  check(!plan.needsReview, 'not flagged for review', `The parser flagged this for review: ${plan.reviewReason ?? 'no reason given'}`)

  check(
    Array.isArray(plan.sources) && plan.sources.length > 0,
    'names at least one source',
    'The resolution plan names no source.'
  )

  if (plan.sources?.length) {
    check(
      namesKnownAuthority(row, plan),
      'source matches an authority Somoco recognises',
      `Names a source Somoco does not recognise (${plan.sources[0]}) — it may be invented.`
    )
  }

  const criteria = plan.criteria?.trim() ?? ''
  check(
    criteria.length >= MIN_CRITERIA_LENGTH,
    'criteria are substantive',
    `Criteria are too thin to settle a dispute (${criteria.length} chars).`
  )
  check(/\bUTC\b/.test(criteria), 'criteria state a UTC deadline', 'Criteria do not state a UTC deadline.')
  check(
    /\bvoid(ed)?\b/i.test(criteria),
    'criteria say what happens if the question collapses',
    'Criteria never say what happens if the question becomes unanswerable.'
  )

  // ── 2. Timing ─────────────────────────────────────────────────────────────
  if (!row.resolution_date) {
    blockers.push('No resolution date — it can never be judged, and can never get a pool.')
  } else {
    const days = daysUntil(row.resolution_date)
    check(
      days >= MIN_DAYS_TO_RESOLUTION,
      `resolves in ${days} days`,
      days < 0
        ? `Resolution date already passed (${row.resolution_date}).`
        : `Resolves in ${days} days — under the ${MIN_DAYS_TO_RESOLUTION}-day minimum for a market to find a counterparty.`
    )
  }

  // ── 3. Things only a human can judge ──────────────────────────────────────
  check(!row.image_url, 'no image to moderate', 'Has an image — a person must look at it before it goes public.')

  check(
    !isSelfReferential(row),
    'outcome is not controlled by the creator',
    'The creator is the subject — they would be judging their own outcome.'
  )

  const category = row.category ?? 'other'
  check(
    category !== 'other' && category !== null,
    `category is "${category}"`,
    'Category is "other" — the catch-all, whose own rule says to flag rather than approve.'
  )

  // ── 4. Duplicates ─────────────────────────────────────────────────────────
  if (openClaimKeys) {
    const key = claimKeyFor(row.subject, row.claim)
    check(!openClaimKeys.has(key), 'not a duplicate of an open market', 'Duplicates a market that is already open.')
  }

  return { eligible: blockers.length === 0, blockers, passed }
}

/**
 * Same normalisation the Polymarket mirror uses for duplicate detection —
 * subject + claim, deliberately EXCLUDING the condition, because date-ladder
 * variants of one question differ only in the condition.
 */
export function claimKeyFor(subject: string, claim: string): string {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9$% ]+/g, ' ')
      .replace(/^(the|a|an) /, '')
      .replace(/\s+/g, ' ')
      .trim()
  return `${norm(subject)}::${norm(claim)}`
}
