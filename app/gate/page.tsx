// Somoco — /gate
//
// The only page reachable while the site is locked. Server component on
// purpose: it reads the cookie before anything renders, so a locked visitor is
// never sent markup from the app itself, and a code check can't be skipped by
// disabling JavaScript.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { GATE_COOKIE, cookieUnlocks, getAccessCode, safeReturnPath } from '@/lib/gate'
import GateForm from '@/components/GateForm'
import GateLockButton from '@/components/GateLockButton'

export const metadata: Metadata = {
  title: 'somoco — private preview',
  // A door isn't a page anyone should find in search results.
  robots: { index: false, follow: false },
}

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const returnTo = safeReturnPath(from)

  // Gate switched off entirely — this page has no reason to exist.
  if (!getAccessCode()) redirect('/')

  const cookieStore = await cookies()
  const unlocked = await cookieUnlocks(cookieStore.get(GATE_COOKIE)?.value)

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '-1.5px',
            marginBottom: 6,
          }}
        >
          somoco
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            color: 'var(--text-dim)',
            marginBottom: 28,
          }}
        >
          {'// private preview'}
        </div>

        <div
          className="spice-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 24,
          }}
        >
          {unlocked ? (
            <>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: 'var(--text-muted)',
                  marginBottom: 18,
                }}
              >
                <span style={{ color: 'var(--accent)' }}>✓ this device is unlocked.</span>
                <br />
                the site is still closed to everyone without the code.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <a
                  href={returnTo}
                  className="btn btn-accent"
                  style={{ padding: '14px 18px', fontSize: 15, textDecoration: 'none' }}
                >
                  continue to somoco
                </a>
                <GateLockButton />
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: 'var(--text-muted)',
                  marginBottom: 18,
                }}
              >
                somoco is closed while it&apos;s being tested.
                <br />
                enter the access code to have a look.
              </div>
              <GateForm returnTo={returnTo} />
            </>
          )}
        </div>

        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-dim)',
            lineHeight: 1.8,
            marginTop: 18,
            textAlign: 'center',
          }}
        >
          no code? ask coco.
        </div>
      </div>
    </main>
  )
}
