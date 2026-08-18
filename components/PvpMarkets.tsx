'use client'

// Somoco — PVP markets.
//
// The friend-market destination: start one here, and find the ones you're
// already in. Deliberately its own page rather than a checkbox on the submit
// form — betting your friends is a different thing from publishing a prediction
// to the world, and it was invisible buried at the bottom of that form.
//
// The list is filtered client-side by membership. Note what "private" means
// here and everywhere: unlisted, not secret. These rows are readable through
// the public API like any other, and the claim itself is permanent on Intuition.

import { useEffect, useState } from 'react'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import SubmitPrediction from './SubmitPrediction'

type Tab = 'create' | 'mine'

export default function PvpMarkets({
  isConnected, address, onOpen,
}: {
  isConnected: boolean
  address?: string
  onOpen?: (id: string) => void
}) {
  const [tab, setTab] = useState<Tab>('create')
  const [mine, setMine] = useState<PredictionRecord[]>([])
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
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const me = address?.toLowerCase()
      const rows = (data ?? []).filter((p: PredictionRecord) => {
        if (p.is_private !== true) return false
        if (!me) return false
        // Yours if you created it, were invited to bet, or are the judge.
        if (p.creator_address?.toLowerCase() === me) return true
        if ((p.invited_wallets ?? []).some(w => w.toLowerCase() === me)) return true
        return p.judge_wallet?.toLowerCase() === me
      })
      setMine(rows)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [address])

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        pvp markets
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
        {'// bet your friends — you settle it, not somoco'}
      </div>

      {/* How it works. Worth the space: this is the part nobody has seen before,
          and the settlement rule is the whole reason to trust the thing. */}
      <div style={{
        background: 'var(--purple-bg)', border: '1px solid var(--purple-border)',
        borderRadius: 14, padding: 18, marginBottom: 18,
      }}>
        <div style={{
          fontSize: 10, color: 'var(--purple)', fontFamily: 'var(--font-mono)',
          letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12,
        }}>
          {'// how a pvp market works'}
        </div>
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          {[
            <>Call something — <strong style={{ color: 'var(--text)' }}>“Arsenal finish above Chelsea this season”</strong>.</>,
            <>Invite your friends’ wallets, and name a <strong style={{ color: 'var(--text)' }}>judge</strong> who isn’t betting.</>,
            <>Everyone backs YES or NO with real $TRUST.</>,
            <>On the day, you all vote. <strong style={{ color: 'var(--text)' }}>Agree and it pays out instantly</strong> — disagree, and the judge calls it.</>,
          ].map((line, i) => (
            <li key={i} style={{
              fontSize: 13.5, fontWeight: 400, lineHeight: 1.7,
              color: 'var(--text-muted)', marginBottom: 6,
            }}>
              {line}
            </li>
          ))}
        </ol>
        <p style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--purple-border)',
          fontSize: 12, fontWeight: 400, lineHeight: 1.6, color: 'var(--text-dim)',
        }}>
          Somoco never decides the outcome of a PVP market and can’t overrule you. It stays out
          of the public feed — though the claim itself is still written to Intuition, where it’s
          public and permanent. Everyone you invite needs some $TRUST to bet with and a little
          for gas.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          className="chip"
          onClick={() => setTab('create')}
          style={{
            borderColor: tab === 'create' ? 'var(--purple)' : undefined,
            color: tab === 'create' ? 'var(--purple)' : undefined,
          }}
        >
          + start one
        </button>
        <button
          className="chip"
          onClick={() => setTab('mine')}
          style={{
            borderColor: tab === 'mine' ? 'var(--purple)' : undefined,
            color: tab === 'mine' ? 'var(--purple)' : undefined,
          }}
        >
          your pvp markets{mine.length > 0 ? ` (${mine.length})` : ''}
        </button>
      </div>

      {tab === 'create' && (
        <SubmitPrediction isConnected={isConnected} address={address} pvpMode />
      )}

      {tab === 'mine' && (
        <>
          {!isConnected && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>
              Connect your wallet to see the PVP markets you’re in.
            </div>
          )}
          {isConnected && loading && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              loading…
            </div>
          )}
          {error && (
            <div style={{ fontSize: 13, color: '#ff6b6b', fontFamily: 'var(--font-mono)' }}>
              {error}
            </div>
          )}
          {isConnected && !loading && !error && mine.length === 0 && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 14, padding: 20,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No PVP markets yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
                Start one, or wait for a friend to invite your wallet. Markets you’re invited to
                show up here automatically — there’s nothing to accept.
              </div>
            </div>
          )}
          {mine.map(pred => (
            <PvpRow key={pred.id} pred={pred} me={address} onOpen={onOpen} />
          ))}
        </>
      )}
    </div>
  )
}

function PvpRow({
  pred, me, onOpen,
}: {
  pred: PredictionRecord
  me?: string
  onOpen?: (id: string) => void
}) {
  const mine = me?.toLowerCase()
  const role = pred.creator_address?.toLowerCase() === mine
    ? 'you started it'
    : pred.judge_wallet?.toLowerCase() === mine
      ? 'you’re the judge'
      : 'you were invited'

  const status = pred.approval_status === 'pending'
    ? 'waiting for approval'
    : pred.approval_status === 'rejected'
      ? 'rejected'
      : pred.resolution_status === 'unresolved'
        ? 'live'
        : 'settled'

  return (
    <div
      className="row-card"
      onClick={() => onOpen?.(pred.id)}
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 16, marginBottom: 10,
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
        {pred.subject} {pred.claim}{pred.condition ? ` ${pred.condition}` : ''}
      </div>
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10,
        fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
      }}>
        <span style={{ color: 'var(--purple)' }}>{role}</span>
        <span>·</span>
        <span>{status}</span>
        {pred.invited_wallets && (
          <>
            <span>·</span>
            <span>{pred.invited_wallets.length} playing</span>
          </>
        )}
        {pred.resolution_date && (
          <>
            <span>·</span>
            <span>settles {pred.resolution_date}</span>
          </>
        )}
      </div>
    </div>
  )
}
