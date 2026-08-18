'use client'

// Somoco — My predictions
// Everything the connected wallet has submitted through Somoco, pulled from
// Somoco's own database (not the wider Intuition graph — this only shows
// things that genuinely went through Somoco's own submission flow).
//
// Grouped by lifecycle stage:
//   1. submitted — waiting in the admin approval queue (or rejected)
//   2. open      — approved, market live, still unresolved
//   3. closed    — resolved true/false; claim winnings here (resolved
//                  predictions drop out of the feed, so the claim button
//                  must stay reachable on this page)

import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { getMyStakedTerms } from '@/lib/predictions/settlement'
import { CATEGORIES, categorize } from '@/lib/predictions/categories'
import ResolutionPlanBadge from './ResolutionPlanBadge'
import SettlementPanel from './SettlementPanel'
import ResolutionReceipt from './ResolutionReceipt'

type GroupId = 'submitted' | 'open' | 'closed' | 'staked'

const GROUPS: { id: GroupId; icon: string; label: string; blurb: string }[] = [
  { id: 'submitted', icon: '📝', label: 'submitted', blurb: 'waiting for approval — not on the feed yet' },
  { id: 'open', icon: '🟢', label: 'open', blurb: 'live on the feed — the world can stake on these' },
  { id: 'closed', icon: '🏁', label: 'closed', blurb: 'resolved — claim any winnings below' },
  { id: 'staked', icon: '💰', label: 'staked', blurb: "markets you've put $TRUST into — including other people's predictions" },
]

function groupOf(p: PredictionRecord): GroupId {
  if (p.resolution_status !== 'unresolved') return 'closed'
  if (p.approval_status === 'approved') return 'open'
  return 'submitted' // pending or rejected
}

// Build a readable market question, dropping the "no condition" placeholder.
function questionOf(p: PredictionRecord): string {
  const cond = p.condition && p.condition !== 'no condition' ? ` ${p.condition}` : ''
  return `${p.subject} ${p.claim}${cond}?`
}

function statusChip(p: PredictionRecord): { text: string; color: string; bg: string; border: string } {
  if (p.resolution_status === 'resolved_true')
    return { text: '✓ resolved true', color: 'var(--accent)', bg: 'var(--accent-dark)', border: 'var(--accent-border)' }
  if (p.resolution_status === 'resolved_false')
    return { text: '✗ resolved false', color: '#ff6b6b', bg: '#1a0a0a', border: '#3d1a1a' }
  if (p.resolution_status === 'voided')
    return { text: '⊘ voided — refunded', color: 'var(--text-muted)', bg: '#141414', border: 'var(--border)' }
  if (p.approval_status === 'approved')
    return { text: 'open', color: '#7ab832', bg: '#0f1a0a', border: '#2a3d1a' }
  if (p.approval_status === 'rejected')
    return { text: 'rejected', color: '#ff6b6b', bg: '#1a0a0a', border: '#3d1a1a' }
  return { text: 'pending approval', color: 'var(--amber)', bg: '#1a150a', border: '#3d2f1a' }
}

