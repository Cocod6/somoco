// Somoco — private preview gate
//
// Runs before any route renders. With SITE_ACCESS_CODE set, a visitor without
// the unlock cookie never reaches a page at all — they land on /gate. Unset the
// variable and this file does nothing, which is how Somoco opens to the public.
//
// "proxy" is Next 16's name for what used to be called middleware (renamed in
// v16.0.0 — see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
// One proxy file per project, root level, exporting `proxy`.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { GATE_COOKIE, cookieUnlocks, getAccessCode } from '@/lib/gate'

/**
 * Paths that stay reachable while the site is locked.
 *
 * - /gate + /api/gate are the lock itself; gating them would be a closed loop.
 * - /api/settle and /api/polymarket/mirror are unattended jobs (cron / curl)
 *   that carry MIRROR_SECRET in an Authorization header and have no browser
 *   and no cookie. They already refuse callers without that secret, so the
 *   access code would add nothing but a broken mirror.
 *
 * Everything else — pages and browser-called APIs alike — is behind the code.
 * The browser routes need no exception: the fetch that calls them carries the
 * same cookie the page was served with.
 */
const ALWAYS_OPEN = ['/gate', '/api/gate', '/api/settle', '/api/polymarket/mirror']

function isAlwaysOpen(pathname: string): boolean {
  return ALWAYS_OPEN.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
  // No code configured = public site. Cheapest possible path, checked first.
  if (!getAccessCode()) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (isAlwaysOpen(pathname)) return NextResponse.next()

  if (await cookieUnlocks(request.cookies.get(GATE_COOKIE)?.value)) {
    return NextResponse.next()
  }

  // An API call gets an honest status code, not an HTML login page it can't
  // read — a fetch from a stale tab should fail loudly rather than silently
  // parse a redirect as data.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Somoco is in private preview — an access code is required.' },
      { status: 401 }
    )
  }

  // Redirect (not rewrite) so the address bar says /gate: a locked visitor
  // should be able to see where they are and bookmark it.
  const url = request.nextUrl.clone()
  const from = `${pathname}${request.nextUrl.search}`
  url.pathname = '/gate'
  url.search = ''
  if (from !== '/') url.searchParams.set('from', from)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except Next's own static output and the metadata files. Note
  // that /_next/data routes run through the proxy regardless of this pattern —
  // that is Next's deliberate safeguard so a protected page's data route can't
  // be left open by an over-eager matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
