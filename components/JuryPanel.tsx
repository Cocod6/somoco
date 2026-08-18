'use client'

// Somoco — friend-market voting panel.
//
// Only renders for markets that have a jury registered on the FriendJury
// contract; ordinary Somoco markets get nothing and are unaffected. See
// docs/friend-markets-v1-spec.md for why the rule is "everyone agrees, or the
// judge decides" rather than a majority vote.

import { useCallback, useEffect, useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import {
  readJuryStatus, castVote, judgeResolve, type JuryStatus, type VoteOutcome,
} from '@/lib/predictions/friendJury'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

export default function JuryPanel({ market, onSettled }: { market: Address; onSettled?: () => void }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [jury, setJury] = useState<JuryStatus | null>(null)
  const [checked, setChecked] = useState(false)
  // Wall-clock captured alongside the jury read rather than during render —
  // Date.now() in render scope is impure and the react compiler rejects it.
  // It only gates "has voting opened yet", and it refreshes with every reload.
  const [now, setNow] = useState(0)
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    const load = async () => {
      const next = await readJuryStatus(publicClient, market, address)
      if (!cancelled) {
        setJury(next)
        setNow(Math.floor(Date.now() / 1000))
        setChecked(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [publicClient, market, address, nonce])

  const act = async (outcome: 'yes' | 'no', asJudge: boolean) => {
    if (!publicClient || !walletClient) return
    setError(null)
    setBusy(outcome)
    try {
      const value: VoteOutcome = outcome === 'yes' ? 1 : 2
      if (asJudge) await judgeResolve(publicClient, walletClient, market, value)
      else await castVote(publicClient, walletClient, market, value)
      refresh()
      onSettled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'transaction failed')
    } finally {
      setBusy(null)
    }
  }

  if (!checked || !jury) return null // not a friend market

  const votingOpen = now >= jury.opensAt && !jury.finalized
  const canVote = isConnected && jury.iAmVoter && votingOpen && jury.myVote === 0
  const canJudge = isConnected && jury.iAmJudge && jury.judgeCanActNow && !jury.finalized
  const everyoneAgreed = jury.finalized && !jury.disputed

  return (
    <div style={{
      background: 'var(--purple-bg)', border: '1px solid var(--purple-border)',
      borderRadius: 12, padding: 16, marginBottom: 14,
    }}>
      <div style={{
        fontSize: 10, color: 'var(--purple)', fontFamily: 'var(--font-mono)',
        letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
      }}>
        {'// friends only — you settle this one, not somoco'}
      </div>

      {/* Who's in */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="invited" value={`${jury.voterCount}`} />
        <Stat label="voted" value={`${jury.votesCast}/${jury.voterCount}`} />
        <Stat label="yes / no" value={`${jury.votesYes} / ${jury.votesNo}`} />
        <Stat label="judge" value={jury.iAmJudge ? 'you' : short(jury.judge)} />
      </div>

      {/* Settled */}
      {jury.finalized && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
          {everyoneAgreed
            ? 'Settled — everyone agreed on the outcome. Claim below if you won.'
            : 'Settled by the judge after a disagreement. Claim below if you won.'}
        </div>
      )}

      {/* Not open yet */}
      {!jury.finalized && now < jury.opensAt && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
          Voting opens {fmtDate(jury.opensAt)}. Everyone invited votes on what happened —
          if you all agree it settles instantly, and any disagreement goes to the judge.
        </div>
      )}

      {/* Open for voting */}
      {votingOpen && (
        <>
          {jury.disputed && (
            <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 400, lineHeight: 1.6, marginBottom: 10 }}>
              You don’t agree. {jury.iAmJudge ? 'It’s your call.' : `${short(jury.judge)} decides.`}
            </div>
          )}

          {canVote && (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, marginBottom: 10 }}>
                What actually happened?
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-yes" disabled={busy !== null} onClick={() => act('yes', false)}
                  style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                  {busy === 'yes' ? 'voting…' : 'it happened'}
                </button>
                <button className="btn btn-no" disabled={busy !== null} onClick={() => act('no', false)}
                  style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                  {busy === 'no' ? 'voting…' : 'it didn’t'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
                one vote each, and you can’t change it
              </div>
            </>
          )}

          {isConnected && jury.iAmVoter && jury.myVote !== 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
              You voted <strong style={{ color: jury.myVote === 1 ? 'var(--accent)' : '#ff6b6b' }}>
                {jury.myVote === 1 ? 'it happened' : 'it didn’t'}
              </strong>
              {jury.votesCast < jury.voterCount && ` — waiting on ${jury.voterCount - jury.votesCast} more.`}
            </div>
          )}

          {isConnected && !jury.iAmVoter && !jury.iAmJudge && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 400, lineHeight: 1.6 }}>
              You’re not one of the invited voters on this market.
            </div>
          )}

          {canJudge && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--purple-border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, marginBottom: 10 }}>
                You’re the judge{jury.disputed ? ' and they disagree' : ' and the voting window has passed'}. Your call is final.
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-yes" disabled={busy !== null} onClick={() => act('yes', true)}
                  style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                  {busy === 'yes' ? 'ruling…' : 'rule: it happened'}
                </button>
                <button className="btn btn-no" disabled={busy !== null} onClick={() => act('no', true)}
                  style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                  {busy === 'no' ? 'ruling…' : 'rule: it didn’t'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
                you can only rule if you have no money in this market
              </div>
            </div>
          )}

          {jury.iAmJudge && !jury.judgeCanActNow && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
              you can step in from {fmtDate(jury.judgeFrom)}, or sooner if they disagree
            </div>
          )}

          {!isConnected && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 400 }}>
              Connect your wallet to vote.
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#ff6b6b', fontFamily: 'var(--font-mono)', marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
