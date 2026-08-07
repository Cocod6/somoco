'use client'

// Somoco — admin gate
// Wraps any admin-only view. If the connected wallet isn't on the allowlist
// (see lib/admin.ts), it renders a locked panel instead of the children.
// This is defence-in-depth: the sidebar already hides admin links from
// non-admins, but the pages guard themselves too so a direct render can't
// leak the approval/resolution controls.

import { useIsAdmin } from '@/lib/admin'

export default function AdminGate({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const isAdmin = useIsAdmin()

  if (isAdmin) return <>{children}</>

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {'// admin only'}
      </div>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 48, textAlign: 'center', color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.8,
      }}>
        <div style={{ fontSize: 22, marginBottom: 10 }}>🔒</div>
        this area is restricted to somoco admins.
        <br />
        connect an authorised wallet to continue.
      </div>
    </div>
  )
}