export default function MyPredictions({
  isConnected, address, onOpen,
}: {
  isConnected: boolean
  address?: string
  onOpen?: (id: string) => void
}) {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null until the user picks a tab — then we default to the first group
  // that actually has predictions in it.
  const [activeTab, setActiveTab] = useState<GroupId | null>(null)
  // Markets this wallet has staked in — found by asking the factory itself,
  // so stakes on OTHER people's predictions show up too.
  const [stakedPreds, setStakedPreds] = useState<PredictionRecord[]>([])
  const publicClient = usePublicClient()

  useEffect(() => {
    const load = async () => {
      // Disconnected: the render below early-returns to the connect panel,
      // so there's nothing to load (or show) here.
      if (!isConnected || !address) return
      setLoading(true)
      setError(null)
      // Case-insensitive match — wallet addresses can show up in different casing
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .ilike('creator_address', address)
        .order('created_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setPredictions(data ?? [])
      }
      setLoading(false)
    }

    load()
  }, [isConnected, address])

  useEffect(() => {
    if (!isConnected || !address || !publicClient) return
    let cancelled = false
    const loadStaked = async () => {
      try {
        const terms = await getMyStakedTerms(publicClient, address as Address)
        if (terms.length === 0) { if (!cancelled) setStakedPreds([]); return }
        const { data } = await supabase
          .from('predictions')
          .select('*')
          .in('triple_id', terms)
          .order('created_at', { ascending: false })
        if (!cancelled) setStakedPreds(data ?? [])
      } catch (e) {
        console.error('staked markets load error', e)
      }
    }
    loadStaked()
    return () => { cancelled = true }
  }, [isConnected, address, publicClient])

  const grouped = useMemo(() => {
    const g: Record<GroupId, PredictionRecord[]> = { submitted: [], open: [], closed: [], staked: [] }
    for (const p of predictions) g[groupOf(p)].push(p)
    g.staked = stakedPreds
    return g
  }, [predictions, stakedPreds])

  if (!isConnected) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 48, textAlign: 'center',
        // This page has no side rail, so an uncapped panel stretches the full
        // width of a desktop window with one line of text marooned in it.
        maxWidth: 560, margin: '0 auto',
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>my predictions</div>
        <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          connect your wallet (top right) to see your predictions
        </div>
      </div>
    )
  }

  // No "all" tab: the active tab defaults to the first non-empty group.
  const currentTab = activeTab ?? GROUPS.find(g => grouped[g.id].length > 0)?.id ?? 'open'
  const visibleGroups = GROUPS.filter(g => g.id === currentTab && grouped[g.id].length > 0)

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        my predictions
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
        {"// everything you've submitted through somoco"}
      </div>

      {/* Lifecycle tabs — no "all": one group at a time */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 20, scrollbarWidth: 'none' }}>
        {GROUPS.map(g => {
          const active = currentTab === g.id
          return (
            <button key={g.id} onClick={() => setActiveTab(g.id)} className={`chip${active ? ' active' : ''}`}>
              <span style={{ fontSize: 13 }}>{g.icon}</span>
              {g.label}
              <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 500, color: active ? 'var(--bg)' : 'var(--text-dim)' }}>
                {grouped[g.id].length}
              </span>
            </button>
          )
        })}
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

      {loading && (
        <div>
          {[0, 1, 2].map(n => (
            <div key={n} className="skeleton" style={{ height: 140, marginBottom: 12 }} />
          ))}
        </div>
      )}

      {!loading && predictions.length === 0 && !error && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          you haven&apos;t submitted any predictions yet
        </div>
      )}

      {!loading && predictions.length > 0 && visibleGroups.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          nothing in this group yet
        </div>
      )}

      {visibleGroups.map(g => (
        <section key={g.id} style={{ marginBottom: 28 }}>
          {/* Group header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>
              {g.icon} {g.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {grouped[g.id].length}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
            {'// '}{g.blurb}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {grouped[g.id].map((pred, i) => (
              <PredictionCard key={pred.id} pred={pred} index={i} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function PredictionCard({
  pred, index, onOpen,
}: {
  pred: PredictionRecord
  index: number
  onOpen?: (id: string) => void
}) {
  const chip = statusChip(pred)
  const cat = CATEGORIES.find(c => c.id === (pred.category || categorize(pred)))
  const created = pred.created_at ? new Date(pred.created_at).toLocaleDateString() : null

  return (
    <div
      className="spice-card fade-up"
      style={{ borderRadius: 14, padding: 18, animationDelay: `${Math.min(index * 60, 480)}ms` }}
    >
      {/* Top row: status + category + created date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            background: chip.bg, color: chip.color, border: `1px solid ${chip.border}`,
            borderRadius: 999, padding: '4px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
          }}>
            {chip.text}
          </span>
          {cat && cat.id !== 'other' && (
            <span className="chip-mini">{cat.icon} {cat.label}</span>
          )}
        </div>
        {created && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {created}
          </span>
        )}
      </div>

      {/* The prediction as a readable market question */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        {pred.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pred.image_url}
            alt=""
            style={{
              width: 56, height: 56, objectFit: 'cover', borderRadius: 10,
              border: '1px solid var(--border)', flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.35, letterSpacing: '-0.2px' }}>
            {questionOf(pred)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {pred.subject} <span style={{ color: 'var(--text-muted)' }}>→</span> {pred.claim}
            {pred.condition && pred.condition !== 'no condition' && (
              <> <span style={{ color: 'var(--text-muted)' }}>→</span> {pred.condition}</>
            )}
          </div>
        </div>
      </div>

      {/* Your own submission can still be sitting in the queue, and that's
          worth telling you about — but only while it's actually pending.
          Once it's approved it's published, and once it's rejected "held for
          review" would be a lie. */}
      <ResolutionPlanBadge
        plan={pred.resolution_plan}
        showReviewFlag={pred.approval_status === 'pending'}
      />

      {/* Why it ended the way it did. Sits directly above the claim button, so
          whoever is about to collect (or discover they can't) reads the source
          in the same glance. */}
      {pred.resolution_status !== 'unresolved' && (
        <div style={{ marginTop: 12 }}>
          <ResolutionReceipt prediction={pred} />
        </div>
      )}

      {/* Settlement pool: stake while open, CLAIM winnings/refunds here after
          resolution. Renders nothing if this prediction has no market. */}
      <div style={{ marginTop: 12 }}>
        <SettlementPanel termId={pred.triple_id as Hex} />
      </div>

      {/* Footer: judgment day + links */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        paddingTop: 12, borderTop: '1px solid var(--border)', marginTop: 12,
      }}>
        <span>judgment day: {pred.resolution_date ?? 'not set'}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          {onOpen && (
            <button
              onClick={() => onOpen(pred.id)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', fontSize: 12,
                textDecoration: 'underline',
              }}
            >
              view market →
            </button>
          )}
          <a
            href={`https://portal.intuition.systems/explore/triple/${pred.triple_id}?tab=positions`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--blue)', textDecoration: 'underline' }}
          >
            intuition ↗
          </a>
        </span>
      </div>
    </div>
  )
}
