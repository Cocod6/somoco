'use client'

// Somoco — Prediction detail (market view)
// Opens when a prediction card is clicked. The market IS the settlement pool
// (SettlementPanel): stake $TRUST on YES/NO in-app, winners split the losing
// pool. The old Intuition bonding-curve staking (portal handoff) was removed
// 2026-07-22 — the Triple itself remains the permanent claim record, linked at
// the bottom.

import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { CATEGORIES, categorize } from '@/lib/predictions/categories'
import ResolutionPlanBadge from './ResolutionPlanBadge'
import SettlementPanel from './SettlementPanel'

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

// Build a readable market question, dropping the "no condition" placeholder.
function questionOf(p: PredictionRecord): string {
  const cond = p.condition && p.condition !== 'no condition' ? ` ${p.condition}` : ''
  return `${p.subject} ${p.claim}${cond}?`
}

export default function PredictionDetail({ predictionId, onBack }: { predictionId: string; onBack: () => void }) {
  const [pred, setPred] = useState<PredictionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('id', predictionId)
        .maybeSingle()

      if (cancelled) return
      if (fetchError) { setError(fetchError.message); setLoading(false); return }
      if (!data) { setError('Prediction not found.'); setLoading(false); return }

      setPred(data as PredictionRecord)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [predictionId])

  const BackButton = (
    <button
      onClick={onBack}
      className="btn btn-ghost"
      style={{ padding: '7px 14px', fontSize: 13, borderRadius: 10, marginBottom: 20 }}
    >
      ← back
    </button>
  )

  // Skeletons rather than the word "loading" — same treatment as the feed, and
  // the page doesn't jump when the market arrives.
  if (loading) {
    return (
      <div>
        {BackButton}
        <div className="skeleton" style={{ height: 30, width: '70%', marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 22 }} />
        <div className="skeleton" style={{ height: 190, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 130 }} />
      </div>
    )
  }

  if (error || !pred) {
    return (
      <div>
        {BackButton}
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          padding: '10px 16px', background: '#ff44441a', borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error ?? 'Prediction not found.'}
        </div>
      </div>
    )
  }

  const resolved = pred.resolution_status !== 'unresolved'
  const portalUrl = `https://portal.intuition.systems/explore/triple/${pred.triple_id}?tab=positions`
  const cat = CATEGORIES.find(c => c.id === (pred.category || categorize(pred)))

  return (
    <div>
      {BackButton}

      {/* Market question */}
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1.3, marginBottom: 10 }}>
        {questionOf(pred)}
      </h1>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20,
      }}>
        {cat && cat.id !== 'other' && <span className="chip-mini">{cat.icon} {cat.label}</span>}
        <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          by {shortAddr(pred.creator_address)} · judgment day {pred.resolution_date ?? 'not set'}
        </span>
      </div>

      {/* Creator-attached image, if any (cosmetic — not part of the Triple) */}
      {pred.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pred.image_url}
          alt=""
          style={{
            width: '100%', maxHeight: 320, objectFit: 'cover', display: 'block',
            borderRadius: 12, border: '1px solid var(--border)', marginBottom: 20,
          }}
        />
      )}

      {/* Resolved banner (open predictions won't hit this, but detail can be
          reached for resolved ones too) */}
      {resolved && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: pred.resolution_status === 'resolved_true' ? 'var(--accent-dark)' : '#1a0a0a',
          color: pred.resolution_status === 'resolved_true' ? 'var(--accent)' : '#ff6b6b',
          border: `1px solid ${pred.resolution_status === 'resolved_true' ? 'var(--accent-border)' : '#3d1a1a'}`,
          borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 700, marginBottom: 20,
        }}>
          {pred.resolution_status === 'resolved_true' ? '✓ resolved TRUE' : '✗ resolved FALSE'}
        </div>
      )}

      {/* THE market — stake, watch the pools, claim. Renders nothing when no
          settlement pool exists (e.g. predictions approved without a date). */}
      <SettlementPanel termId={pred.triple_id as Hex} />

      {/* The underlying Triple — the permanent claim record on Intuition */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20,
      }}>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>
          {'// the on-chain triple'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <Pill color="var(--blue)">{pred.subject}</Pill>
          <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
          <Pill color="var(--purple)">{pred.claim}</Pill>
          <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
          <Pill color="var(--amber)">{pred.condition ?? 'no condition'}</Pill>
        </div>
        <ResolutionPlanBadge plan={pred.resolution_plan} defaultOpen />
        <a
          href={portalUrl}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', textDecoration: 'underline', display: 'inline-block', marginTop: 12 }}
        >
          view on intuition portal ↗
        </a>
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
