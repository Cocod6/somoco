'use client'

// Somoco — the access code form shown on /gate.
// Posts the code to /api/gate; on success the server sets the unlock cookie and
// we do a full navigation (not router.push) to the page the visitor was after.
// A hard navigation is deliberate: the cookie is brand new, and every server
// component on the destination must be rendered with it rather than served from
// a router cache filled while the site was still locked.

import { useState } from 'react'

export default function GateForm({ returnTo }: { returnTo: string }) {
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (res.ok) {
        window.location.replace(returnTo)
        return // keep the button disabled while the browser navigates away
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'That code is not right.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={code}
          onChange={e => {
            setCode(e.target.value)
            setError(null)
          }}
          placeholder="access code"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="access code"
          aria-invalid={error ? true : undefined}
          style={{
            width: '100%',
            background: 'var(--bg-input)',
            border: `1px solid ${error ? '#5a2626' : 'var(--border)'}`,
            borderRadius: 12,
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 15,
            letterSpacing: '1px',
            padding: '14px 62px 14px 16px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
            padding: '6px 8px',
          }}
        >
          {show ? 'hide' : 'show'}
        </button>
      </div>

      <button
        type="submit"
        className="btn btn-accent"
        disabled={busy || !code.trim()}
        style={{ padding: '14px 18px', fontSize: 15 }}
      >
        {busy ? 'checking…' : 'enter somoco'}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            color: '#ff6b6b',
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          {error}
        </div>
      )}
    </form>
  )
}
