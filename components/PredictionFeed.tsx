'use client'

// Somoco — Prediction feed (open predictions only)
// Shows predictions that are approved AND still open (unresolved) — the ones a
// user can still form a view on. Resolved predictions live on the Leaderboard
// and My Predictions, not here. Odds and volume come from each prediction's
// settlement pool (the real-money market) — the Intuition bonding-curve
// conviction display was removed 2026-07-22 when in-app staking replaced the
// portal handoff. Cards without a pool simply omit the odds.

import { useEffect, useMemo, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { formatEther, type Hex } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { getPoolsForTerms, type TermPools } from '@/lib/predictions/settlement'
import { CATEGORIES, categorize } from '@/lib/predictions/categories'
import Hero, { useHeroDismissed, setHeroDismissed } from './Hero'

// Pool → display helpers. Odds are the YES share of the total pool.
function poolTotal(t: TermPools): number {
  return Number(formatEther(t.poolYes + t.poolNo))
}
function yesPctOf(t: TermPools): number {
  const total = t.poolYes + t.poolNo
  if (total === 0n) return 0
  return Math.round(Number((t.poolYes * 1000n) / total) / 10)
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

/** The prediction as one readable market question. */
function questionOf(p: PredictionRecord): string {
  const cond = p.condition && p.condition !== 'no condition' ? ` ${p.condition}` : ''
  return `${p.subject} ${p.claim}${cond}?`
}

export default function PredictionFeed({ onSubmit, onOpen }: { onSubmit: () => void; onOpen: (id: string) => void }) {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([])
  const [stakes, setStakes] = useState<Record<string, TermPools>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState('all')
  const [query, setQuery] = useState('')
  const publicClient = usePublicClient()
  const { isConnected } = useAccount()
  // The intro is for people who haven't started yet: it goes as soon as a
  // wallet is connected, and can be dismissed before that.
  const heroDismissed = useHeroDismissed()
  const showHero = !isConnected && !heroDismissed

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      // Open predictions only: approved and not yet resolved.
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'approved')
        .eq('resolution_status', 'unresolved')
        .order('created_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      // Friend markets are excluded here rather than in the query on purpose:
      // `is_private` is a late column, and a WHERE clause naming a column the
      // live DB doesn't have yet fails the whole request and empties the feed.
      // Filtering in JS degrades to "everything is public", which is the old
      // behaviour rather than a blank page.
      const rows = (data ?? []).filter(p => p.is_private !== true)
      setPredictions(rows)
      setLoading(false)
    }

    load()
  }, [])

  // Fetch settlement pools in the background — the feed renders immediately
  // and odds fill in when ready.
  useEffect(() => {
    if (!publicClient || predictions.length === 0) return
    let cancelled = false
    const loadPools = async () => {
      const pools = await getPoolsForTerms(publicClient, predictions.map(r => r.triple_id as Hex))
      if (!cancelled) setStakes(pools)
    }
    loadPools()
    return () => { cancelled = true }
  }, [publicClient, predictions])

  const stats = useMemo(() => {
    const pools = Object.values(stakes).filter(t => t.poolYes + t.poolNo > 0n)
    const totalStaked = pools.reduce((sum, t) => sum + poolTotal(t), 0)
    const avgConviction = pools.length > 0
      ? Math.round(pools.reduce((sum, t) => sum + yesPctOf(t), 0) / pools.length)
      : null
    return { live: predictions.length, totalStaked, avgConviction }
  }, [predictions, stakes])

  // Search first, then categories: the category counts describe what the search
  // actually turned up, so a chip never promises results the search has already
  // filtered away. Matching is plain substring across everything a person might
  // reasonably type — the words of the prediction, or a creator's address.
  const { tabs, visible, effectiveCat } = useMemo(() => {
    // Prefer the stored category (set by the parser at submit time); fall back to
    // keyword derivation for rows created before the category column existed.
    const catOf = (p: PredictionRecord) => p.category || categorize(p)

    const q = query.trim().toLowerCase()
    const matches = q
      ? predictions.filter(p =>
          [p.subject, p.claim, p.condition, p.creator_address, p.resolution_date]
            .some(field => field?.toLowerCase().includes(q)))
      : predictions

    const counts: Record<string, number> = { all: matches.length }
    for (const p of matches) {
      const c = catOf(p)
      counts[c] = (counts[c] || 0) + 1
    }
    const tabs = CATEGORIES
      .filter(c => c.id === 'all' || (counts[c.id] ?? 0) > 0)
      .map(c => ({ ...c, count: counts[c.id] ?? 0 }))
    // If a search empties the category you were on, fall back to all matches
    // rather than showing a blank page next to a chip row that no longer has
    // your category in it.
    const effectiveCat = (counts[activeCat] ?? 0) > 0 ? activeCat : 'all'
    const visible = effectiveCat === 'all'
      ? matches
      : matches.filter(p => catOf(p) === effectiveCat)
    return { tabs, visible, effectiveCat }
  }, [predictions, activeCat, query])

  return (
    <div>
      {showHero && <Hero onSubmit={onSubmit} />}

      {/* Stats — all about the open set. Layout lives in globals.css so the
          height tiers there can tighten it on a short screen. */}
      <div className="feed-stats">
        {[
          { label: 'predictions live', value: String(stats.live), sub: 'open' },
          { label: 'total staked', value: stats.totalStaked > 0 ? stats.totalStaked.toFixed(2) : '—', sub: '$TRUST' },
          { label: 'avg conviction', value: stats.avgConviction !== null ? `${stats.avgConviction}%` : '—', sub: 'for' },
        ].map(s => (
          <div key={s.label} className="stat-tile fade-up">
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {s.label}
            </div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>
              {s.value}{' '}
              <span style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 500 }}>{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Search — filters the loaded feed as you type. No round trip: the feed
          already holds every open prediction, so searching is instant and
          works offline of the database. */}
      <div className="feed-search">
        <span style={{
          position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          fontSize: 13, color: 'var(--text-dim)', pointerEvents: 'none',
        }}>
          ⌕
        </span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search predictions…"
          aria-label="search predictions"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="clear search"
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Category tabs — Polymarket-style sections, derived from prediction text */}
      {tabs.length > 1 && (
        <div className="feed-chips">
          {tabs.map(t => {
            const active = t.id === effectiveCat
            return (
              <button
                key={t.id}
                onClick={() => setActiveCat(t.id)}
                className={`chip${active ? ' active' : ''}`}
              >
                <span style={{ fontSize: 13 }}>{t.icon}</span>
                {t.label}
                <span style={{
                  fontSize: 11, opacity: 0.7, fontWeight: 500,
                  color: active ? 'var(--bg)' : 'var(--text-dim)',
                }}>
                  {t.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="feed-heading">
        <span style={{ fontSize: 15, fontWeight: 700 }}>
          {effectiveCat === 'all' ? 'open predictions' : `${CATEGORIES.find(c => c.id === effectiveCat)?.label.toLowerCase()} predictions`}
        </span>
        {/* A way back to the explanation once it's been dismissed — otherwise
            hiding it once hides it forever. */}
        {!showHero && !isConnected && (
          <button
            onClick={() => setHeroDismissed(false)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11,
              textDecoration: 'underline',
            }}
          >
            what is somoco?
          </button>
        )}
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

      {/* Six skeletons, one per card slot, at the real card height — the grid
          doesn't jump when the markets land. */}
      {loading && (
        <div className="card-grid">
          {[0, 1, 2, 3, 4, 5].map(n => (
            <div key={n} className="skeleton" style={{ height: 320 }} />
          ))}
        </div>
      )}

      {!loading && visible.length === 0 && !error && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 16,
        }}>
          {predictions.length === 0
            ? 'no open predictions yet — be the first'
            : `no open predictions in ${CATEGORIES.find(c => c.id === activeCat)?.label.toLowerCase()} yet`}
        </div>
      )}

      {/* Cards — a fixed-height grid. Every card is exactly the same size no
          matter how long the prediction is or whether it has a picture, so rows
          line up and six markets fit on a laptop screen at once. The parts that
          vary in height (resolution sources, the "how it resolves" expander,
          the Intuition link) moved to the detail view; what's left is what you
          need to decide whether to open one. */}
      {!loading && (
      <div className="card-grid">
      {visible.map((p, i) => {
        const cat = CATEGORIES.find(c => c.id === (p.category || categorize(p)))
        // Only a pool with money in it says anything about odds.
        const stake = stakes[p.triple_id]
        const pool = stake && stake.poolYes + stake.poolNo > 0n ? stake : null
        const yesPct = pool ? yesPctOf(pool) : null
        return (
          <div key={p.id} onClick={() => onOpen(p.id)}
            className="spice-card fade-up feed-card"
            style={{ animationDelay: `${Math.min(i * 60, 480)}ms` }}
          >
            {/* Who asked, and what kind of question it is */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#bbb', fontFamily: 'var(--font-mono)' }}>
                {shortAddr(p.creator_address)}
              </span>
              {cat && cat.id !== 'other' && (
                // minWidth:0 lets a long category name shrink and ellipsis
                // instead of shoving the review flag out of the card.
                <span className="chip-mini" style={{
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis', minWidth: 0, display: 'block',
                }}>
                  {cat.icon} {cat.label}
                </span>
              )}
            </div>

            {/* The creator's picture, or a category placeholder — so a card with
                no image is still exactly the same shape as one with. */}
            <div className="feed-card-media">
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" loading="lazy" />
              ) : (
                <span style={{ fontSize: 26, opacity: 0.22 }}>{cat?.icon ?? '◎'}</span>
              )}
            </div>

            {/* The prediction, in full. The one-line "subject → claim →
                condition" strip that used to sit here was the same words again
                in a smaller font, and it was the thing that kept ellipsising —
                the Triple belongs on the detail view, not squeezed onto a card. */}
            <div className="feed-card-title">{questionOf(p)}</div>

            {/* One meta line: the pool while there's money in it, else the date */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            }}>
              {pool ? (
                <>
                  <div className="bar-track" style={{ flex: 1, height: 5 }}>
                    <div className="bar-fill" style={{ width: `${yesPct}%` }} />
                  </div>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>
                    {poolTotal(pool).toFixed(2)} $TRUST
                  </span>
                </>
              ) : (
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ⏱ {p.resolution_date ?? 'no date set'}
                </span>
              )}
            </div>

            {/* Yes / No — price = pool odds. Both open the detail view, where
                in-app staking lives. Pinned to the bottom of the fixed-height
                card, so every row of buttons lines up across the grid. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 10 }}>
              <button
                onClick={e => { e.stopPropagation(); onOpen(p.id) }}
                className="btn btn-yes"
                style={{ flex: 1, justifyContent: 'space-between', borderRadius: 10, padding: '9px 12px', fontSize: 13 }}
              >
                <span>Yes</span>
                <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{yesPct !== null ? `${yesPct}¢` : '—'}</span>
              </button>
              <button
                onClick={e => { e.stopPropagation(); onOpen(p.id) }}
                className="btn btn-no"
                style={{ flex: 1, justifyContent: 'space-between', borderRadius: 10, padding: '9px 12px', fontSize: 13 }}
              >
                <span>No</span>
                <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{yesPct !== null ? `${100 - yesPct}¢` : '—'}</span>
              </button>
            </div>
          </div>
        )
      })}
      </div>
      )}

      <button onClick={onSubmit} className="cta-dashed" style={{
        width: '100%', marginTop: 12, padding: '14px 0', borderRadius: 14,
        fontSize: 13, fontFamily: 'var(--font-mono)',
      }}>
        + submit your own prediction
      </button>
    </div>
  )
}
