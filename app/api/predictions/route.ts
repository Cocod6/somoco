// Somoco — prediction bookkeeping API
// POST /api/predictions
// Body: { rows: [{ triple_id, creator_address, subject, claim, ... }] }
//
// Writes the approval-queue records for predictions whose Triples are already
// on-chain. Runs server-side with the service-role key because RLS now blocks
// client writes (see schema.sql).
//
// The server decides approval_status and resolution_status — it deliberately
// ignores anything the client sends for those columns. That's what makes the
// Approve queue a real gate: a forged request can create a *pending* row, which
// is what submitting does anyway, but it can never self-approve.
//
// AUTO-APPROVAL (2026-08-18). Waiting for Coco to click approve meant a
// prediction could sit invisible for hours, which is a bad first experience for
// someone who just wrote one. A row is now published immediately when it clears
// BOTH gates:
//
//   1. autoApprove.ts — the structural checks (named authority, UTC deadline,
//      void clause, >= 7 days out, not a duplicate, no image, real category)
//   2. aiScreen.ts    — the harm/coherence screen, which is the part no rule
//      could express: a market on a named person's death passes every
//      structural check ever written
//
// Both must pass, and so must verifyCreator.ts — proof from the creation
// transaction that the Triple exists and the named wallet made it. Without
// that, a forged request could publish under anyone's name.
//
// All three must pass. Any one failing, or being unable to run, leaves the row
// `pending` exactly as before — the queue is still there, it just gets the hard
// cases instead of everything. Set AUTO_APPROVE=false to switch it off entirely.
//
// What this does NOT do is create the on-chain staking pool: createMarket is
// onlyOwner on MarketFactory and is signed in Coco's browser. So an
// auto-approved prediction is visible and real, and becomes stakeable when the
// pools are created from the Approve page.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { assessAutoApproval, claimKeyFor, type AssessableRow } from '@/lib/predictions/autoApprove'
import { screenForAutoApproval } from '@/lib/predictions/aiScreen'
import { verifyTripleCreator, type ReceiptCache } from '@/lib/predictions/verifyCreator'
import type { ResolutionPlan } from '@/lib/predictions/types'

/**
 * Columns added after the live DB was first created. Any of them may be absent
 * until schema.sql is re-run, and an unknown column fails the WHOLE insert —
 * the category column taught us this: the approval-queue row silently vanished
 * while the Triple was already on-chain. So we strip whichever column the error
 * names and retry, rather than losing the record.
 */
const OPTIONAL_COLUMNS = [
  'category', 'resolution_plan', 'image_url',
  'is_private', 'invited_wallets', 'judge_wallet', 'vote_window_seconds',
  // The approval receipt — who let this through and why. Same treatment as the
  // rest: if the migration hasn't run, the prediction is still saved.
  'approved_by', 'approval_note',
] as const

/** Only these columns may be set by a submitter. Everything else is server-owned. */
const ALLOWED_COLUMNS = [
  'triple_id',
  'creator_address',
  'subject',
  'claim',
  'condition',
  'category',
  'resolution_date',
  'resolution_plan',
  'image_url',
  // Friend-market request. Safe for a submitter to set: it only asks to be kept
  // out of the public feed and names who they want voting. The jury that
  // actually decides the money is registered on-chain by the admin at approval.
  'is_private',
  'invited_wallets',
  'judge_wallet',
  'vote_window_seconds',
] as const

/** Strips any client-supplied column that isn't submitter-owned. */
function sanitize(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const col of ALLOWED_COLUMNS) {
    if (col in row) clean[col] = row[col]
  }
  return clean
}

/** Off switch. Auto-approval is ON unless explicitly disabled. */
const autoApproveEnabled = () => process.env.AUTO_APPROVE !== 'false'

/**
 * Claims already live and unresolved, so a second identical market can't be
 * published automatically. Same shape the mirror uses. Best-effort: if this
 * read fails we skip the duplicate check rather than refuse every submission.
 */
async function loadOpenClaimKeys(db: ReturnType<typeof supabaseAdmin>): Promise<Set<string> | undefined> {
  const { data, error } = await db
    .from('predictions')
    .select('subject, claim')
    .in('approval_status', ['approved', 'pending'])
    .eq('resolution_status', 'unresolved')
  if (error || !data) return undefined
  return new Set(data.map(r => claimKeyFor(String(r.subject ?? ''), String(r.claim ?? ''))))
}

