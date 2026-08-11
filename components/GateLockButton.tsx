'use client'

// Somoco — "lock this device again" (clears the access cookie).
// Shown on /gate to someone who is already unlocked. Useful when the code has
// been handed to a tester and Coco wants a device — or a shared browser — to
// stop being trusted without changing the code for everyone.

import { useState } from 'react'

export default function GateLockButton() {
  const [busy, setBusy] = useState(false)

  async function lock() {
    setBusy(true)
    await fetch('/api/gate', { method: 'DELETE' }).catch(() => {})
    // Full reload so the proxy re-evaluates the (now missing) cookie.
    window.location.replace('/gate')
  }

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={lock}
      disabled={busy}
      style={{ padding: '12px 16px', fontSize: 13 }}
    >
      {busy ? 'locking…' : 'lock this device again'}
    </button>
  )
}
