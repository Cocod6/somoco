// Somoco — auto-settlement trigger
// POST /api/settle
// Body: { dryRun?: boolean, limit?: number, maxSpendTrust?: number,
//         writeOnChain?: boolean, predictionId?: string }
//
// Settles imported predictions by READING the outcome their source market
// already published — see lib/predictions/settle.ts for why that is safe to run
// with a shared secret instead of an admin wallet signature: the caller cannot
// state an outcome, only ask the settler to go and look one up.
//
// Shares MIRROR_SECRET with the mirror route on purpose. Both are unattended
// jobs operating the same burner wallet, so splitting them into two secrets
// would suggest a separation of authority that doesn't exist.
//
// Intended caller is a scheduled job once Somoco is deployed; until then, curl.

import { NextResponse } from 'next/server'
import { runSettlement, type SettleOptions } from '@/lib/predictions/settle'

/** Constant-time-ish compare so the secret can't be guessed by timing. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export async function POST(request: Request) {
  const expected = process.env.MIRROR_SECRET?.trim()
  if (!expected) {
    return NextResponse.json(
      { error: 'MIRROR_SECRET is not configured — auto-settlement is disabled.' },
      { status: 503 }
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: SettleOptions = {}
  try {
    const raw = await request.text()
    if (raw.trim()) body = JSON.parse(raw) as SettleOptions
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  try {
    const report = await runSettlement(body)
    return NextResponse.json(report)
  } catch (err) {
    console.error('settlement run failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Settlement run failed.' },
      { status: 500 }
    )
  }
}
