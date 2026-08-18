// Somoco — read the outcome a source market already published
// POST /api/polymarket/outcome   Body: { refs: ExternalResolutionRef[] }
//
// WHY THIS EXISTS
// Somoco has had two resolution paths that couldn't talk to each other:
//
//   /api/settle   CAN read Polymarket's outcome mechanically, but refuses to
//                 touch any prediction that has a staking pool — only the
//                 factory's resolver can settle a pool, and the settler wallet
//                 isn't it.
//   ResolveAdmin  CAN settle a pool, but never looked at Polymarket at all. It
//                 showed the admin two blank buttons and asked them to decide.
//
// The result was that for a mirrored market holding real money, a human made a
// personal judgement call about a question that had ALREADY been answered
// mechanically. This route closes that gap: it lets the admin screen show the
// published outcome, so the click becomes a CONFIRMATION rather than a verdict.
//
// It is deliberately read-only and stateless:
//   - it never writes anything, on-chain or in the database
//   - it takes the source pointers from the caller and returns what the source
//     says; it has no opinion and no authority of its own
//   - it needs no auth, because it exposes nothing that isn't already public:
//     Polymarket outcomes are public, and the pointers come from the caller
//
// The actual resolution still requires the admin's wallet signature, exactly as
// before. This only removes the guesswork from it.

import { NextResponse } from 'next/server'
import { readPolymarketOutcome } from '@/lib/predictions/polymarket'
import type { ExternalResolutionRef } from '@/lib/predictions/types'

/** Keeps one request from fanning out into an unbounded number of upstream calls. */
const MAX_REFS = 60

export async function POST(request: Request) {
  let body: { refs?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const refs = body.refs
  if (!Array.isArray(refs)) {
    return NextResponse.json({ error: 'refs must be an array.' }, { status: 400 })
  }
  if (refs.length > MAX_REFS) {
    return NextResponse.json({ error: `At most ${MAX_REFS} refs per request.` }, { status: 400 })
  }

  const valid = refs.filter(
    (r): r is ExternalResolutionRef =>
      !!r && typeof r === 'object' && typeof (r as ExternalResolutionRef).marketId === 'string'
  )

  // One unreachable source must not blank out the whole screen — each ref
  // resolves to its own answer, and null simply means "not settled / unknown",
  // which is the same thing the admin sees today.
  const entries = await Promise.all(
    valid.map(async ref => {
      try {
        return [ref.marketId, await readPolymarketOutcome(ref)] as const
      } catch {
        return [ref.marketId, null] as const
      }
    })
  )

  return NextResponse.json({ outcomes: Object.fromEntries(entries) })
}
