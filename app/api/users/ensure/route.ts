// Somoco — user record + trust score API
// POST /api/users/ensure
// Body: { address: "0x..." }
// Returns: UserRecord
//
// SECURITY: the score is computed HERE, on the server, from chain data — the
// client never supplies it. That's the whole point. If the client could post its
// own trust_score, the submission gate would be decorative (anyone could claim
// 100). The server reads the wallet's real nonce, balance and Atom count itself.
//
// No signature is required to call this: it only ever writes a score the server
// derived, so the worst a caller can do is ask us to recompute a public number
// about a wallet they don't own.

import { NextResponse } from 'next/server'
import { createPublicClient, http, isAddress } from 'viem'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { intuition, INTUITION_RPC_URL } from '@/lib/chain'
import { computeTrustScore } from '@/lib/trust'
import type { UserRecord } from '@/lib/supabase'

/** How stale a cached score may get before we recompute it (24h). */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

const publicClient = createPublicClient({
  chain: intuition,
  transport: http(INTUITION_RPC_URL),
})

export async function POST(request: Request) {
  let body: { address?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const raw = body.address
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ error: 'A valid wallet address is required.' }, { status: 400 })
  }
  const key = raw.toLowerCase()

  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Database unavailable.' },
      { status: 500 }
    )
  }

  // Existing record? Reuse it if the score is still fresh.
  const { data: existing } = await db
    .from('users')
    .select('*')
    .eq('address', key)
    .maybeSingle()

  const current = existing as UserRecord | null
  if (current) {
    const age = Date.now() - new Date(current.updated_at).getTime()
    if (age < REFRESH_AFTER_MS) return NextResponse.json(current)
  }

  // Compute (or recompute) the score from chain signals.
  const breakdown = await computeTrustScore(key, publicClient)
  const nowIso = new Date().toISOString()

  const row = {
    address: key,
    trust_score: breakdown.score,
    trust_signals: breakdown.signals,
    updated_at: nowIso,
    // created_at is set by the DB default on first insert and preserved on
    // conflict — we only pass it so the fallback object below is complete.
    ...(current ? {} : { created_at: nowIso }),
  }

  const { data, error } = await db
    .from('users')
    .upsert(row, { onConflict: 'address' })
    .select()
    .maybeSingle()

  if (error || !data) {
    console.warn('ensureUser upsert failed:', error?.message)
    // Never block the user on a bookkeeping failure — hand back a live record.
    return NextResponse.json({
      address: key,
      trust_score: breakdown.score,
      trust_signals: breakdown.signals,
      created_at: current?.created_at ?? nowIso,
      updated_at: nowIso,
    } satisfies UserRecord)
  }

  return NextResponse.json(data as UserRecord)
}
