'use client'

import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useBalance } from 'wagmi'
import { useIsEmbeddedWallet } from '../hooks/useIsEmbeddedWallet'

// Replaces RainbowKit's <ConnectButton>. Privy owns the login modal
// (wallet / email); wagmi's useAccount still reports the active address, so the
// rest of the app is unchanged. When connected, clicking the pill opens a panel
// with the balance, the address (to fund / copy), and an explicit Disconnect.
export default function WalletButton() {
  const { ready, authenticated, login, logout } = usePrivy()
  const { address } = useAccount()
  const { data: balance } = useBalance({ address })
  const isEmbedded = useIsEmbeddedWallet(address)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API needs a secure context (https / localhost) — if it's
      // unavailable the full address is visible in the panel to copy by hand.
    }
  }

  const handleDisconnect = () => {
    setOpen(false)
    logout()
  }

  if (!ready) {
    return (
      <button
        disabled
        style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20,
          padding: '8px 16px', fontSize: 13, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', cursor: 'default',
        }}
      >
        …
      </button>
    )
  }

  if (!authenticated) {
    return (
      <button
        onClick={login}
        className="btn btn-accent"
        style={{ borderRadius: 999, padding: '8px 18px', fontSize: 13 }}
      >
        Connect
      </button>
    )
  }

  const balanceLabel = balance
    ? `${Number(balance.formatted).toFixed(3)} ${balance.symbol}`
    : '—'

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20,
          padding: '8px 16px', fontSize: 13, color: 'var(--text)',
          fontFamily: 'var(--font-mono)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#c8f135' }} />
        {short || 'connected'}
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
          />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 200,
              // 300px unless the screen is narrower than that — a fixed width
              // here pushes off the right edge of a small phone.
              width: 'min(300px, calc(100vw - 28px))',
              background: '#111', border: '1px solid #2a2a2a',
              borderRadius: 14, padding: 16, fontFamily: 'var(--font-mono)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}
          >
            {/* type badge */}
            <div style={{
              fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 10,
            }}>
              {isEmbedded ? 'embedded wallet' : 'connected wallet'}
            </div>

            {/* balance */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>balance</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{balanceLabel}</div>
            </div>

            {/* address / fund */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                {isEmbedded ? 'fund this address with $TRUST' : 'address'}
              </div>
              <button
                onClick={copyAddress}
                title="Copy address"
                style={{
                  width: '100%', textAlign: 'left', background: '#0a0a0a',
                  border: '1px solid #222', borderRadius: 8, padding: '8px 10px',
                  fontSize: 11, color: 'var(--text)', cursor: 'pointer',
                  wordBreak: 'break-all', fontFamily: 'var(--font-mono)',
                }}
              >
                {address}
                <div style={{ fontSize: 10, color: copied ? '#c8f135' : 'var(--text-dim)', marginTop: 4 }}>
                  {copied ? '✓ copied' : 'click to copy'}
                </div>
              </button>
              {isEmbedded && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                  send $TRUST here to submit predictions and pay gas.
                </div>
              )}
            </div>

            <button
              onClick={handleDisconnect}
              className="btn btn-no"
              style={{
                width: '100%', borderRadius: 10, padding: '10px', fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            >
              disconnect wallet
            </button>
          </div>
        </>
      )}
    </div>
  )
}
