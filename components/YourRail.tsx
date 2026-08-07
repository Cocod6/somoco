'use client'

// Somoco — "your positions" right rail
//
// A permanent at-a-glance panel for the connected wallet's own money, split in
// two the way a bettor thinks about it:
//   1. your predictions — markets still running, coloured by whether the side
//      you backed is currently ahead (green), behind (red), or past lock and
//      waiting on the resolver (amber)
//   2. predictions won  — settled markets your side won, with the payout and
//      whether it's still sitting there unclaimed
//
// Positions are read from the factory, not the database, so stakes on OTHER
// people's predictions appear here too. The database is only asked for the
// human-readable question text behind each termId.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther, type Address } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { getMyPositions, type MyPosition } from '@/lib/predictions/settlement'

/** Compact $TRUST amount — enough precision to recognise your own stake. */
function trust(wei: bigint): string {
  const n = Number(formatEther(wei))
  if (n === 0) return '0'
  if (n < 0.01) return '<0.01'
  return n.toFixed(n < 1 ? 3 : 2).replace(/\.?0+$/, '')
}

function questionOf(p: PredictionRecord): string {
  const cond = p.condition && p.condition !== 'no condition' ? ` ${p.condition}` : ''
  return `${p.subject} ${p.claim}${cond}?`
}

type Tone = 'up' | 'down' | 'wait' | 'won' | 'void'

const TONE: Record<Tone, { color: string; bg: string; border: string }> = {
  up:   { color: 'var(--accent)',  bg: 'var(--accent-dark)', border: 'var(--accent-border)' },
  down: { color: '#ff6b6b',        bg: '#1a0a0a',            border: '#3d1a1a' },
  wait: { color: 'var(--amber)',   bg: 'var(--amber-bg)',    border: 'var(--amber-border)' },
  won:  { color: 'var(--accent)',  bg: 'var(--accent-dark)', border: 'var(--accent-border)' },
  void: { color: 'var(--text-muted)', bg: '#161616',         border: '#262626' },
}

/** Which side the wallet backed, and how much is riding on it. */
function mySide(p: MyPosition): { side: 'yes' | 'no' | 'both'; amount: bigint } {
  if (p.myYes > 0n && p.myNo > 0n) return { side: 'both', amount: p.myYes + p.myNo }
  if (p.myYes > 0n) return { side: 'yes', amount: p.myYes }
  return { side: 'no', amount: p.myNo }
}

/**
 * Reads a live position as a status line.
 *
 * "ahead"/"behind" is the parimutuel truth: your payout comes from the OTHER
 * side's pool, so the side with less money staked on it is the one currently
 * paying better. Backing the smaller pool is winning on odds — which is why a
 * green row means your side is the minority, not the majority.
 */
function liveStatus(p: MyPosition): { tone: Tone; label: string } {
  if (p.state === 'voided') return { tone: 'void', label: 'voided · refund' }
  if (p.state === 'locked') return { tone: 'wait', label: 'locked · awaiting result' }

  const { side } = mySide(p)
  if (side === 'both') return { tone: 'wait', label: 'both sides · hedged' }

  const mine = side === 'yes' ? p.poolYes : p.poolNo
  const theirs = side === 'yes' ? p.poolNo : p.poolYes
  if (theirs === 0n) return { tone: 'wait', label: 'no one against you yet' }
  if (mine === 0n) return { tone: 'up', label: 'paying well' }

  // Payout multiple on your stake if your side wins, ignoring the 3% fee.
  const ratio = Number(theirs) / Number(mine)
  if (ratio >= 1) return { tone: 'up', label: `ahead · ${(1 + ratio).toFixed(1)}x if right` }
  return { tone: 'down', label: `crowded · ${(1 + ratio).toFixed(1)}x if right` }
}

