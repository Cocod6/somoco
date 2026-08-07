'use client'

// Somoco — Phase 3: resolution admin view
// Approved predictions that are due for resolution show up here AUTOMATICALLY
// — pulled from Somoco's own database (set up after approval), not from the
// shared public Intuition graph. No manual entry needed anymore.
//
// Fake test predictions (from mockData.ts) still appear too, for free,
// wallet-free UI testing — they're clearly marked and never touch real money.

import { useEffect, useState } from 'react'
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi'
import type { Hex } from 'viem'
import { mockPredictions } from '@/lib/predictions/mockData'
import { resolvePredictionOnChain } from '@/lib/predictions/resolveOnchain'
import { getMarketAddress, readMarketInfo, resolveMarket } from '@/lib/predictions/settlement'
import { signAdminAction } from '@/lib/adminSign'
import { supabase, type PredictionRecord } from '@/lib/supabase'

interface DisplayPrediction {
  id: string
  subject: string
  claim: string
  condition: string
  resolutionDate: string
  creatorDisplay: string
  status: 'pending' | 'resolved_true' | 'resolved_false'
  tripleId: Hex | null // null = fake test entry, real bytes32 = real prediction
  creatorAddress: string | null
  supabaseId: string | null // needed to update the database record on resolve
}

function daysUntil(resolutionDate: string): number {
  // Parse "YYYY-MM-DD" as LOCAL midnight — new Date(string) would read it as
  // UTC, which in any timezone ahead of UTC makes a prediction due today show
  // as "due in 1d" and keeps it out of the "due now" tab until a day late.
  const [y, m, d] = resolutionDate.split('-').map(Number)
  const target = new Date(y, (m || 1) - 1, d || 1)
  const today = new Date()
  const diffMs = target.getTime() - today.setHours(0, 0, 0, 0)
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function statusLabel(resolutionDate: string): { text: string; color: string } {
  const days = daysUntil(resolutionDate)
  if (days < 0) return { text: `overdue by ${Math.abs(days)}d`, color: '#ff6b6b' }
  if (days === 0) return { text: 'due today', color: 'var(--amber)' }
  return { text: `due in ${days}d`, color: 'var(--text-muted)' }
}

function fromRecord(r: PredictionRecord): DisplayPrediction {
  return {
    id: r.id,
    subject: r.subject,
    claim: r.claim,
    condition: r.condition ?? 'no condition',
    resolutionDate: r.resolution_date ?? new Date().toISOString().slice(0, 10),
    creatorDisplay: `${r.creator_address.slice(0, 6)}...${r.creator_address.slice(-4)}`,
    status: r.resolution_status === 'unresolved' ? 'pending' : r.resolution_status,
    tripleId: r.triple_id as Hex,
    creatorAddress: r.creator_address,
    supabaseId: r.id,
  }
}

function fromMock(m: typeof mockPredictions[number]): DisplayPrediction {
  return {
    id: m.id,
    subject: m.subject,
    claim: m.claim,
    condition: m.condition,
    resolutionDate: m.resolutionDate,
    creatorDisplay: m.creator,
    status: m.status,
    tripleId: null,
    creatorAddress: null,
    supabaseId: null,
  }
}

export default function ResolveAdmin({ isConnected }: { isConnected: boolean }) {
  const [predictions, setPredictions] = useState<DisplayPrediction[]>(mockPredictions.map(fromMock))
  const [filter, setFilter] = useState<'due' | 'all' | 'resolved'>('due')
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTxHash, setLastTxHash] = useState<string | null>(null)
  // Portal links for the Triples created by resolving, keyed by prediction id
  // reputation is nullable: the auto-settler skips that Triple for imported
  // markets (see resolveOnchain's includeReputation). This admin flow always
  // writes it, but the type has to allow the absence.
  const [resolutionLinks, setResolutionLinks] = useState<Record<string, { resolution: string; reputation: string | null }>>({})
  const [loadingReal, setLoadingReal] = useState(true)

  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()

  useEffect(() => {
    const loadApproved = async () => {
      setLoadingReal(true)
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'approved')
        .order('resolution_date', { ascending: true })

      if (!fetchError && data) {
        const realOnes = data.map(fromRecord)
        // Keep fake test entries + merge in real approved ones (real ones first)
        setPredictions(prev => {
          const fakeOnly = prev.filter(p => p.tripleId === null)
          return [...realOnes, ...fakeOnly]
        })
      }
      setLoadingReal(false)
    }

    loadApproved()
  }, [])

  const handleResolve = async (pred: DisplayPrediction, outcome: 'resolved_true' | 'resolved_false') => {
    setError(null)

    // FAKE test prediction — just simulate locally, no wallet needed
    if (!pred.tripleId || !pred.creatorAddress) {
      setPredictions(prev => prev.map(p => (p.id === pred.id ? { ...p, status: outcome } : p)))
      return
    }

    // REAL prediction — this writes actual Triples on-chain
    if (!isConnected || !walletClient || !publicClient) {
      alert('Connect your wallet first to resolve a real prediction.')
      return
    }

    setResolvingId(pred.id)

    // Settlement pool pre-check: if this prediction has a market that is still
    // OPEN (staking hasn't locked), block the whole resolution — resolving the
    // Triples now would leave the money pool stranded with no UI path to
    // settle it later. The contract itself also rejects resolving an open
    // market; this check just fails fast with a clearer message.
    let settlementMarket: `0x${string}` | null = null
    try {
      settlementMarket = await getMarketAddress(publicClient, pred.tripleId)
      if (settlementMarket) {
        const info = await readMarketInfo(publicClient, settlementMarket)
        if (info.state === 'open') {
          const locks = new Date(info.lockAt * 1000).toLocaleString()
          setError(`The settlement pool is still open for staking (locks ${locks}). Resolve after it locks.`)
          setResolvingId(null)
          return
        }
        if (info.state === 'resolved' || info.state === 'voided') {
          settlementMarket = null // pool already settled — nothing more to do there
        }
      }
    } catch (err) {
      console.error('settlement pre-check failed', err)
      settlementMarket = null // fail open: Triple resolution can proceed without the pool
    }

    try {
      const result = await resolvePredictionOnChain({
        publicClient,
        walletClient,
        chainId,
        predictionTripleId: pred.tripleId,
        creatorAddress: pred.creatorAddress,
        outcome: outcome === 'resolved_true' ? 'true' : 'false',
      })
      setLastTxHash(result.txHash)
      setResolutionLinks(prev => ({
        ...prev,
        [pred.id]: { resolution: result.resolutionTripleId, reputation: result.reputationTripleId },
      }))

      // Settle the money pool (if one exists and is locked): declares the
      // outcome on the PredictionMarket contract so winners can claim.
      // The connected admin wallet must be the contract's resolver.
      if (settlementMarket) {
        try {
          const marketTx = await resolveMarket(
            publicClient,
            walletClient,
            settlementMarket,
            outcome === 'resolved_true' ? 'yes' : 'no'
          )
          setLastTxHash(marketTx)
        } catch (err) {
          const message = err instanceof Error ? err.message.split('\n')[0] : 'settlement failed'
          setError(`Triples resolved, but the settlement pool did not settle: ${message}`)
        }
      }

      // Update Somoco's own record to reflect the real resolution. This is a
      // privileged write, so it goes through the server and needs an admin
      // signature — the on-chain tx above already proved the admin is present,
      // but the DB write needs its own proof (see lib/adminAuth.ts).
      if (pred.supabaseId && address) {
        try {
          const auth = await signAdminAction(walletClient, address, outcome, pred.supabaseId)
          const res = await fetch('/api/admin/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: pred.supabaseId,
              outcome,
              txHash: result.txHash,
              auth,
            }),
          })
          if (!res.ok) {
            const { error: apiError } = await res.json().catch(() => ({ error: res.statusText }))
            // The chain is already updated — surface this without implying the
            // resolution itself failed, because it didn't.
            setError(
              `Resolved on-chain, but Somoco's own record did not update: ${apiError ?? res.statusText}`
            )
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'signature declined'
          setError(`Resolved on-chain, but Somoco's own record did not update: ${message}`)
        }
      }

      setPredictions(prev => prev.map(p => (p.id === pred.id ? { ...p, status: outcome } : p)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Resolution failed.'
      setError(`On-chain resolution failed: ${message}`)
    } finally {
      setResolvingId(null)
    }
  }

  const visible = predictions.filter(p => {
    if (filter === 'all') return true
    if (filter === 'resolved') return p.status !== 'pending'
    return p.status === 'pending' && daysUntil(p.resolutionDate) <= 0
  })

  const dueCount = predictions.filter(
    p => p.status === 'pending' && daysUntil(p.resolutionDate) <= 0
  ).length

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        resolve predictions
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {'// approved predictions appear here automatically once due'}
      </div>

      {error && (
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: '#ff44441a',
          borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error}
        </div>
      )}

      {lastTxHash && (
        <a
          href={`https://explorer.intuition.systems/tx/${lastTxHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'block', fontSize: 12, color: 'var(--accent)',
            fontFamily: 'var(--font-mono)', marginBottom: 16, textDecoration: 'underline',
          }}
        >
          view last resolution transaction on explorer ↗
        </a>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'due', label: `due now (${dueCount})` },
          { id: 'all', label: 'all' },
          { id: 'resolved', label: 'resolved' },
        ].map(tab => (
          // Same filter pills as the feed's category tabs — one vocabulary.
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as typeof filter)}
            className={`chip${filter === tab.id ? ' active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
        {loadingReal && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
            loading approved predictions...
          </span>
        )}
      </div>

      {visible.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          nothing here right now
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visible.map(pred => (
          <PredictionCard
            key={pred.id}
            prediction={pred}
            onResolve={handleResolve}
            isResolving={resolvingId === pred.id}
            portalLinks={resolutionLinks[pred.id]}
          />
        ))}
      </div>
    </div>
  )
}

function PredictionCard({
  prediction,
  onResolve,
  isResolving,
  portalLinks,
}: {
  prediction: DisplayPrediction
  onResolve: (pred: DisplayPrediction, outcome: 'resolved_true' | 'resolved_false') => void
  isResolving: boolean
  portalLinks?: { resolution: string; reputation: string | null }
}) {
  const status = statusLabel(prediction.resolutionDate)
  const isResolved = prediction.status !== 'pending'
  const isReal = prediction.tripleId !== null

  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${isReal ? 'var(--accent-border)' : 'var(--border)'}`,
      borderRadius: 14, padding: 20,
    }}>
      {isReal && (
        <div style={{
          display: 'inline-block', fontSize: 10, color: 'var(--accent)',
          fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 10,
          background: 'var(--accent-dark)', border: '1px solid var(--accent-border)',
          borderRadius: 999, padding: '3px 10px',
        }}>
          REAL · ON-CHAIN
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Pill color="var(--blue)">{prediction.subject}</Pill>
        <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
        <Pill color="var(--purple)">{prediction.claim}</Pill>
        <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
        <Pill color="var(--amber)">{prediction.condition}</Pill>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)',
        fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span>by {prediction.creatorDisplay}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          <span>judgment day: {prediction.resolutionDate}</span>
          {!isResolved && <span style={{ color: status.color }}>{status.text}</span>}
        </span>
      </div>

      {/* Every real prediction links to its Triple on the Intuition portal */}
      {isReal && prediction.tripleId && (
        <a
          href={`https://portal.intuition.systems/explore/triple/${prediction.tripleId}?tab=positions`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-block', fontSize: 12, color: 'var(--blue)',
            fontFamily: 'var(--font-mono)', textDecoration: 'underline', marginBottom: 14,
          }}
        >
          view prediction on intuition portal ↗
        </a>
      )}

      {!isResolved ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => onResolve(prediction, 'resolved_true')}
            disabled={isResolving}
            className="btn btn-yes"
            style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: isResolving ? 0.5 : 1 }}
          >
            {isResolving ? '⟳ resolving...' : '✓ mark true'}
          </button>
          <button
            onClick={() => onResolve(prediction, 'resolved_false')}
            disabled={isResolving}
            className="btn btn-no"
            style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: isResolving ? 0.5 : 1 }}
          >
            ✗ mark false
          </button>
        </div>
      ) : (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: prediction.status === 'resolved_true' ? 'var(--accent-dark)' : '#1a0a0a',
            color: prediction.status === 'resolved_true' ? 'var(--accent)' : '#ff6b6b',
            border: `1px solid ${prediction.status === 'resolved_true' ? 'var(--accent-border)' : '#3d1a1a'}`,
            borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 700,
            marginBottom: 10,
          }}>
            {prediction.status === 'resolved_true' ? '✓ resolved true' : '✗ resolved false'}
          </div>

          <div style={{
            background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 8,
            padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'var(--text-dim)', lineHeight: 1.8,
          }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{'// resolution triple → '}</span>
              [prediction] [resolved] [{prediction.status === 'resolved_true' ? 'true' : 'false'}]
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{'// reputation triple → '}</span>
              [{prediction.creatorDisplay}] [{prediction.status === 'resolved_true' ? 'correctly' : 'incorrectly'} predicted] [prediction]
            </div>
            {isReal && (
              <div style={{ marginTop: 6, color: 'var(--accent)' }}>
                ✓ written for real on intuition mainnet
              </div>
            )}
          </div>

          {/* Portal links to the two Triples this resolution just created */}
          {portalLinks && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <a
                href={`https://portal.intuition.systems/explore/triple/${portalLinks.resolution}?tab=positions`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', textDecoration: 'underline' }}
              >
                view resolution triple on intuition portal ↗
              </a>
              {portalLinks.reputation && (
                <a
                  href={`https://portal.intuition.systems/explore/triple/${portalLinks.reputation}?tab=positions`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', textDecoration: 'underline' }}
                >
                  view reputation triple on intuition portal ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}
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
