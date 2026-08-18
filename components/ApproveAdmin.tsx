'use client'

// Somoco — approval queue
// Every prediction submitted through Somoco lands here first as 'pending'.
// Nothing shows up publicly, and nothing reaches the Resolve page, until
// you approve it here. This is YOUR private list — separate from Intuition,
// which already has the real Triple permanently either way.

import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import { signAdminAction } from '@/lib/adminSign'
import {
  createMarketOnChain, acceptFactoryOwnership, getFactoryOwnership, getMarketAddress,
} from '@/lib/predictions/settlement'
import {
  registerJury, juryIsLive, MAX_VOTERS,
  MIN_VOTE_WINDOW_SECONDS, MAX_VOTE_WINDOW_SECONDS,
} from '@/lib/predictions/friendJury'
import ResolutionPlanBadge from './ResolutionPlanBadge'

// Approving a prediction also creates its settlement pool (the money market).
// Staking closes this many seconds before the resolution date — or halfway to
// resolution when the date is nearer than that, so late approvals still work.
const DEFAULT_LOCK_OFFSET = 24 * 60 * 60

/**
 * When a YYYY-MM-DD resolution date actually falls due: the END of that day in
 * UTC, not the start.
 *
 * This used to be `T00:00:00Z`, which read "judgment day 2026-08-11" as the
 * first instant of the 11th. Two things were wrong with that. A market dated
 * today was ALWAYS already in the past, so it silently got no settlement pool —
 * which is fatal for PVP, where "before 4pm today" is the most natural friend
 * bet there is. And even for public markets it judged a day early: a prediction
 * that resolves on the 31st shouldn't be settled at midnight as the 31st
 * begins, before the thing has had its day to happen.
 *
 * End-of-day matches what a person means by a date, and it only affects markets
 * created from here on — existing ones have their timestamps fixed on-chain.
 */
function resolutionUnixOf(dateISO: string): number {
  return Math.floor(Date.parse(`${dateISO}T23:59:59Z`) / 1000)
}

// Create the prediction's money market on the settlement factory. The caller's
// wallet must be the factory owner. Returns a human-readable outcome; throws
// only network/contract errors. Module-level (not in the component) because it
// uses wall-clock time, which the react compiler forbids in render scope.
async function createSettlementMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  pred: PredictionRecord
): Promise<{ ok: boolean; message: string }> {
  if (!pred.resolution_date) {
    return { ok: false, message: `Approved, but no settlement pool: "${pred.subject}" has no resolution date.` }
  }
  const resolutionUnix = resolutionUnixOf(pred.resolution_date)
  const now = Math.floor(Date.now() / 1000)
  if (resolutionUnix <= now) {
    return { ok: false, message: `Approved, but no settlement pool: "${pred.subject}"'s resolution date is already past.` }
  }
  // Lock 24h before resolution, or halfway there if that's already too close.
  const lockOffset = Math.min(DEFAULT_LOCK_OFFSET, Math.floor((resolutionUnix - now) / 2))
  await createMarketOnChain(
    publicClient,
    walletClient,
    pred.triple_id as Hex,
    resolutionUnix,
    lockOffset,
    pred.creator_address as Address
  )
  const locks = new Date((resolutionUnix - lockOffset) * 1000).toLocaleString()

  // Friend market: hand the outcome to the people who bet, not to Somoco.
  // Deliberately a SECOND transaction after the market exists — registerJury
  // needs the market address, and keeping it separate means a failed jury
  // leaves a working (Somoco-resolved) market rather than no market at all.
  if (pred.is_private === true) {
    const jury = await registerJuryFor(publicClient, walletClient, pred)
    return { ok: true, message: `Approved — ${jury} Staking closes ${locks}.` }
  }

  return { ok: true, message: `Approved — settlement pool is live, staking closes ${locks}.` }
}

/**
 * Register the on-chain jury for a private prediction. Returns a sentence
 * describing what happened — including the ways it can legitimately not happen,
 * which the admin needs to see rather than have swallowed.
 *
 * The database row is only ever the creator's REQUEST. This is where it becomes
 * binding, and the validation here is the gate: the contract will reject a bad
 * jury anyway, but failing early gives the admin a readable reason.
 */
