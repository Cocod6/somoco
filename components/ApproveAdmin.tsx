'use client'

// Somoco — approval queue
// Every prediction submitted through Somoco lands here first as 'pending'.
// Nothing shows up publicly, and nothing reaches the Resolve page, until
// you approve it here. This is YOUR private list — separate from Intuition,
// which already has the real Triple permanently either way.

import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { signAdminAction } from '@/lib/adminSign'
import {
  createMarketOnChain, acceptFactoryOwnership, getFactoryOwnership,
} from '@/lib/predictions/settlement'
import ResolutionPlanBadge from './ResolutionPlanBadge'

// Approving a prediction also creates its settlement pool (the money market).
// Staking closes this many seconds before the resolution date — or halfway to
// resolution when the date is nearer than that, so late approvals still work.
const DEFAULT_LOCK_OFFSET = 24 * 60 * 60

// Create the prediction's money market on the settlement factory. The caller's
// wallet must be the factory owner. Returns a human-readable outcome; throws
// only network/contract errors. Module-level (not in the component) because it
// uses wall-clock time, which the react compiler forbids in render scope.
async function createSettlementMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  pred: PredictionRecord
): Promise<{ ok: boolean; message: string }> {
  if (!pred.resolution_date) {
    return { ok: false, message: `Approved, but no settlement pool: "${pred.subject}" has no resolution date.` }
  }
  // The date column is YYYY-MM-DD; treat it as midnight UTC of that day.
  const resolutionUnix = Math.floor(Date.parse(`${pred.resolution_date}T00:00:00Z`) / 1000)
  const now = Math.floor(Date.now() / 1000)
  if (resolutionUnix <= now) {
    return { ok: false, message: `Approved, but no settlement pool: "${pred.subject}"'s resolution date is already past.` }
  }
  // Lock 24h before resolution, or halfway there if that's already too close.
  const lockOffset = Math.min(DEFAULT_LOCK_OFFSET, Math.floor((resolutionUnix - now) / 2))
  await createMarketOnChain(
    publicClient,
    walletClient,
    pred.triple_id as Hex,
    resolutionUnix,
    lockOffset,
    pred.creator_address as Address
  )
  const locks = new Date((resolutionUnix - lockOffset) * 1000).toLocaleString()
  return { ok: true, message: `Approved — settlement pool is live, staking closes ${locks}.` }
}

