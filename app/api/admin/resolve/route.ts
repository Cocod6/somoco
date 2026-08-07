// Somoco — resolution bookkeeping API
// POST /api/admin/resolve
// Body: { id, outcome: 'resolved_true' | 'resolved_false', txHash, auth: {...} }
//
// Records the outcome of a resolution that ALREADY happened on-chain. The
// on-chain write was never forgeable (it needs the admin wallet to sign a real
// transaction) — but Somoco's own record of it was, with the anon key. This
// route closes that gap so the DB can't claim a resolution that never happened.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyAdmin, type AdminAuth } from '@/lib/adminAuth'

const OUTCOMES = ['resolved_true', 'resolved_false'] as const
type Outcome = (typeof OUTCOMES)[number]

export async function POST(request: Request) {
  let body: { id?: string; outcome?: string; txHash?: string; auth?: Partial<AdminAuth> }
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
      { error: "outcome must be 'resolved_true' or 'resolved_false'." },
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

  const { error } = await db
    .from('predictions')
    .update({ resolution_status: outcome, resolution_tx_hash: txHash ?? null })
    .eq('id', id)

  if (error) {
    console.error('resolve update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
