'use client'

// Somoco — first-impression panel
//
// The app used to open straight onto a wall of markets, which reads fine if you
// already know what Somoco is and is baffling if you don't: a stranger's first
// screen was odds and $TRUST amounts with nothing saying what any of it means.
// This is the missing sentence, plus the three steps that make the model
// obvious before anyone is asked to connect a wallet.
//
// It shows for a visitor who hasn't connected. It disappears the moment they
// connect (a returning user doesn't need the pitch again) and can be dismissed
// outright — that choice is remembered in localStorage and is reversible from
// the "what is somoco?" link the feed shows in its place.

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'somoco.hero.dismissed'
const EVENT = 'somoco:hero-dismissed'

// A tiny external store rather than useState + useEffect: reading localStorage
// during render would break SSR (there is no window), and syncing it in an
// effect is exactly the cascading-render pattern the lint rules reject. The
// server snapshot is always `false`, so first paint matches the server HTML.
function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useHeroDismissed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(STORAGE_KEY) === '1',
    () => false
  )
}

export function setHeroDismissed(dismissed: boolean): void {
  if (dismissed) window.localStorage.setItem(STORAGE_KEY, '1')
  else window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(EVENT))
}

const STEPS = [
  {
    icon: '✍',
    title: 'say it in plain english',
    body: '"Bitcoin will hit $150K before December 2026." No forms, no dropdowns — AI turns your sentence into a structured claim.',
  },
  {
    icon: '⛓',
    title: 'it goes on-chain, permanently',
    body: 'Your claim is written to the Intuition protocol under your own address. Nobody can quietly edit or delete it later.',
  },
  {
    icon: '◎',
    title: 'back it with $TRUST',
    body: 'Stake yes or no. When the date arrives the winning side splits the losing pool — 3% fee, charged on winnings only.',
  },
]

export default function Hero({ onSubmit }: { onSubmit: () => void }) {
  return (
    <section
      className="fade-up"
      style={{
        position: 'relative',
        background:
          'radial-gradient(700px 220px at 82% -30%, rgba(200, 241, 53, 0.13), transparent 65%), linear-gradient(180deg, #141414, #0f0f0f)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '26px 24px 22px',
        marginBottom: 20,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setHeroDismissed(true)}
        aria-label="hide this introduction"
        title="hide"
        style={{
          position: 'absolute', top: 12, right: 14,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, padding: 4,
        }}
      >
        ×
      </button>

      <div style={{
        fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)',
        letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
      }}>
        {'// prediction markets on intuition'}
      </div>

      <h1 style={{
        fontSize: 30, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.9px',
        maxWidth: 620, marginBottom: 10,
      }}>
        Say what happens next.{' '}
        <span className="glow-accent">Put $TRUST on it.</span>
      </h1>

      <p style={{
        fontSize: 14, fontWeight: 500, lineHeight: 1.6, color: 'var(--text-muted)',
        maxWidth: 620, marginBottom: 20,
      }}>
        Somoco takes a prediction written the way you&apos;d say it out loud, records it
        permanently on-chain, and opens a market on whether you were right.
      </p>

      {/* The three steps — the whole model, before anyone is asked for a wallet */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        {STEPS.map((step, i) => (
          <div key={step.title} style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border)',
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 14 }}>{step.icon}</span>
              <span style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
              }}>
                step {i + 1}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{step.title}</div>
            <div style={{
              fontSize: 12, fontWeight: 500, lineHeight: 1.55, color: 'var(--text-muted)',
            }}>
              {step.body}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={onSubmit}
          className="btn btn-accent"
          style={{ padding: '11px 20px', fontSize: 14, borderRadius: 12 }}
        >
          make a prediction
        </button>
        <button
          onClick={() => setHeroDismissed(true)}
          className="btn btn-ghost"
          style={{ padding: '11px 18px', fontSize: 13, borderRadius: 12 }}
        >
          just show me the markets
        </button>
      </div>
    </section>
  )
}
