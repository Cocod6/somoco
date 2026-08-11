// Somoco — access code check
// POST   /api/gate  { code }  → sets the unlock cookie
// DELETE /api/gate            → clears it ("lock this device again")
//
// The only route that ever sees SITE_ACCESS_CODE. The browser sends a code and
// gets back a cookie or a refusal; it never learns the code from us, so a wrong
// guess teaches the guesser nothing except that it was wrong.

import { NextResponse } from 'next/server'
import { GATE_COOKIE, GATE_MAX_AGE, getAccessCode, gateToken, secretMatches } from '@/lib/gate'

/**
 * Guess limiter. A shared code is short enough to be worth hammering, so each
 * source address gets ATTEMPTS tries per WINDOW.
 *
 * Honest about its limits: this lives in one server process's memory, so a
 * restart clears it and a platform running several instances counts per
 * instance. It's a speed bump against a script, not a defence against a
 * determined attacker — the real protection is a code long enough not to guess,
 * which is why the .env.local comment tells Coco to use a generated one.
 */
const ATTEMPTS = 10
const WINDOW_MS = 10 * 60 * 1000
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const seen = attempts.get(key)
  if (!seen || now > seen.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  seen.count++
  return seen.count > ATTEMPTS
}

/** Clears the limiter for a caller who proved they know the code. */
function clearLimit(key: string): void {
  attempts.delete(key)
}

function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local'
}

export async function POST(request: Request) {
  const expected = getAccessCode()
  if (!expected) {
    // Gate switched off — nothing to unlock, and the proxy is already letting
    // everyone through.
    return NextResponse.json({ ok: true, gateDisabled: true })
  }

  const key = callerKey(request)
  if (rateLimited(key)) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 }
    )
  }

  let provided = ''
  try {
    const body = await request.json()
    provided = typeof body?.code === 'string' ? body.code.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'That code is not right.' }, { status: 401 })
  }

  clearLimit(key)

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: GATE_COOKIE,
    value: await gateToken(expected),
    httpOnly: true, // no script, extension or XSS payload can read it back
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // http://localhost has no TLS
    path: '/',
    maxAge: GATE_MAX_AGE,
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: GATE_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
