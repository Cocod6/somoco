// Somoco — Phase 1: prediction parser API route
// POST /api/parse-prediction
// Body: { "text": "Bitcoin will hit $150K before December 2026" }
// Returns: ParseResponse (parsed prediction + existing Atom matches)
//
// The parsing itself lives in lib/predictions/parse.ts so that server code
// (the Polymarket mirror) can reuse it without going through HTTP. This route
// is the HTTP wrapper: it validates the body, calls the parser, adds the Atom
// dedup lookups, and maps errors to status codes. Response shape unchanged.

import { NextResponse } from 'next/server'
import { findExistingAtoms } from '@/lib/predictions/dedup'
import { ParseError, parsePredictionText } from '@/lib/predictions/parse'
import type { ParseResponse } from '@/lib/predictions/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const text: string = (body?.text ?? '').trim()
    // Optional user guidance on HOW the prediction should resolve.
    const userResolutionNote: string = String(body?.userResolutionNote ?? '').trim().slice(0, 500)

    const { parsed, resolutionPlan } = await parsePredictionText(text, userResolutionNote)

    // Check Intuition for existing Atoms matching each part — reuse instead of duplicate
    const [subjectMatches, predicateMatches, objectMatches] = await Promise.all([
      findExistingAtoms(parsed.subject),
      findExistingAtoms(parsed.claim),
      findExistingAtoms(parsed.condition),
    ])

    const response: ParseResponse = { parsed, resolutionPlan, subjectMatches, predicateMatches, objectMatches }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
