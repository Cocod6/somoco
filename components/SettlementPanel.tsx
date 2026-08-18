'use client'

// Somoco — settlement pool panel (the money layer, parimutuel v1).
// Shared by PredictionDetail (stake while open) and MyPredictions (claim after
// resolution — resolved predictions drop out of the feed, so the claim button
// must live somewhere the user can still reach). Renders nothing if no market
// exists for this prediction. Staking is one-way until the market locks;
// winners split the losing pool minus a 3% fee; claims are pulled.

import { useCallback, useEffect, useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { formatEther, parseEther, type Hex } from 'viem'
import {
  getMarketAddress, readMarketInfo, stakeOnMarket, claimFromMarket,
  unstakeFromMarket, UNSTAKE_PENALTY_BPS,
  type MarketInfo,
} from '@/lib/predictions/settlement'
import JuryPanel from './JuryPanel'

export default function SettlementPanel({ termId }: { termId: Hex }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [info, setInfo] = useState<MarketInfo | null>(null)
  const [checked, setChecked] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<'yes' | 'no' | 'claim' | 'exit-yes' | 'exit-no' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTx, setLastTx] = useState<string | null>(null)
  // Bumped after every stake/claim tx to refetch the pool state
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refresh = useCallback(() => setRefreshNonce(n => n + 1), [])

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    const load = async () => {
      try {
        const market = await getMarketAddress(publicClient, termId)
        const next = market ? await readMarketInfo(publicClient, market, address) : null
        if (!cancelled) setInfo(next)
      } catch (e) {
        console.error('settlement read error', e)
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [publicClient, termId, address, refreshNonce])

  if (!checked || !info) return null // no market for this prediction (or still loading)

  const fmt = (wei: bigint) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 4 })
  const total = info.poolYes + info.poolNo
  const yesPct = total > 0n ? Number((info.poolYes * 1000n) / total) / 10 : 50
  const hasPosition = info.myYes > 0n || info.myNo > 0n
  const lockDate = new Date(info.lockAt * 1000)

  const doStake = async (side: 'yes' | 'no') => {
    if (!publicClient || !walletClient) return
    setError(null)
    let wei: bigint
    try {
      wei = parseEther(amount || '0')
    } catch {
      setError('enter a valid $TRUST amount')
      return
    }
    if (wei < info.minStake) {
      setError(`minimum stake is ${fmt(info.minStake)} $TRUST`)
      return
    }
    setBusy(side)
    try {
      const hash = await stakeOnMarket(publicClient, walletClient, info.address, side, wei)
      setLastTx(hash)
      setAmount('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'stake failed')
    } finally {
      setBusy(null)
    }
  }

  const doClaim = async () => {
    if (!publicClient || !walletClient) return
    setError(null)
    setBusy('claim')
    try {
      const hash = await claimFromMarket(publicClient, walletClient, info.address)
      setLastTx(hash)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'claim failed')
    } finally {
      setBusy(null)
    }
  }

  const doUnstake = async (side: 'yes' | 'no') => {
    if (!publicClient || !walletClient) return
    setError(null)
    setBusy(side === 'yes' ? 'exit-yes' : 'exit-no')
    try {
      const hash = await unstakeFromMarket(publicClient, walletClient, info.address, side)
      setLastTx(hash)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'unstake failed')
    } finally {
      setBusy(null)
    }
  }

  // Early-exit: how much a full-position unstake returns after the penalty.
  const penaltyPct = UNSTAKE_PENALTY_BPS / 100
  const keepFrac = (10000 - UNSTAKE_PENALTY_BPS)
  const returnedOf = (staked: bigint) => (staked * BigInt(keepFrac)) / 10000n

  return (
    <div className="fade-up" style={{
      background: 'linear-gradient(180deg, #141414 0%, #101010 100%)',
      border: '1px solid var(--accent-border)', borderRadius: 16, padding: 24, marginBottom: 16,
      boxShadow: 'inset 0 1px 0 rgba(200, 241, 53, 0.06)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase' }}>
          {'// settlement pool — win real $TRUST'}
        </div>
        <StateChip state={info.state} />
      </div>

      {/* Friend markets only: the group votes on the outcome here instead of
          Somoco declaring it. Renders nothing for ordinary markets. */}
      <JuryPanel market={info.address} onSettled={refresh} />

      {/* Pool split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ background: 'var(--accent-dark)', border: '1px solid var(--accent-border)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 6 }}>YES POOL</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{fmt(info.poolYes)} <span style={{ fontSize: 12, fontWeight: 500 }}>$TRUST</span></div>
          {info.myYes > 0n && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>you: {fmt(info.myYes)}</div>}
        </div>
        <div style={{ background: '#1a0a0a', border: '1px solid #3d1a1a', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: '#ff6b6b', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 6 }}>NO POOL</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ff6b6b' }}>{fmt(info.poolNo)} <span style={{ fontSize: 12, fontWeight: 500 }}>$TRUST</span></div>
          {info.myNo > 0n && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>you: {fmt(info.myNo)}</div>}
        </div>
      </div>

      {total > 0n && (
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 14, background: '#1e1e1e' }}>
          <div style={{ width: `${yesPct}%`, background: 'var(--accent)' }} />
          <div style={{ width: `${100 - yesPct}%`, background: '#ff6b6b' }} />
        </div>
      )}

      {/* OPEN — stake form */}
      {info.state === 'open' && (
        <>
          {isConnected ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`amount (min ${fmt(info.minStake)})`}
                inputMode="decimal"
                style={{
                  flex: '1 1 140px', background: '#0a0a0a', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 14px', fontSize: 14, color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', outline: 'none',
                }}
              />
              <button className="btn btn-yes" disabled={busy !== null} onClick={() => doStake('yes')}
                style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy === 'yes' ? 'staking…' : 'stake YES'}
              </button>
              <button className="btn btn-no" disabled={busy !== null} onClick={() => doStake('no')}
                style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy === 'no' ? 'staking…' : 'stake NO'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              connect your wallet (top right) to stake
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 10 }}>
            staking closes {lockDate.toLocaleString()} · winners split the losing pool
          </div>

          {/* Early exit — only when the connected wallet has a position */}
          {isConnected && hasPosition && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                changed your mind? exit early and keep {100 - penaltyPct}% (a {penaltyPct}% exit fee stays in the pool)
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {info.myYes > 0n && (
                  <button className="btn" disabled={busy !== null} onClick={() => doUnstake('yes')}
                    style={{ border: '1px solid var(--accent-border)', color: 'var(--accent)', background: 'transparent', borderRadius: 10, padding: '8px 16px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>
                    {busy === 'exit-yes' ? 'exiting…' : `exit YES → get ${fmt(returnedOf(info.myYes))}`}
                  </button>
                )}
                {info.myNo > 0n && (
                  <button className="btn" disabled={busy !== null} onClick={() => doUnstake('no')}
                    style={{ border: '1px solid #3d1a1a', color: '#ff6b6b', background: 'transparent', borderRadius: 10, padding: '8px 16px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>
                    {busy === 'exit-no' ? 'exiting…' : `exit NO → get ${fmt(returnedOf(info.myNo))}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* LOCKED */}
      {info.state === 'locked' && (
        <div style={{ fontSize: 13, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
          staking closed — awaiting resolution
          {hasPosition && <span style={{ color: 'var(--text-muted)' }}> · your stake is committed</span>}
        </div>
      )}

      {/* RESOLVED / VOIDED — claim */}
      {(info.state === 'resolved' || info.state === 'voided') && (
        <div>
          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', marginBottom: 10, color: info.state === 'voided' ? 'var(--amber)' : info.outcome === 'yes' ? 'var(--accent)' : '#ff6b6b' }}>
            {info.state === 'voided'
              ? 'market voided — everyone gets their stake back'
              : `resolved ${info.outcome.toUpperCase()}`}
          </div>
          {isConnected && info.claimable > 0n && (
            <button className="btn btn-yes" disabled={busy !== null} onClick={doClaim}
              style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
              {busy === 'claim' ? 'claiming…' : `claim ${fmt(info.claimable)} $TRUST`}
            </button>
          )}
          {isConnected && info.claimed && (
            <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>✓ claimed</div>
          )}
          {isConnected && !info.claimed && info.claimable === 0n && hasPosition && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              nothing to claim — your side lost
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#ff6b6b', fontFamily: 'var(--font-mono)', padding: '8px 12px', background: '#ff44441a', borderRadius: 8, border: '1px solid #ff444433' }}>
          {error}
        </div>
      )}
      {lastTx && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          tx: {lastTx.slice(0, 10)}…{lastTx.slice(-6)} ✓
        </div>
      )}
    </div>
  )
}

function StateChip({ state }: { state: MarketInfo['state'] }) {
  const cfg = {
    open: { text: 'open for staking', color: 'var(--accent)', bg: 'var(--accent-dark)', border: 'var(--accent-border)' },
    locked: { text: 'locked', color: 'var(--amber)', bg: '#1a150a', border: '#3d2f1a' },
    resolved: { text: 'resolved', color: 'var(--blue)', bg: '#0a121a', border: '#1a2d3d' },
    voided: { text: 'voided', color: 'var(--text-muted)', bg: '#141414', border: 'var(--border)' },
  }[state]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 999, padding: '4px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
    }}>
      {cfg.text}
    </span>
  )
}
