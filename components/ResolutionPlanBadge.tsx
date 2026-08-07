'use client'

// Somoco — compact resolution-plan display for prediction cards.
// Shows the plan's sources as small pills plus a "how it resolves" toggle that
// expands the exact criteria text — so users see up front how a prediction
// will be judged. Renders nothing for rows predating the resolution_plan
// column. stopPropagation everywhere: cards using this are often clickable.
//
// The needs-review parts are OFF by default and are not public-facing:
//   - the "⚠ held for review" chip is a moderation state, not a property of
//     the prediction. Once a prediction is approved it IS published, so the
//     chip on a live market only makes a settled thing look unsettled.
//   - `reviewReason` is the parser talking to the moderator ("no automated
//     feed exists for individual politician speech transcripts"). That's
//     internal reasoning — it belongs in the Approve queue, not in front of
//     someone deciding whether to stake.
// Only the admin surfaces opt in.

import { useState } from 'react'
import type { ResolutionPlan } from '@/lib/predictions/types'

const METHOD_LABELS: Record<string, string> = {
  automated_feed: '⚙ automated data feed',
  named_source: '◈ named source',
  human_review: '👁 human review',
}

export default function ResolutionPlanBadge({
  plan,
  defaultOpen = false,
  showReviewFlag = false,
  showReviewReason = false,
}: {
  plan: ResolutionPlan | null
  /** Start expanded (admin queue wants the criteria visible immediately) */
  defaultOpen?: boolean
  /** Show the "⚠ held for review" chip — moderation surfaces only */
  showReviewFlag?: boolean
  /** Show the parser's internal reason for flagging it — admin only */
  showReviewReason?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!plan) return null

  return (
    <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {plan.sources.map(s => (
          <span key={s} className="chip-mini">{s}</span>
        ))}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 4px',
            fontSize: 11, fontFamily: 'var(--font-mono)',
            color: open ? 'var(--accent-text)' : 'var(--text-dim)',
          }}
        >
          how it resolves {open ? '▴' : '▾'}
        </button>
        {plan.needsReview && showReviewFlag && (
          <span className="chip-mini" style={{ color: '#e6a832', borderColor: '#3d2f1a', background: '#1a150a' }}>
            ⚠ held for review
          </span>
        )}
      </div>
      {open && (
        <div style={{
          marginTop: 8, padding: '10px 12px', background: '#0a0a0a',
          border: '1px solid var(--border)', borderRadius: 8,
          fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--accent-text)' }}>
            {METHOD_LABELS[plan.method] ?? plan.method}
          </span>
          {' · '}
          {plan.criteria}
          {plan.needsReview && plan.reviewReason && showReviewReason && (
            <div style={{ color: '#e6a832', marginTop: 6 }}>
              ⚠ {plan.reviewReason}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