/** What the server decided about one submitted row. */
interface ApprovalDecision {
  approval_status: 'approved' | 'pending'
  approved_by: string | null
  approval_note: string | null
}

const HELD = (note: string): ApprovalDecision => ({
  approval_status: 'pending',
  approved_by: null,
  approval_note: note,
})

/**
 * Decides whether a submitted prediction may go live without a human.
 *
 * Order matters: the free structural checks run first and most rejections stop
 * there, then the on-chain creator check, so the paid AI call only happens for
 * predictions that are otherwise ready — and never for a forged one. Everything here fails towards `pending` — the queue is the safe state.
 */
async function decideApproval(
  row: Record<string, unknown>,
  openClaimKeys: Set<string> | undefined,
  receipts: ReceiptCache
): Promise<ApprovalDecision> {
  if (!autoApproveEnabled()) return HELD('Auto-approval is switched off (AUTO_APPROVE=false).')

  // A friend market's jury has to be registered on-chain by the admin at
  // approval time, so publishing one automatically would produce exactly the
  // silent, juryless market the PvP date bug already caused once.
  if (row.is_private === true) return HELD('Friend market — the jury is registered by hand at approval.')

  const assessable: AssessableRow = {
    subject: String(row.subject ?? ''),
    claim: String(row.claim ?? ''),
    condition: (row.condition as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    resolution_date: (row.resolution_date as string | null) ?? null,
    resolution_plan: (row.resolution_plan as ResolutionPlan | null) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    creator_address: String(row.creator_address ?? ''),
  }

  const assessment = assessAutoApproval(assessable, openClaimKeys)
  if (!assessment.eligible) return HELD(assessment.blockers.join(' '))

  // tx_hash is read from the raw row: it is proof, not a column, so sanitize()
  // drops it before the insert.
  const creator = await verifyTripleCreator(
    String(row.triple_id ?? ''), assessable.creator_address, row.tx_hash, receipts
  )
  if (!creator.verified) return HELD(creator.reason)

  const screen = await screenForAutoApproval({
    subject: assessable.subject,
    claim: assessable.claim,
    condition: assessable.condition,
    category: assessable.category,
    resolutionDate: assessable.resolution_date,
    resolutionPlan: assessable.resolution_plan,
  })
  if (!screen.clear) return HELD(screen.reason)

  return {
    approval_status: 'approved',
    approved_by: 'auto',
    approval_note: `Auto-approved: ${assessment.passed.join('; ')}.`,
  }
}

export async function POST(request: Request) {
  let body: { rows?: Record<string, unknown>[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No prediction rows supplied.' }, { status: 400 })
  }

  // Minimum viable record — without these the row is useless for the queue.
  for (const row of rows) {
    if (!row.triple_id || !row.creator_address || !row.subject || !row.claim) {
      return NextResponse.json(
        { error: 'Each row needs triple_id, creator_address, subject and claim.' },
        { status: 400 }
      )
    }
  }

  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Database unavailable.' },
      { status: 500 }
    )
  }

  // Decide publication per row BEFORE the insert, so an approved prediction is
  // live the moment it is saved rather than a write behind a write.
  const openClaimKeys = autoApproveEnabled() ? await loadOpenClaimKeys(db) : undefined
  const receipts: ReceiptCache = new Map()
  const decisions = await Promise.all(rows.map(row => decideApproval(row, openClaimKeys, receipts)))

  let payload: Record<string, unknown>[] = rows.map((row, i) => ({ ...sanitize(row), ...decisions[i] }))

  // One retry per optional column at most — each attempt drops the column the
  // error named, so this terminates.
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const { error } = await db.from('predictions').insert(payload)
    if (!error) {
      return NextResponse.json({
        ok: true,
        // The submit UI uses this to say "live now" instead of "waiting for
        // review" — telling someone their prediction is in a queue it never
        // entered is a worse lie than saying nothing.
        approved: decisions.map(d => d.approval_status === 'approved'),
      })
    }

    const missing = OPTIONAL_COLUMNS.filter(
      col => col in (payload[0] ?? {}) && error.message.includes(col)
    )
    if (missing.length === 0) {
      console.error('prediction insert failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.warn(
      `predictions.${missing.join('/')} column missing — run schema.sql; saving without it for now`
    )
    payload = payload.map(row => {
      const copy = { ...row }
      for (const col of missing) delete copy[col]
      return copy
    })
  }

  return NextResponse.json(
    { error: 'Could not save prediction after stripping optional columns.' },
    { status: 500 }
  )
}
