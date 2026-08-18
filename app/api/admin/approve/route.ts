// Somoco — approval decision API
// POST /api/admin/approve
// Body: { id, decision: 'approved' | 'rejected', auth: { address, signature, issuedAt } }
//
// This is the gate that decides what the whole app shows publicly. It requires a
// wallet signature from an allowlisted admin — see lib/adminAuth.ts. The old
// client-side update could be replayed by anyone holding the public anon key.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyAdmin, type AdminAuth } from '@/lib/adminAuth'

const DECISIONS = ['approved', 'rejected'] as const
type Decision = (typeof DECISIONS)[number]

export async function POST(request: Request) {
  let body: { id?: string; decision?: string; auth?: Partial<AdminAuth> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { id, decision, auth } = body

  if (!id) {
    return NextResponse.json({ error: 'A prediction id is required.' }, { status: 400 })
  }
  if (!decision || !DECISIONS.includes(decision as Decision)) {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'." }, { status: 400 })
  }

  // The signature covers the decision AND the row id, so it can't be replayed
  // against a different prediction or flipped from reject to approve.
  const reason = await verifyAdmin(auth, decision, id)
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

  // Record who decided, the same way the automatic path records 'auto'. Without
  // this the two routes are indistinguishable afterwards, and "did a person
  // actually look at this?" becomes unanswerable.
  const update: Record<string, unknown> = {
    approval_status: decision,
    approved_by: auth!.address!.toLowerCase(),
    approval_note: `Reviewed by hand and ${decision}.`,
  }

  let { error } = await db.from('predictions').update(update).eq('id', id)

  // The approval-receipt columns are newer than this route. A missing migration
  // must never stop an approval from going through.
  if (error && (error.message.includes('approved_by') || error.message.includes('approval_note'))) {
    delete update.approved_by
    delete update.approval_note
    ;({ error } = await db.from('predictions').update(update).eq('id', id))
  }

  if (error) {
    console.error('approve update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