export default function YourRail({
  isConnected, address, onOpen,
}: {
  isConnected: boolean
  address?: string
  onOpen: (id: string) => void
}) {
  const [positions, setPositions] = useState<MyPosition[]>([])
  const [rows, setRows] = useState<Record<string, PredictionRecord>>({})
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const publicClient = usePublicClient()

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Disconnecting (or switching to a wallet mid-load) clears the rail —
      // done inside the async body so the effect never sets state synchronously.
      if (!isConnected || !address || !publicClient) {
        setPositions([])
        setRows({})
        return
      }
      setLoading(true)
      try {
        const found = await getMyPositions(publicClient, address as Address)
        if (cancelled) return
        setPositions(found)

        if (found.length > 0) {
          const { data } = await supabase
            .from('predictions')
            .select('*')
            .in('triple_id', found.map(p => p.termId))
          if (!cancelled) {
            const byTerm: Record<string, PredictionRecord> = {}
            for (const row of data ?? []) byTerm[row.triple_id] = row
            setRows(byTerm)
          }
        } else {
          setRows({})
        }
      } catch (e) {
        // The rail is a side panel — a read failure should never take the page
        // down, so it just stays empty.
        console.error('your-positions rail load error', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isConnected, address, publicClient, reloadKey])

  const { live, won } = useMemo(() => {
    const live: MyPosition[] = []
    const won: MyPosition[] = []
    for (const p of positions) {
      const iWon = p.state === 'resolved' &&
        ((p.outcome === 'yes' && p.myYes > 0n) || (p.outcome === 'no' && p.myNo > 0n))
      if (iWon) won.push(p)
      // A resolved market you lost gets no row at all — the money is gone and
      // the rail is for what you still have riding.
      else if (p.state !== 'resolved') live.push(p)
    }
    return { live, won }
  }, [positions])

  const unclaimed = useMemo(
    () => won.reduce((sum, p) => (p.claimed ? sum : sum + p.claimable), 0n),
    [won]
  )

  return (
    <div className="rail-panels">
      <Panel
        title="your predictions"
        count={live.length}
        onRefresh={isConnected ? refresh : undefined}
        loading={loading}
      >
        {!isConnected ? (
          <Empty>connect your wallet to track your positions</Empty>
        ) : loading && positions.length === 0 ? (
          <Skeletons />
        ) : live.length === 0 ? (
          <Empty>nothing riding yet — back a prediction and it shows up here</Empty>
        ) : (
          live.map(p => {
            const pred = rows[p.termId]
            const { side, amount } = mySide(p)
            const { tone, label } = liveStatus(p)
            return (
              <RailRow
                key={p.market}
                tone={tone}
                title={pred ? questionOf(pred) : `market ${p.market.slice(0, 8)}…`}
                side={side}
                amount={`${trust(amount)} $TRUST`}
                note={label}
                onClick={pred ? () => onOpen(pred.id) : undefined}
              />
            )
          })
        )}
      </Panel>

      <Panel
        title="predictions won"
        count={won.length}
        badge={unclaimed > 0n ? `${trust(unclaimed)} to claim` : undefined}
      >
        {!isConnected ? (
          <Empty>your wins will be listed here</Empty>
        ) : loading && positions.length === 0 ? (
          <Skeletons rows={2} />
        ) : won.length === 0 ? (
          <Empty>no settled wins yet</Empty>
        ) : (
          won.map(p => {
            const pred = rows[p.termId]
            const { side, amount } = mySide(p)
            const payout = p.claimable > 0n ? p.claimable : amount
            return (
              <RailRow
                key={p.market}
                tone="won"
                title={pred ? questionOf(pred) : `market ${p.market.slice(0, 8)}…`}
                side={side}
                amount={`+${trust(payout)} $TRUST`}
                note={p.claimed ? 'claimed' : p.claimable > 0n ? 'ready to claim →' : 'settled'}
                onClick={pred ? () => onOpen(pred.id) : undefined}
              />
            )
          })
        )}
      </Panel>
    </div>
  )
}

function Panel({
  title, count, badge, onRefresh, loading, children,
}: {
  title: string
  count?: number
  badge?: string
  onRefresh?: () => void
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <section style={{
      background: 'linear-gradient(180deg, #131313 0%, #0f0f0f 100%)',
      border: '1px solid var(--border)', borderRadius: 16, padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-0.2px' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="num" style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'var(--accent-text)',
          }}>
            {count}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {badge && (
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'var(--accent)', background: 'var(--accent-dark)',
            border: '1px solid var(--accent-border)', borderRadius: 999, padding: '3px 8px',
          }}>
            {badge}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="refresh your positions"
            title="refresh"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--text-dim)', fontSize: 13, lineHeight: 1,
              animation: loading ? 'spin 0.9s linear infinite' : undefined,
            }}
          >
            ↻
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  )
}

function RailRow({
  tone, title, side, amount, note, onClick,
}: {
  tone: Tone
  title: string
  side: 'yes' | 'no' | 'both'
  amount: string
  note: string
  onClick?: () => void
}) {
  const t = TONE[tone]
  return (
    <div
      onClick={onClick}
      className="rail-row"
      style={{ cursor: onClick ? 'pointer' : 'default', borderLeft: `2px solid ${t.color}` }}
    >
      {/* Question — clamped to two lines so one long prediction can't push the
          rest of the rail off screen. */}
      <div className="rail-row-title">{title}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
          textTransform: 'uppercase', borderRadius: 999, padding: '2px 7px',
          color: side === 'no' ? '#ff6b6b' : side === 'both' ? 'var(--text-muted)' : 'var(--accent)',
          background: side === 'no' ? '#1a0a0a' : side === 'both' ? '#161616' : 'var(--accent-dark)',
          border: `1px solid ${side === 'no' ? '#3d1a1a' : side === 'both' ? '#262626' : 'var(--accent-border)'}`,
        }}>
          {side}
        </span>
        <span className="num" style={{
          fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)',
        }}>
          {amount}
        </span>
      </div>

      <div style={{
        fontSize: 11, fontFamily: 'var(--font-mono)', marginTop: 6,
        color: t.color, background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: 6, padding: '3px 7px', display: 'inline-block',
      }}>
        {note}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
      lineHeight: 1.5, padding: '10px 2px',
    }}>
      {children}
    </div>
  )
}

function Skeletons({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, n) => (
        <div key={n} className="skeleton" style={{ height: 62, borderRadius: 10 }} />
      ))}
    </>
  )
}