export default function ApproveAdmin() {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // One-time factory ownership handover: when the connected admin is the
  // factory's pending owner, show an activate button until accepted.
  const [needsOwnershipAccept, setNeedsOwnershipAccept] = useState(false)
  const [acceptingOwnership, setAcceptingOwnership] = useState(false)
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  useEffect(() => {
    const loadPending = async () => {
      setLoading(true)
      setError(null)
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setPredictions(data ?? [])
      }
      setLoading(false)
    }

    loadPending()
  }, [])

  useEffect(() => {
    if (!publicClient || !address) return
    let cancelled = false
    const check = async () => {
      try {
        const { pendingOwner } = await getFactoryOwnership(publicClient)
        if (!cancelled) setNeedsOwnershipAccept(pendingOwner.toLowerCase() === address.toLowerCase())
      } catch (e) {
        console.error('factory ownership check failed', e)
      }
    }
    check()
    return () => { cancelled = true }
  }, [publicClient, address])

  const handleAcceptOwnership = async () => {
    if (!publicClient || !walletClient) return
    setAcceptingOwnership(true)
    setError(null)
    try {
      await acceptFactoryOwnership(publicClient, walletClient)
      setNeedsOwnershipAccept(false)
      setNotice('Market creation activated — this wallet now owns the market factory.')
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Could not accept ownership.')
    } finally {
      setAcceptingOwnership(false)
    }
  }

  // Approving is a privileged write, so it goes through /api/admin/approve and
  // has to be signed by an allowlisted admin wallet. The signature covers this
  // exact decision on this exact row — see lib/adminAuth.ts.
  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    if (!walletClient || !address) {
      setError('Connect your admin wallet before approving or rejecting.')
      return
    }

    setBusyId(id)
    setError(null)
    try {
      const auth = await signAdminAction(walletClient, address, decision, id)

      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, auth }),
      })

      if (!res.ok) {
        const { error: apiError } = await res.json().catch(() => ({ error: res.statusText }))
        setError(apiError ?? 'Could not save the decision.')
      } else {
        // Approval went through — now create the settlement pool so people
        // can actually stake money on it. Failure here doesn't undo the
        // approval; it just means the market has to be created later.
        if (decision === 'approved') {
          const pred = predictions.find(p => p.id === id)
          if (pred && publicClient && walletClient) {
            try {
              const result = await createSettlementMarket(publicClient, walletClient, pred)
              setNotice(result.message)
            } catch (err) {
              const message = err instanceof Error ? err.message.split('\n')[0] : 'market creation failed'
              setError(`Approved, but the settlement pool was NOT created: ${message}`)
            }
          }
        }
        setPredictions(prev => prev.filter(p => p.id !== id))
      }
    } catch (err) {
      // Most common case here is the admin dismissing the signature prompt.
      setError(err instanceof Error ? err.message : 'Could not sign the decision.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        approve predictions
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {"// nothing reaches resolve until it's approved here"}
      </div>

      {/* One-time setup: this wallet has been offered factory ownership but
          hasn't accepted yet. Until it does, approvals can't create markets. */}
      {needsOwnershipAccept && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          marginBottom: 16, padding: '14px 16px', background: '#1a150a',
          borderRadius: 10, border: '1px solid #3d2f1a',
        }}>
          <div style={{ fontSize: 13, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
            ⚡ one-time setup: accept market-factory ownership so approving a
            prediction can auto-create its settlement pool
          </div>
          <button
            onClick={handleAcceptOwnership}
            disabled={acceptingOwnership}
            className="btn btn-yes"
            style={{ padding: '8px 18px', fontSize: 13, borderRadius: 10, opacity: acceptingOwnership ? 0.5 : 1 }}
          >
            {acceptingOwnership ? 'accepting…' : 'activate'}
          </button>
        </div>
      )}

      {notice && (
        <div style={{
          color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: 'var(--accent-dark)',
          borderRadius: 8, border: '1px solid var(--accent-border)',
        }}>
          {notice}
        </div>
      )}

      {error && (
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: '#ff44441a',
          borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[0, 1].map(n => <div key={n} className="skeleton" style={{ height: 220 }} />)}
        </div>
      )}

      {!loading && predictions.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          nothing pending right now
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {predictions.map(pred => (
          <div key={pred.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 20,
          }}>
            {/* The creator's image — shown BEFORE the approve buttons so it gets
                moderated along with the prediction. Approving publishes it. */}
            {pred.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pred.image_url}
                alt="submitted with this prediction"
                style={{
                  width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block',
                  borderRadius: 10, border: '1px solid var(--border)', marginBottom: 14,
                }}
              />
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <Pill color="var(--blue)">{pred.subject}</Pill>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
              <Pill color="var(--purple)">{pred.claim}</Pill>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
              <Pill color="var(--amber)">{pred.condition ?? 'no condition'}</Pill>
            </div>

            {/* The resolution contract — expanded by default so the admin can
                judge it (and see any needs-review flag) before approving. */}
            <div style={{ marginBottom: 14 }}>
              {/* The moderation surface — the only place the review flag and
                  the parser's reasoning are meant to be read. */}
              <ResolutionPlanBadge plan={pred.resolution_plan} defaultOpen showReviewFlag showReviewReason />
            </div>

            <div style={{
              fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
            }}>
              <span>by {pred.creator_address.slice(0, 6)}...{pred.creator_address.slice(-4)}</span>
              <span>judgment day: {pred.resolution_date ?? 'not set'}</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleDecide(pred.id, 'approved')}
                disabled={busyId === pred.id}
                className="btn btn-yes"
                style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: busyId === pred.id ? 0.5 : 1 }}
              >
                ✓ approve
              </button>
              <button
                onClick={() => handleDecide(pred.id, 'rejected')}
                disabled={busyId === pred.id}
                className="btn btn-no"
                style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: busyId === pred.id ? 0.5 : 1 }}
              >
                ✗ reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 999,
      padding: '6px 14px', fontSize: 13, fontWeight: 600, color,
    }}>
      {children}
    </span>
  )
}
