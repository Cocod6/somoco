'use client'

// Somoco — Trending
// Ranks currently-open (approved, unresolved) predictions by how much real
// $TRUST sits in their settlement pools (the in-app money markets).
// Predictions with no pool (or an empty one) fall to the bottom, ordered by
// recency, so the page is still useful before markets fill up.

import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatEther, type Hex } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { getPoolsForTerms, type TermPools } from '@/lib/predictions/settlement'

interface Ranked {
  pred: PredictionRecord
  pools: TermPools | null
}

function totalOf(t: TermPools | null): number {
  return t ? Number(formatEther(t.poolYes + t.poolNo)) : 0
}
function yesPctOf(t: TermPools): number {
  const total = t.poolYes + t.poolNo
  if (total === 0n) return 0
  return Math.round(Number((t.poolYes * 1000n) / total) / 10)
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function Trending({ onOpen }: { onOpen: (id: string) => void }) {
  const [ranked, setRanked] = useState<Ranked[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const publicClient = usePublicClient()

  useEffect(() => {
    if (!publicClient) return
    const load = async () => {
      setLoading(true)
      setError(null)

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

      const rows = data ?? []
      const poolMap = await getPoolsForTerms(publicClient, rows.map(r => r.triple_id as Hex))

      const withPools: Ranked[] = rows.map(pred => ({
        pred,
        pools: poolMap[pred.triple_id] ?? null,
      }))

      // Biggest pool first; ties / no-pool fall back to the existing recency
      // order (rows already came back newest-first).
      withPools.sort((a, b) => totalOf(b.pools) - totalOf(a.pools))

      setRanked(withPools)
      setLoading(false)
    }

    load()
  }, [publicClient])

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        trending
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {'// ranked by $TRUST in the settlement pools'}
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
        <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          loading...
        </div>
      )}

      {!loading && ranked.length === 0 && !error && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          no open predictions to rank yet
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ranked.map((row, i) => (
          <div key={row.pred.id} onClick={() => onOpen(row.pred.id)} className="row-card fade-up" style={{
            borderRadius: 14, padding: '16px 20px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            animationDelay: `${Math.min(i * 50, 400)}ms`,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: i === 0 ? 'var(--accent)' : 'var(--bg)',
              border: i === 0 ? 'none' : '1px solid var(--border)',
              boxShadow: i === 0 ? '0 0 18px rgba(200, 241, 53, 0.4)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
              color: i === 0 ? 'var(--bg)' : 'var(--text-muted)', flexShrink: 0,
            }}>
              {i + 1}
            </div>

            {/* minWidth:0 rather than a 200px floor — a flex child won't shrink
                below its content otherwise, and the row overflows on a phone. */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>{row.pred.subject}</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--purple)' }}>{row.pred.claim}</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>{row.pred.condition ?? 'no condition'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                by {shortAddr(row.pred.creator_address)} · judgment day {row.pred.resolution_date ?? 'not set'}
              </div>
            </div>

            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', minWidth: 90 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                {row.pools && totalOf(row.pools) > 0 ? totalOf(row.pools).toFixed(2) : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {row.pools && totalOf(row.pools) > 0 ? `$TRUST · ${yesPctOf(row.pools)}% yes` : 'no stake yet'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