async function registerJuryFor(
  publicClient: PublicClient,
  walletClient: WalletClient,
  pred: PredictionRecord
): Promise<string> {
  if (!(await juryIsLive(publicClient))) {
    return 'settlement pool is live, but the friend jury is NOT — the FriendJury contract does not hold the resolver role, so Somoco still settles this one.'
  }

  const voters = (pred.invited_wallets ?? [])
    .map(a => a.trim().toLowerCase())
    .filter((a, i, all) => a.length > 0 && all.indexOf(a) === i) as Address[]
  const judge = pred.judge_wallet?.trim().toLowerCase() as Address | undefined

  if (!judge) return 'settlement pool is live, but no judge was named, so no jury was registered.'
  if (voters.length < 2) return 'settlement pool is live, but fewer than 2 friends were invited, so no jury was registered.'
  if (voters.length > MAX_VOTERS) return `settlement pool is live, but ${voters.length} voters exceeds the ${MAX_VOTERS} cap, so no jury was registered.`
  if (voters.includes(judge)) return 'settlement pool is live, but the judge is also one of the voters, so no jury was registered.'

  const window = pred.vote_window_seconds ?? 3 * 24 * 60 * 60
  if (window < MIN_VOTE_WINDOW_SECONDS || window > MAX_VOTE_WINDOW_SECONDS) {
    return 'settlement pool is live, but the voting window is out of range, so no jury was registered.'
  }

  const market = await getMarketAddress(publicClient, pred.triple_id as Hex)
  if (!market) return 'settlement pool was created but could not be read back, so no jury was registered.'

  await registerJury(publicClient, walletClient, market, voters, judge, window)
  return `friend market is live — ${voters.length} friends decide it, ${judge.slice(0, 6)}…${judge.slice(-4)} judges.`
}

/**
 * Approved predictions that have no settlement pool, so nobody can stake on
 * them. Module-level because it reads wall-clock time.
 *
 * These exist because approving here is not the only way a prediction becomes
 * approved: the Polymarket mirror writes rows straight to the database as
 * 'approved', which is the point of an auto-mirror — but it means they never
 * pass through handleDecide, and the pool is created in handleDecide. So an
 * imported prediction reaches the feed looking exactly like any other and then
 * offers no way to back it.
 *
 * Creating the pool has to happen from the admin's wallet regardless: the
 * factory's createMarket is owner-only, and the mirror's wallet isn't the owner
 * (nor should it be — an unattended job holding market-creation rights is a
 * much bigger blast radius than one that can only mint Triples).
 */
async function findPredictionsMissingPools(
  publicClient: PublicClient,
  rows: PredictionRecord[]
): Promise<PredictionRecord[]> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const missing: PredictionRecord[] = []
  for (const row of rows) {
    // No date, or a date already gone: createMarket would revert anyway.
    if (!row.resolution_date) continue
    if (resolutionUnixOf(row.resolution_date) <= nowSeconds) continue
    const market = await getMarketAddress(publicClient, row.triple_id as Hex)
    if (!market) missing.push(row)
  }
  return missing
}

