// Somoco — Polymarket auto-mirror trigger
// POST /api/polymarket/mirror
// Body: { dryRun?: boolean, limit?: number, minVolume?: number,
//         category?: string, maxSpendTrust?: number, autoApprove?: boolean,
//         useAiParse?: boolean, minDaysToResolution?: number,
//         allowDuplicateClaims?: boolean }
//
// This is the one route in the app that spends money without a human at a
// wallet prompt, so it is locked down harder than the rest:
//
//   • It requires MIRROR_SECRET in the Authorization header. No secret set
//     means the route refuses to run at all — it does NOT fall open.
//   • dryRun defaults to true in lib/predictions/mirror.ts, so an accidental
//     call reports a plan instead of minting.
//
// Intended caller is a scheduled job (Vercel Cron) once Somoco is deployed;
// until then, curl it by hand.

import { NextResponse } from 'next/server'
import { runMirror, type MirrorOptions } from '@/lib/predictions/mirror'

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
      { error: 'MIRROR_SECRET is not configured — the mirror is disabled.' },
      { status: 503 }
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: MirrorOptions = {}
  try {
    const raw = await request.text()
    if (raw.trim()) body = JSON.parse(raw) as MirrorOptions
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  try {
    const report = await runMirror(body)
    return NextResponse.json(report)
  } catch (err) {
    console.error('mirror run failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Mirror run failed.' },
      { status: 500 }
    )
  }
}
