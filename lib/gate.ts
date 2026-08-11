// Somoco — site access gate (private preview mode)
//
// This is NOT user identity. It's a single shared code that decides whether the
// site is visible at all: with SITE_ACCESS_CODE set, every page and every
// browser-facing API answers "locked" until the visitor types the code once.
// Unset the env var and the gate disappears completely — that is how Somoco
// goes public later, with no code change.
//
// Deliberately separate from lib/admin.ts. That one asks "is this wallet
// allowed to approve/resolve?" and runs in the browser. This one asks "may this
// person see the site?" and runs on the server, before anything renders — a
// wallet gate can't do that, because the page has to load before a wallet can
// connect.
//
// The cookie never carries the code itself, only its SHA-256. Anyone holding
// the cookie knew the code anyway, so this buys nothing against them — it
// means the plaintext code isn't sitting in browser storage on a shared or
// screenshotted machine.
//
// Server-side module: imported by proxy.ts and app/api/gate/route.ts only.
// SITE_ACCESS_CODE has no NEXT_PUBLIC_ prefix on purpose, so it is never
// bundled into anything the browser downloads.

/** Cookie holding proof the visitor entered the code. HttpOnly, set server-side. */
export const GATE_COOKIE = 'somoco_access'

/** How long one unlock lasts before the code is asked for again: 30 days. */
export const GATE_MAX_AGE = 60 * 60 * 24 * 30

/**
 * The configured access code, or null when the gate is switched off.
 * Empty / whitespace-only counts as off, so a stray `SITE_ACCESS_CODE=` line
 * can't lock everyone out with a code nobody can type.
 */
export function getAccessCode(): string | null {
  const raw = process.env.SITE_ACCESS_CODE?.trim()
  return raw ? raw : null
}

/**
 * Cookie value proving knowledge of `code`: sha256 hex of a namespaced string.
 * Web Crypto (not node:crypto) so this same function works unchanged in the
 * proxy, in a route handler, and on any host Somoco is deployed to.
 */
export async function gateToken(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`somoco-gate:v1:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Length-then-XOR compare, so how long the check takes doesn't leak how much of
 * the secret was right. Same approach as the settle/mirror routes' secret check.
 */
export function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/** True if this request's cookie value unlocks the site. */
export async function cookieUnlocks(value: string | undefined): Promise<boolean> {
  const code = getAccessCode()
  if (!code) return true // gate off — everything is unlocked
  if (!value) return false
  return secretMatches(value, await gateToken(code))
}

/**
 * Where to send someone after they unlock. Only same-site absolute paths are
 * allowed: without this check, a link like /gate?from=https://evil.example
 * would turn Somoco's own gate into a redirect to someone else's site.
 */
export function safeReturnPath(from: string | null | undefined): string {
  if (!from) return '/'
  if (!from.startsWith('/')) return '/'
  if (from.startsWith('//')) return '/'
  if (from.startsWith('/gate')) return '/'
  return from
}