export default function ApproveAdmin() {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // One-time factory ownership handover: when the connected admin is the
  // factory's pending owner, show an activate button until accepted.
  const [needsOwnershipAccept, setNeedsOwnershipAccept] = useState(false)
  const [acceptingOwnership, setAcceptingOwnership] = useState(false)
  // Approved predictions with no staking pool — see findPredictionsMissingPools.
  const [missingPools, setMissingPools] = useState<PredictionRecord[]>([])
  const [scanningPools, setScanningPools] = useState(true)
  const [poolBusyId, setPoolBusyId] = useState<string | null>(null)
  const [creatingAll, setCreatingAll] = useState(false)
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  useEffect(() => {
    const loadPending = async () => {
      setLoading(true)
      setError(null)
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setPredictions(data ?? [])
      }
      setLoading(false)
    }

    loadPending()
  }, [])

  useEffect(() => {
    if (!publicClient || !address) return
    let cancelled = false
    const check = async () => {
      try {
        const { pendingOwner } = await getFactoryOwnership(publicClient)
        if (!cancelled) setNeedsOwnershipAccept(pendingOwner.toLowerCase() === address.toLowerCase())
      } catch (e) {
        console.error('factory ownership check failed', e)
      }
    }
    check()
    return () => { cancelled = true }
  }, [publicClient, address])

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    const scan = async () => {
      setScanningPools(true)
      const { data } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'approved')
        .eq('resolution_status', 'unresolved')
        .order('resolution_date', { ascending: true })
      if (cancelled) return
      try {
        const missing = await findPredictionsMissingPools(publicClient, data ?? [])
        if (!cancelled) setMissingPools(missing)
      } catch (err) {
        console.error('pool scan failed', err)
      }
      if (!cancelled) setScanningPools(false)
    }
    scan()
    return () => { cancelled = true }
  }, [publicClient])

  const handleCreatePool = async (pred: PredictionRecord) => {
    if (!publicClient || !walletClient) {
      setError('Connect your admin wallet first — creating a pool is an on-chain transaction.')
      return
    }
    setPoolBusyId(pred.id)
    setError(null)
    try {
      const result = await createSettlementMarket(publicClient, walletClient, pred)
      setNotice(result.message.replace(/^Approved[—,] /, '').replace(/^Approved/, 'Done'))
      if (result.ok) setMissingPools(prev => prev.filter(p => p.id !== pred.id))
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : 'pool creation failed'
      setError(`Could not create the pool for "${pred.subject}": ${message}`)
    } finally {
      setPoolBusyId(null)
    }
  }

  // Sequential on purpose: the factory has no batch entrypoint, so this is one
  // transaction (and one wallet prompt) per prediction. Stops at the first
  // failure rather than firing a dozen more prompts at a wallet that just
  // rejected one.
  const handleCreateAllPools = async () => {
    if (!publicClient || !walletClient) {
      setError('Connect your admin wallet first — creating pools is an on-chain transaction.')
      return
    }
    setCreatingAll(true)
    setError(null)
    let created = 0
    try {
      for (const pred of [...missingPools]) {
        setPoolBusyId(pred.id)
        const result = await createSettlementMarket(publicClient, walletClient, pred)
        if (result.ok) {
          created++
          setMissingPools(prev => prev.filter(p => p.id !== pred.id))
        }
        setNotice(`created ${created} staking pool${created === 1 ? '' : 's'}…`)
      }
      setNotice(`Done — ${created} staking pool${created === 1 ? '' : 's'} created. People can back these now.`)
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : 'pool creation failed'
      setError(`Stopped after ${created} pool${created === 1 ? '' : 's'}: ${message}`)
    } finally {
      setPoolBusyId(null)
      setCreatingAll(false)
    }
  }

  const handleAcceptOwnership = async () => {
    if (!publicClient || !walletClient) return
    setAcceptingOwnership(true)
    setError(null)
    try {
      await acceptFactoryOwnership(publicClient, walletClient)
      setNeedsOwnershipAccept(false)
      setNotice('Market creation activated — this wallet now owns the market factory.')
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Could not accept ownership.')
    } finally {
      setAcceptingOwnership(false)
    }
  }

  // Approving is a privileged write, so it goes through /api/admin/approve and
  // has to be signed by an allowlisted admin wallet. The signature covers this
  // exact decision on this exact row — see lib/adminAuth.ts.
  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    if (!walletClient || !address) {
      setError('Connect your admin wallet before approving or rejecting.')
      return
    }

    setBusyId(id)
    setError(null)
    try {
      const auth = await signAdminAction(walletClient, address, decision, id)

      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, auth }),
      })

      if (!res.ok) {
        const { error: apiError } = await res.json().catch(() => ({ error: res.statusText }))
        setError(apiError ?? 'Could not save the decision.')
      } else {
        // Approval went through — now create the settlement pool so people
        // can actually stake money on it. Failure here doesn't undo the
        // approval; it just means the market has to be created later.
        if (decision === 'approved') {
          const pred = predictions.find(p => p.id === id)
          if (pred && publicClient && walletClient) {
            try {
              const result = await createSettlementMarket(publicClient, walletClient, pred)
              setNotice(result.message)
            } catch (err) {
              const message = err instanceof Error ? err.message.split('\n')[0] : 'market creation failed'
              setError(`Approved, but the settlement pool was NOT created: ${message}`)
            }
          }
        }
        setPredictions(prev => prev.filter(p => p.id !== id))
      }
    } catch (err) {
      // Most common case here is the admin dismissing the signature prompt.
      setError(err instanceof Error ? err.message : 'Could not sign the decision.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        approve predictions
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {"// nothing reaches resolve until it's approved here"}
      </div>

      {/* One-time setup: this wallet has been offered factory ownership but
          hasn't accepted yet. Until it does, approvals can't create markets. */}
      {needsOwnershipAccept && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          marginBottom: 16, padding: '14px 16px', background: '#1a150a',
          borderRadius: 10, border: '1px solid #3d2f1a',
        }}>
          <div style={{ fontSize: 13, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
            ⚡ one-time setup: accept market-factory ownership so approving a
            prediction can auto-create its settlement pool
          </div>
          <button
            onClick={handleAcceptOwnership}
            disabled={acceptingOwnership}
            className="btn btn-yes"
            style={{ padding: '8px 18px', fontSize: 13, borderRadius: 10, opacity: acceptingOwnership ? 0.5 : 1 }}
          >
            {acceptingOwnership ? 'accepting…' : 'activate'}
          </button>
        </div>
      )}

      {notice && (
        <div style={{
          color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: 'var(--accent-dark)',
          borderRadius: 8, border: '1px solid var(--accent-border)',
        }}>
          {notice}
        </div>
      )}

      {error && (
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: '#ff44441a',
          borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error}
        </div>
      )}

      {/* Approved but unstakeable. Imported predictions land in the feed already
          approved, so they never got a pool — without this they look live and
          then offer no way to back them. */}
      {!scanningPools && missingPools.length > 0 && (
        <div style={{
          marginBottom: 24, padding: 18, background: '#1a150a',
          borderRadius: 12, border: '1px solid #3d2f1a',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12, marginBottom: 4,
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--amber)' }}>
              {missingPools.length} approved prediction{missingPools.length === 1 ? '' : 's'} with no staking pool
            </div>
            <button
              onClick={handleCreateAllPools}
              disabled={creatingAll || poolBusyId !== null}
              className="btn btn-yes"
              style={{ padding: '8px 18px', fontSize: 13, borderRadius: 10, opacity: creatingAll ? 0.5 : 1 }}
            >
              {creatingAll ? 'creating…' : `create all ${missingPools.length}`}
            </button>
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 14,
          }}>
            {'// these are live in the feed but nobody can back them — one transaction each'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {missingPools.map(pred => (
              <div key={pred.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, flexWrap: 'wrap', padding: '10px 14px',
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {pred.subject} <span style={{ color: 'var(--text-dim)' }}>{pred.claim}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    resolves {pred.resolution_date}
                    {pred.resolution_plan?.external?.provider === 'polymarket' && ' · imported'}
                  </div>
                </div>
                <button
                  onClick={() => handleCreatePool(pred)}
                  disabled={poolBusyId !== null || creatingAll}
                  className="btn btn-yes"
                  style={{
                    padding: '7px 16px', fontSize: 12.5, borderRadius: 9,
                    opacity: poolBusyId === pred.id ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {poolBusyId === pred.id ? 'creating…' : 'create pool'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[0, 1].map(n => <div key={n} className="skeleton" style={{ height: 220 }} />)}
        </div>
      )}

      {!loading && predictions.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          nothing pending right now
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {predictions.map(pred => (
          <div key={pred.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 20,
          }}>
            {/* The creator's image — shown BEFORE the approve buttons so it gets
                moderated along with the prediction. Approving publishes it. */}
            {pred.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pred.image_url}
                alt="submitted with this prediction"
                style={{
                  width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block',
                  borderRadius: 10, border: '1px solid var(--border)', marginBottom: 14,
                }}
              />
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <Pill color="var(--blue)">{pred.subject}</Pill>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
              <Pill color="var(--purple)">{pred.claim}</Pill>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
              <Pill color="var(--amber)">{pred.condition ?? 'no condition'}</Pill>
            </div>

            {/* WHY THIS IS SITTING HERE. Auto-approval publishes anything that
                clears the checks, so everything left in this queue failed one
                on purpose — and without printing that reason the admin is
                re-deriving a decision the server already made and explained.
                Rows submitted before auto-approval existed have no note, and
                simply show nothing. */}
            {pred.approval_note && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                background: '#1a150a', border: '1px solid #3d2f1a', borderRadius: 10,
                padding: '10px 12px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.6,
                color: 'var(--amber)',
              }}>
                <span aria-hidden>👁</span>
                <span>
                  <strong style={{ fontWeight: 700 }}>held for you: </strong>
                  {pred.approval_note}
                </span>
              </div>
            )}

            {/* The resolution contract — expanded by default so the admin can
                judge it (and see any needs-review flag) before approving. */}
            <div style={{ marginBottom: 14 }}>
              {/* The moderation surface — the only place the review flag and
                  the parser's reasoning are meant to be read. */}
              <ResolutionPlanBadge plan={pred.resolution_plan} defaultOpen showReviewFlag showReviewReason />
            </div>

            <div style={{
              fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
            }}>
              <span>by {pred.creator_address.slice(0, 6)}...{pred.creator_address.slice(-4)}</span>
              <span>judgment day: {pred.resolution_date ?? 'not set'}</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleDecide(pred.id, 'approved')}
                disabled={busyId === pred.id}
                className="btn btn-yes"
                style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: busyId === pred.id ? 0.5 : 1 }}
              >
                ✓ approve
              </button>
              <button
                onClick={() => handleDecide(pred.id, 'rejected')}
                disabled={busyId === pred.id}
                className="btn btn-no"
                style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10, opacity: busyId === pred.id ? 0.5 : 1 }}
              >
                ✗ reject
              </button>
            </div>
          </div>
        ))}
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
