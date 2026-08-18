'use client'

// Somoco — the resolution receipt
//
// Every finished prediction used to say one of two words, "true" or "false",
// with nothing behind it. Somebody who staked and lost had no way to check the
// call except to ask. This component is the answer to "says who?": the outcome,
// the source anyone can open, the reason in the resolver's own words, and when
// and by whom it was recorded.
//
// It also renders the honest empty case. Predictions resolved before
// 2026-08-18 have no receipt, and saying so plainly is better than a confident
// badge that quietly implies there was evidence.

import type { PredictionRecord } from '@/lib/supabase'

/** Colour and wording per outcome. Voided is grey on purpose — see below. */
function outcomeChip(status: PredictionRecord['resolution_status']): {
  text: string; bg: string; color: string; border: string
} | null {
  switch (status) {
    case 'resolved_true':
      return { text: '✓ resolved TRUE', bg: 'var(--accent-dark)', color: 'var(--accent)', border: 'var(--accent-border)' }
    case 'resolved_false':
      return { text: '✗ resolved FALSE', bg: '#1a0a0a', color: '#ff6b6b', border: '#3d1a1a' }
    case 'voided':
      // Not a loss and not a win. The question stopped being answerable and
      // every stake went back, fee-free, so this must not read as a verdict.
      return { text: '⊘ VOIDED — stakes refunded', bg: '#141414', color: 'var(--text-muted)', border: 'var(--border)' }
    default:
      return null
  }
}

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Who recorded it, in words a person can read. */
function resolverLabel(resolvedBy: string): string {
  // The mechanical settler is not a person and shouldn't be shown as a wallet:
  // it read the outcome from the source rather than exercising any judgement.
  if (resolvedBy === 'polymarket-settler') return 'read automatically from the source'
  return resolvedBy.startsWith('0x') ? shortAddr(resolvedBy) : resolvedBy
}

export default function ResolutionReceipt({
  prediction,
  compact = false,
}: {
  prediction: PredictionRecord
  /** Feed and list contexts: chip only, no evidence box. */
  compact?: boolean
}) {
  const chip = outcomeChip(prediction.resolution_status)
  if (!chip) return null

  const sourceUrl = prediction.resolution_source_url
  const note = prediction.resolution_note
  const resolvedAt = prediction.resolved_at
  const resolvedBy = prediction.resolved_by
  const hasReceipt = Boolean(sourceUrl || note || resolvedAt || resolvedBy)

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: chip.bg, color: chip.color, border: `1px solid ${chip.border}`,
        borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 700,
      }}>
        {chip.text}
      </div>

      {!compact && hasReceipt && (
        <div style={{
          marginTop: 10, background: '#0a0a0a', border: '1px solid var(--border)',
          borderRadius: 10, padding: 14, fontSize: 12.5, lineHeight: 1.7,
          color: 'var(--text-dim)',
        }}>
          {note && <div style={{ color: 'var(--text)', marginBottom: sourceUrl || resolvedAt ? 8 : 0 }}>{note}</div>}

          {sourceUrl && (
            <div style={{ marginBottom: resolvedAt || resolvedBy ? 6 : 0 }}>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--blue)', textDecoration: 'underline', wordBreak: 'break-all' }}
              >
                check the source ↗
              </a>
            </div>
          )}

          {(resolvedAt || resolvedBy) && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {resolvedAt && `recorded ${new Date(resolvedAt).toLocaleString()}`}
              {resolvedAt && resolvedBy && ' · '}
              {resolvedBy && resolverLabel(resolvedBy)}
            </div>
          )}
        </div>
      )}

      {!compact && !hasReceipt && (
        <div style={{
          marginTop: 10, fontSize: 12, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          no source was recorded for this resolution
        </div>
      )}
    </div>
  )
}
