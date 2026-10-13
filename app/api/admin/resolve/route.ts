// Somoco — resolution bookkeeping API
// POST /api/admin/resolve
// Body: { id, outcome: 'resolved_true' | 'resolved_false' | 'voided',
//         txHash?, sourceUrl?, note?, auth: {...} }
//
// Records the outcome of a resolution that ALREADY happened on-chain. The
// on-chain write was never forgeable (it needs the admin wallet to sign a real
// transaction) — but Somoco's own record of it was, with the anon key. This
// route closes that gap so the DB can't claim a resolution that never happened.
//
// FRIEND MARKETS (2026-10-13). A friend market's outcome belongs to its jury,
// not to Somoco. So for a prediction with an on-chain jury, this route records
// only what the market contract itself already says — resolved YES/NO by the
// jury, or voided — and refuses anything else. Before this, the Resolve page
// could mark a friend market "resolved false" in the DB while the contract
// (correctly) refused Somoco's verdict, leaving the record contradicting the
// money. The jury is read from the chain, never from the row.
//
// It also writes the RECEIPT: which source said so, why, when, and who. Two of
// those four are deliberately not taken from the request body — see below.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyAdmin, type AdminAuth } from '@/lib/adminAuth'
import { writeResolutionSentence } from '@/lib/predictions/resolutionSentence'
import type { ResolutionPlan } from '@/lib/predictions/types'
import { createPublicClient, http, type Hex } from 'viem'
import { intuition, INTUITION_RPC_URL } from '@/lib/chain'
import { readJuryView, juryRecordRefusal } from '@/lib/predictions/friendJury'

const publicClient = createPublicClient({ chain: intuition, transport: http(INTUITION_RPC_URL) })

/**
 * For a friend market with a jury, the only outcome Somoco may record is the
 * one the contract already holds. Returns a reason to refuse, or null.
 * Fails closed: if the chain can't be read, nothing is recorded.
 */
async function juryRefusal(tripleId: string, outcome: Outcome): Promise<string | null> {
  return juryRecordRefusal(await readJuryView(publicClient, tripleId as Hex), outcome)
}

const OUTCOMES = ['resolved_true', 'resolved_false', 'voided'] as const
type Outcome = (typeof OUTCOMES)[number]

/** Long enough to explain a resolution, short enough not to be a storage API. */
const MAX_NOTE = 500
const MAX_URL = 500

/**
 * Accepts an http(s) URL and nothing else.
 *
 * The receipt is rendered as a link users click, so a `javascript:` or `data:`
 * URL here would be a stored redirect on Somoco's own admin-blessed surface.
 * Anything unparseable is dropped rather than rejected — a bad link is not a
 * reason to fail a resolution that already happened on-chain.
 */
function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_URL) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed.slice(0, MAX_NOTE) : null
}

/**
 * Columns added by the 2026-08-18 receipt migration. If schema.sql has not been
 * re-run yet, PostgREST rejects the whole update naming the missing column —
 * and a resolution that already happened on-chain must never be lost to a
 * pending migration. So we strip whichever column it names and retry, exactly
 * as insertPredictionRows does on the submit path.
 */
const RECEIPT_COLUMNS = [
  'resolution_source_url',
  'resolution_note',
  'resolved_at',
  'resolved_by',
] as const

export async function POST(request: Request) {
  let body: {
    id?: string
    outcome?: string
    txHash?: string
    sourceUrl?: string
    note?: string
    auth?: Partial<AdminAuth>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { id, outcome, txHash, auth } = body

  if (!id) {
    return NextResponse.json({ error: 'A prediction id is required.' }, { status: 400 })
  }
  if (!outcome || !OUTCOMES.includes(outcome as Outcome)) {
    return NextResponse.json(
      { error: "outcome must be 'resolved_true', 'resolved_false' or 'voided'." },
      { status: 400 }
    )
  }

  const reason = await verifyAdmin(auth, outcome, id)
  if (reason) {
    return NextResponse.json({ error: reason }, { status: 403 })
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

  const { data: target } = await db
    .from('predictions')
    .select('triple_id, is_private')
    .eq('id', id)
    .maybeSingle()

  if (target?.is_private === true && target.triple_id) {
    const refusal = await juryRefusal(String(target.triple_id), outcome as Outcome)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
  }

  // If the resolver didn't type an explanation, have the AI write one from the
  // claim, the outcome and the named source. It is told nothing about what
  // happened in the world and is forbidden from adding facts, so the worst case
  // is a plain restatement — never invented evidence. Failure returns null and
  // the note simply stays empty; a resolution already written to the chain must
  // never fail because a sentence couldn't be drafted.
  let note = cleanNote(body.note)
  const sourceUrl = cleanUrl(body.sourceUrl)

  if (!note) {
    const { data: row } = await db
      .from('predictions')
      .select('subject, claim, condition, resolution_plan')
      .eq('id', id)
      .maybeSingle()

    if (row) {
      const plan = row.resolution_plan as ResolutionPlan | null
      note = await writeResolutionSentence({
        subject: String(row.subject ?? ''),
        claim: String(row.claim ?? ''),
        condition: (row.condition as string | null) ?? null,
        outcome: outcome as 'resolved_true' | 'resolved_false' | 'voided',
        sourceUrl,
        sourceName: plan?.sources?.[0] ?? null,
      })
    }
  }

  // The two halves of the receipt that the client does NOT get to state:
  // WHO resolved it is the address the signature was recovered from (verifyAdmin
  // has just proven it), and WHEN is the server's own clock. A browser can
  // claim neither — otherwise the receipt would be exactly as forgeable as the
  // resolution record this route exists to protect.
  const update: Record<string, unknown> = {
    resolution_status: outcome,
    resolution_tx_hash: txHash ?? null,
    resolution_source_url: sourceUrl,
    resolution_note: note,
    resolved_at: new Date().toISOString(),
    resolved_by: auth!.address!.toLowerCase(),
  }

  const missingColumns: string[] = []

  for (;;) {
    const { error } = await db.from('predictions').update(update).eq('id', id)
    if (!error) {
      return NextResponse.json({
        ok: true,
        // Tell the caller plainly if the receipt could not be stored, so the UI
        // can say "resolved, receipt not saved" instead of implying it was.
        receiptStored: missingColumns.length === 0,
        ...(missingColumns.length ? { missingColumns } : {}),
      })
    }

    const dropped = RECEIPT_COLUMNS.find(
      column => column in update && error.message.includes(column)
    )
    if (!dropped) {
      console.error('resolve update failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.warn(`resolve: column ${dropped} missing — run schema.sql. Retrying without it.`)
    delete update[dropped]
    missingColumns.push(dropped)
  }
}
