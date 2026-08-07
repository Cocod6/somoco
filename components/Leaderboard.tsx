'use client'

// Somoco — Leaderboard
// Ranks creators by their resolved prediction track record. Pulled from
// Somoco's own database (same source as Approve/Resolve/My Predictions) —
// not the public Intuition graph directly, for the same reason the rest of
// the app works this way: only predictions that genuinely went through
// Somoco's own flow should count here.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CreatorStats {
  address: string
  correct: number
  incorrect: number
  total: number
  accuracy: number
}

export default function Leaderboard() {
  const [stats, setStats] = useState<CreatorStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      // Only count predictions that were actually approved AND resolved —
      // pending/rejected ones don't reflect a real track record yet
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('creator_address, resolution_status')
        .eq('approval_status', 'approved')
        .neq('resolution_status', 'unresolved')

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const grouped = new Map<string, { correct: number; incorrect: number }>()
      for (const row of data ?? []) {
        const key = row.creator_address.toLowerCase()
        const entry = grouped.get(key) ?? { correct: 0, incorrect: 0 }
        if (row.resolution_status === 'resolved_true') entry.correct += 1
        if (row.resolution_status === 'resolved_false') entry.incorrect += 1
        grouped.set(key, entry)
      }

      const results: CreatorStats[] = Array.from(grouped.entries()).map(([address, v]) => {
        const total = v.correct + v.incorrect
        return { address, correct: v.correct, incorrect: v.incorrect, total, accuracy: total > 0 ? v.correct / total : 0 }
      })

      // Rank by accuracy first, then by volume as a tiebreaker
      results.sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)

      setStats(results)
      setLoading(false)
    }

    load()
  }, [])

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        leaderboard
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {'// ranked by resolved prediction accuracy'}
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

      {!loading && stats.length === 0 && !error && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          no resolved predictions yet
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stats.map((s, i) => (
          <div key={s.address} className="row-card fade-up" style={{
            borderRadius: 14, padding: '16px 20px',
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

            <div style={{
              flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {s.address.slice(0, 6)}...{s.address.slice(-4)}
            </div>

            <div style={{ display: 'flex', gap: 18, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <span style={{ color: 'var(--accent)' }}>{s.correct} correct</span>
              <span style={{ color: '#ff6b6b' }}>{s.incorrect} incorrect</span>
              <span style={{ color: 'var(--text-muted)' }}>{s.total} total</span>
            </div>

            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
              color: s.accuracy >= 0.5 ? 'var(--accent)' : '#ff6b6b',
              minWidth: 60, textAlign: 'right',
            }}>
              {Math.round(s.accuracy * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
