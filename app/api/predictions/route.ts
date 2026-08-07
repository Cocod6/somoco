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

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

/**
 * Columns added after the live DB was first created. Any of them may be absent
 * until schema.sql is re-run, and an unknown column fails the WHOLE insert —
 * the category column taught us this: the approval-queue row silently vanished
 * while the Triple was already on-chain. So we strip whichever column the error
 * names and retry, rather than losing the record.
 */
const OPTIONAL_COLUMNS = ['category', 'resolution_plan', 'image_url'] as const

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
] as const

/** Strips any client-supplied column that isn't submitter-owned. */
function sanitize(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const col of ALLOWED_COLUMNS) {
    if (col in row) clean[col] = row[col]
  }
  return clean
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

  let payload = rows.map(sanitize)

  // One retry per optional column at most — each attempt drops the column the
  // error named, so this terminates.
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const { error } = await db.from('predictions').insert(payload)
    if (!error) return NextResponse.json({ ok: true })

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
