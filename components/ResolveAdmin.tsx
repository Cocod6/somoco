'use client'

// Somoco — Phase 3: resolution admin view
// Approved predictions that are due for resolution show up here AUTOMATICALLY
// — pulled from Somoco's own database (set up after approval), not from the
// shared public Intuition graph. No manual entry needed anymore.
//
// Fake test predictions (from mockData.ts) still appear too, for free,
// wallet-free UI testing — they're clearly marked and never touch real money.
//
// Friend markets are the exception to "Somoco decides": when a prediction has
// an on-chain jury, the friends who bet (or their judge) settle it, and this
// screen offers no verdict at all — only Void, and a button to copy the
// friends' result into Somoco's record once they've reached it. Resolving one
// here used to write a permanent outcome Triple and mark the row resolved
// before the contract refused (it did, 2026-10-13, on a test market).

import { useEffect, useState } from 'react'
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi'
import type { Address, Hex } from 'viem'
import { mockPredictions } from '@/lib/predictions/mockData'
import { resolvePredictionOnChain } from '@/lib/predictions/resolveOnchain'
import { getMarketAddress, readMarketInfo, resolveMarket, voidMarket } from '@/lib/predictions/settlement'
import { signAdminAction } from '@/lib/adminSign'
import { readJuryView, type JuryView } from '@/lib/predictions/friendJury'
import { supabase, type PredictionRecord } from '@/lib/supabase'
import type { ExternalResolutionRef } from '@/lib/predictions/types'

interface DisplayPrediction {
  id: string
  subject: string
  claim: string
  condition: string
  resolutionDate: string
  creatorDisplay: string
  status: 'pending' | AdminOutcome
  tripleId: Hex | null // null = fake test entry, real bytes32 = real prediction
  creatorAddress: string | null
  supabaseId: string | null // needed to update the database record on resolve
  /**
   * Pointer to the market this was mirrored from, when there is one. Its
   * presence is what turns this screen from "decide the outcome" into "confirm
   * the outcome someone already published" — see sourceOutcomes below.
   */
  external: ExternalResolutionRef | null
  /** The creator asked for a friend market. Whether it really HAS a jury is read from the chain. */
  isPrivate: boolean
}

/** Per prediction id; only friend markets get an entry. */
type JuryEntry = JuryView | { kind: 'loading' }

/**
 * What the source market says, per prediction id.
 *   'loading'        — still being read
 *   'resolved_true'  — the source settled YES
 *   'resolved_false' — the source settled NO
 *   null             — the source has NOT settled yet, or could not be read
 */
type SourceOutcome = 'loading' | 'resolved_true' | 'resolved_false' | null

/**
 * What an admin can record. 'voided' is not a verdict — it says the question
 * stopped being answerable, so every stake is refunded fee-free and nobody's
 * record is touched. See lib/supabase.ts ResolutionStatus.
 */
type AdminOutcome = 'resolved_true' | 'resolved_false' | 'voided'

/** The explanation stored alongside an outcome so users need not just trust it. */
interface Receipt {
  sourceUrl: string
  note: string
}

function daysUntil(resolutionDate: string): number {
  // Parse "YYYY-MM-DD" as LOCAL midnight — new Date(string) would read it as
  // UTC, which in any timezone ahead of UTC makes a prediction due today show
  // as "due in 1d" and keeps it out of the "due now" tab until a day late.
  const [y, m, d] = resolutionDate.split('-').map(Number)
  const target = new Date(y, (m || 1) - 1, d || 1)
  const today = new Date()
  const diffMs = target.getTime() - today.setHours(0, 0, 0, 0)
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function statusLabel(resolutionDate: string): { text: string; color: string } {
  const days = daysUntil(resolutionDate)
  if (days < 0) return { text: `overdue by ${Math.abs(days)}d`, color: '#ff6b6b' }
  if (days === 0) return { text: 'due today', color: 'var(--amber)' }
  return { text: `due in ${days}d`, color: 'var(--text-muted)' }
}

function fromRecord(r: PredictionRecord): DisplayPrediction {
  return {
    id: r.id,
    subject: r.subject,
    claim: r.claim,
    condition: r.condition ?? 'no condition',
    resolutionDate: r.resolution_date ?? new Date().toISOString().slice(0, 10),
    creatorDisplay: `${r.creator_address.slice(0, 6)}...${r.creator_address.slice(-4)}`,
    status: r.resolution_status === 'unresolved' ? 'pending' : r.resolution_status,
    tripleId: r.triple_id as Hex,
    creatorAddress: r.creator_address,
    supabaseId: r.id,
    external: r.resolution_plan?.external ?? null,
    isPrivate: r.is_private === true,
  }
}

function fromMock(m: typeof mockPredictions[number]): DisplayPrediction {
  return {
    id: m.id,
    subject: m.subject,
    claim: m.claim,
    condition: m.condition,
    resolutionDate: m.resolutionDate,
    creatorDisplay: m.creator,
    status: m.status,
    tripleId: null,
    creatorAddress: null,
    supabaseId: null,
    external: null,
    isPrivate: false,
  }
}

export default function ResolveAdmin({ isConnected }: { isConnected: boolean }) {
  const [predictions, setPredictions] = useState<DisplayPrediction[]>(mockPredictions.map(fromMock))
  const [filter, setFilter] = useState<'due' | 'all' | 'resolved'>('due')
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTxHash, setLastTxHash] = useState<string | null>(null)
  // Portal links for the Triples created by resolving, keyed by prediction id
  // reputation is nullable: the auto-settler skips that Triple for imported
  // markets (see resolveOnchain's includeReputation). This admin flow always
  // writes it, but the type has to allow the absence.
  const [resolutionLinks, setResolutionLinks] = useState<Record<string, { resolution: string; reputation: string | null }>>({})
  const [loadingReal, setLoadingReal] = useState(true)
  // What the SOURCE market says, keyed by prediction id. Read once after the
  // predictions load. This is the whole point of the screen now: for a mirrored
  // prediction the outcome is already published, so the admin confirms it
  // rather than deciding it.
  const [sourceOutcomes, setSourceOutcomes] = useState<Record<string, SourceOutcome>>({})
  // Who decides each friend market, read from the chain once the rows load.
  const [juries, setJuries] = useState<Record<string, JuryEntry>>({})

  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()

  useEffect(() => {
    const loadApproved = async () => {
      setLoadingReal(true)
      const { data, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('approval_status', 'approved')
        .order('resolution_date', { ascending: true })

      if (!fetchError && data) {
        const realOnes = data.map(fromRecord)
        // Keep fake test entries + merge in real approved ones (real ones first)
        setPredictions(prev => {
          const fakeOnly = prev.filter(p => p.tripleId === null)
          return [...realOnes, ...fakeOnly]
        })
        void loadSourceOutcomes(realOnes)
      }
      setLoadingReal(false)
    }

    // Reads what each source market already published. Best-effort by design:
    // if this fails entirely the screen simply looks the way it always did, and
    // the admin can still resolve manually. It must never block resolution.
    const loadSourceOutcomes = async (rows: DisplayPrediction[]) => {
      const mirrored = rows.filter(p => p.external && p.status === 'pending')
      if (mirrored.length === 0) return

      setSourceOutcomes(Object.fromEntries(mirrored.map(p => [p.id, 'loading' as SourceOutcome])))
      try {
        const res = await fetch('/api/polymarket/outcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs: mirrored.map(p => p.external) }),
        })
        if (!res.ok) throw new Error(res.statusText)
        const { outcomes } = (await res.json()) as {
          outcomes: Record<string, 'resolved_true' | 'resolved_false' | null>
        }
        setSourceOutcomes(
          Object.fromEntries(
            mirrored.map(p => [p.id, outcomes[p.external!.marketId] ?? null] as const)
          )
        )
      } catch (err) {
        console.error('could not read source outcomes', err)
        setSourceOutcomes(Object.fromEntries(mirrored.map(p => [p.id, null as SourceOutcome])))
      }
    }

    loadApproved()
  }, [])

  // Friend markets: read each one's jury. A stable string key so this reruns
  // when the set of friend markets changes, not on every status update.
  const friendKey = predictions
    .filter(p => p.isPrivate && p.tripleId)
    .map(p => `${p.id}:${p.tripleId}`)
    .join(',')

  useEffect(() => {
    if (!publicClient || !friendKey) return
    let cancelled = false
    const pairs = friendKey.split(',').map(pair => pair.split(':') as [string, Hex])
    void Promise.all(
      pairs.map(async ([id, tripleId]) => [id, await readJuryView(publicClient, tripleId)] as const)
    ).then(views => {
      if (!cancelled) setJuries(prev => ({ ...prev, ...Object.fromEntries(views) }))
    })
    return () => { cancelled = true }
  }, [publicClient, friendKey])

  /**
   * Writes an outcome to Somoco's own record via the signed admin route.
   * Returns an error message, or null. The chain is always updated BEFORE this
   * runs, so a failure here means "the record is behind", never "it didn't happen".
   */
  const recordInDb = async (
    pred: DisplayPrediction,
    outcome: AdminOutcome,
    txHash: string | null,
    receipt: Receipt
  ): Promise<string | null> => {
    if (!pred.supabaseId || !address || !walletClient) return null
    try {
      const auth = await signAdminAction(walletClient, address, outcome, pred.supabaseId)
      const res = await fetch('/api/admin/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pred.supabaseId,
          outcome,
          txHash,
          // The receipt. Who and when are set by the server from the
          // signature and its own clock — a browser cannot claim either.
          sourceUrl: receipt.sourceUrl || pred.external?.url || '',
          note: receipt.note,
          auth,
        }),
      })
      if (!res.ok) {
        const { error: apiError } = await res.json().catch(() => ({ error: res.statusText }))
        return apiError ?? res.statusText
      }
      // A stored outcome with no receipt is the old behaviour, not a
      // failure — but say so, because the whole point was the receipt.
      const { receiptStored } = (await res.json().catch(() => ({}))) as { receiptStored?: boolean }
      if (receiptStored === false) {
        setError('Recorded, but the receipt columns are missing — re-run schema.sql in Supabase.')
      }
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'signature declined'
    }
  }

  /**
   * Copies a friend market's on-chain result into Somoco's record. Writes no
   * Triple: the friends decided this, and Somoco publishing its own verdict
   * about it is exactly what this screen must not do. The server re-reads the
   * chain and refuses anything the contract doesn't already say.
   */
  const handleRecordFriends = async (pred: DisplayPrediction) => {
    setError(null)
    if (!pred.tripleId || !publicClient) return
    setResolvingId(pred.id)
    try {
      const view = await readJuryView(publicClient, pred.tripleId)
      setJuries(prev => ({ ...prev, [pred.id]: view }))
      if (view.kind !== 'jury') {
        setError(view.kind === 'unreadable' ? `Could not read the jury: ${view.reason}` : 'This market has no jury on-chain.')
        return
      }
      const outcome = settledOutcome(view)
      if (!outcome) {
        setError('The friends have not settled this market on-chain yet.')
        return
      }
      const failure = await recordInDb(pred, outcome, null, {
        sourceUrl: `https://explorer.intuition.systems/address/${view.market}`,
        note: outcome === 'voided'
          ? 'Voided on-chain — every stake refunded.'
          : `Settled ${outcome === 'resolved_true' ? 'YES' : 'NO'} on-chain by the friends who bet in this market${view.jury.disputed ? ', with their judge deciding the split vote' : ''}.`,
      })
      if (failure) {
        setError(`Somoco's record did not update: ${failure}`)
        return
      }
      setPredictions(prev => prev.map(p => (p.id === pred.id ? { ...p, status: outcome } : p)))
    } finally {
      setResolvingId(null)
    }
  }

  const handleResolve = async (
    pred: DisplayPrediction,
    outcome: AdminOutcome,
    receipt: Receipt = { sourceUrl: '', note: '' }
  ) => {
    setError(null)

    // Voiding is a different act from resolving, not a third verdict: it asserts
    // nothing about the world, so it writes NO outcome Triple — there is no
    // claim to record on a permanent public graph. It only refunds the pool and
    // notes in Somoco's own record that the question collapsed.
    const isVoid = outcome === 'voided'

    // FAKE test prediction — just simulate locally, no wallet needed
    if (!pred.tripleId || !pred.creatorAddress) {
      setPredictions(prev => prev.map(p => (p.id === pred.id ? { ...p, status: outcome } : p)))
      return
    }

    // REAL prediction — this writes actual Triples on-chain
    if (!isConnected || !walletClient || !publicClient) {
      alert('Connect your wallet first to resolve a real prediction.')
      return
    }

    // Friend-market guard — the real one; the card hiding its buttons is only
    // the first line. Read fresh from the chain, and fail closed: if we can't
    // tell whether a jury decides this, Somoco writes nothing.
    if (pred.isPrivate) {
      const view = await readJuryView(publicClient, pred.tripleId)
      setJuries(prev => ({ ...prev, [pred.id]: view }))
      if (view.kind === 'unreadable') {
        setError(`Could not check whether the friends decide this one, so nothing was written: ${view.reason}`)
        return
      }
      if (view.kind === 'jury') {
        if (!isVoid) {
          setError('This is a friend market — the friends who bet in it (or their judge) decide the outcome, not Somoco. You can only void it.')
          return
        }
        if (settledOutcome(view)) {
          setError('This market is already settled on-chain — use "record their result" instead.')
          return
        }
      }
    }

    // Contradiction guard. If the source market already published an outcome
    // and the admin is about to record the OPPOSITE, stop and make them say so
    // out loud. Nothing here blocks it — there are real cases where the source
    // is wrong or resolves a subtly different question — but overriding a
    // published result should never be a thing that happens by mis-click, least
    // of all on a market holding other people's money.
    const published = pred.external ? sourceOutcomes[pred.id] : undefined
    if (!isVoid && published && published !== 'loading' && published !== outcome) {
      const sourceSays = published === 'resolved_true' ? 'YES' : 'NO'
      const youSay = outcome === 'resolved_true' ? 'YES' : 'NO'
      const confirmed = window.confirm(
        `Polymarket settled this ${sourceSays}. You are about to resolve it ${youSay}.\n\n` +
          `This overrides a published outcome that anyone can check, on a market that may hold other people's stakes.\n\n` +
          `Continue only if you are certain the source is wrong or is answering a different question.`
      )
      if (!confirmed) return
    }

    // The mirror image of the guard above. Voiding a question the source DID
    // answer refunds the people who called it right — it takes their winnings
    // away just as surely as resolving the wrong way would.
    if (isVoid && published && published !== 'loading') {
      const sourceSays = published === 'resolved_true' ? 'YES' : 'NO'
      const confirmed = window.confirm(
        `Polymarket settled this ${sourceSays}. Voiding refunds everyone instead of paying whoever was right.\n\n` +
          `Void only if the question itself collapsed — not because the outcome is awkward.`
      )
      if (!confirmed) return
    }

    setResolvingId(pred.id)

    // Settlement pool pre-check: if this prediction has a market that is still
    // OPEN (staking hasn't locked), block the whole resolution — resolving the
    // Triples now would leave the money pool stranded with no UI path to
    // settle it later. The contract itself also rejects resolving an open
    // market; this check just fails fast with a clearer message.
    let settlementMarket: `0x${string}` | null = null
    try {
      settlementMarket = await getMarketAddress(publicClient, pred.tripleId)
      if (settlementMarket) {
        const info = await readMarketInfo(publicClient, settlementMarket)
        // void() is reachable from Open as well as Locked (contract §8) — a
        // market that is obviously broken should not have to wait for its lock
        // to pass before everyone can be refunded.
        if (info.state === 'open' && !isVoid) {
          const locks = new Date(info.lockAt * 1000).toLocaleString()
          setError(`The settlement pool is still open for staking (locks ${locks}). Resolve after it locks.`)
          setResolvingId(null)
          return
        }
        if (info.state === 'resolved' || info.state === 'voided') {
          settlementMarket = null // pool already settled — nothing more to do there
        }
      }
    } catch (err) {
      console.error('settlement pre-check failed', err)
      settlementMarket = null // fail open: Triple resolution can proceed without the pool
    }

    const verb = isVoid ? 'Voided' : 'Resolved'

    try {
      let onChainTxHash: string | null = null

      if (isVoid) {
        // No Triple is written. A void is the absence of an answer, and the
        // graph should not carry an assertion that nothing happened.
        if (settlementMarket) {
          const voidTx = await voidMarket(publicClient, walletClient, settlementMarket)
          onChainTxHash = voidTx
          setLastTxHash(voidTx)
        }
      } else {
        const result = await resolvePredictionOnChain({
          publicClient,
          walletClient,
          chainId,
          predictionTripleId: pred.tripleId,
          creatorAddress: pred.creatorAddress,
          outcome: outcome === 'resolved_true' ? 'true' : 'false',
        })
        onChainTxHash = result.txHash
        setLastTxHash(result.txHash)
        setResolutionLinks(prev => ({
          ...prev,
          [pred.id]: { resolution: result.resolutionTripleId, reputation: result.reputationTripleId },
        }))

        // Settle the money pool (if one exists and is locked): declares the
        // outcome on the PredictionMarket contract so winners can claim.
        // The connected admin wallet must be the contract's resolver.
        if (settlementMarket) {
          try {
            const marketTx = await resolveMarket(
              publicClient,
              walletClient,
              settlementMarket,
              outcome === 'resolved_true' ? 'yes' : 'no'
            )
            setLastTxHash(marketTx)
          } catch (err) {
            const message = err instanceof Error ? err.message.split('\n')[0] : 'settlement failed'
            setError(`Triples resolved, but the settlement pool did not settle: ${message}`)
          }
        }
      }

      // Update Somoco's own record to reflect the real resolution. This is a
      // privileged write, so it goes through the server and needs an admin
      // signature — the on-chain tx above already proved the admin is present,
      // but the DB write needs its own proof (see lib/adminAuth.ts).
      const failure = await recordInDb(pred, outcome, onChainTxHash, receipt)
      if (failure) {
        // The chain is already updated — surface this without implying the
        // resolution itself failed, because it didn't.
        setError(`${verb} on-chain, but Somoco's own record did not update: ${failure}`)
      }

      setPredictions(prev => prev.map(p => (p.id === pred.id ? { ...p, status: outcome } : p)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Resolution failed.'
      setError(`On-chain ${isVoid ? 'void' : 'resolution'} failed: ${message}`)
    } finally {
      setResolvingId(null)
    }
  }

  const visible = predictions.filter(p => {
    if (filter === 'all') return true
    if (filter === 'resolved') return p.status !== 'pending'
    return p.status === 'pending' && daysUntil(p.resolutionDate) <= 0
  })

  const dueCount = predictions.filter(
    p => p.status === 'pending' && daysUntil(p.resolutionDate) <= 0
  ).length

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        resolve predictions
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, fontFamily: 'var(--font-mono)' }}>
        {'// approved predictions appear here automatically once due'}
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

      {lastTxHash && (
        <a
          href={`https://explorer.intuition.systems/tx/${lastTxHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'block', fontSize: 12, color: 'var(--accent)',
            fontFamily: 'var(--font-mono)', marginBottom: 16, textDecoration: 'underline',
          }}
        >
          view last resolution transaction on explorer ↗
        </a>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'due', label: `due now (${dueCount})` },
          { id: 'all', label: 'all' },
          { id: 'resolved', label: 'resolved' },
        ].map(tab => (
          // Same filter pills as the feed's category tabs — one vocabulary.
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as typeof filter)}
            className={`chip${filter === tab.id ? ' active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
        {loadingReal && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
            loading approved predictions...
          </span>
        )}
      </div>

      {visible.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 48, textAlign: 'center', color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', fontSize: 13,
        }}>
          nothing here right now
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visible.map(pred => (
          <PredictionCard
            key={pred.id}
            prediction={pred}
            onResolve={handleResolve}
            onRecordFriends={handleRecordFriends}
            jury={pred.isPrivate && pred.tripleId ? juries[pred.id] ?? { kind: 'loading' } : undefined}
            isResolving={resolvingId === pred.id}
            portalLinks={resolutionLinks[pred.id]}
            sourceOutcome={pred.external ? sourceOutcomes[pred.id] ?? 'loading' : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function PredictionCard({
  prediction,
  onResolve,
  onRecordFriends,
  jury,
  isResolving,
  portalLinks,
  sourceOutcome,
}: {
  prediction: DisplayPrediction
  onResolve: (pred: DisplayPrediction, outcome: AdminOutcome, receipt: Receipt) => void
  onRecordFriends: (pred: DisplayPrediction) => void
  /** undefined = not a friend market. Anything but `none` means Somoco gives no verdict here. */
  jury?: JuryEntry
  isResolving: boolean
  portalLinks?: { resolution: string; reputation: string | null }
  /** undefined = not a mirrored prediction, so there is nothing to confirm. */
  sourceOutcome?: SourceOutcome
}) {
  // The receipt is captured per card, right next to the verdict it explains.
  // A mirrored prediction arrives with its source link already filled in —
  // the commonest receipt should cost the admin nothing to include.
  const [sourceUrl, setSourceUrl] = useState(prediction.external?.url ?? '')
  const [note, setNote] = useState('')

  const status = statusLabel(prediction.resolutionDate)
  const isResolved = prediction.status !== 'pending'
  const isReal = prediction.tripleId !== null
  // A friend market whose outcome is not Somoco's to give. 'loading' and
  // 'unreadable' count too: the verdict buttons stay hidden until we know.
  const friendsDecide = jury !== undefined && jury.kind !== 'none'

  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${isReal ? 'var(--accent-border)' : 'var(--border)'}`,
      borderRadius: 14, padding: 20,
    }}>
      {isReal && (
        <div style={{
          display: 'inline-block', fontSize: 10, color: 'var(--accent)',
          fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 10,
          background: 'var(--accent-dark)', border: '1px solid var(--accent-border)',
          borderRadius: 999, padding: '3px 10px',
        }}>
          REAL · ON-CHAIN
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Pill color="var(--blue)">{prediction.subject}</Pill>
        <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
        <Pill color="var(--purple)">{prediction.claim}</Pill>
        <span style={{ color: 'var(--text-dim)', fontSize: 13, alignSelf: 'center' }}>→</span>
        <Pill color="var(--amber)">{prediction.condition}</Pill>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)',
        fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span>by {prediction.creatorDisplay}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          <span>judgment day: {prediction.resolutionDate}</span>
          {!isResolved && <span style={{ color: status.color }}>{status.text}</span>}
        </span>
      </div>

      {/* Every real prediction links to its Triple on the Intuition portal */}
      {isReal && prediction.tripleId && (
        <a
          href={`https://portal.intuition.systems/explore/triple/${prediction.tripleId}?tab=positions`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-block', fontSize: 12, color: 'var(--blue)',
            fontFamily: 'var(--font-mono)', textDecoration: 'underline', marginBottom: 14,
          }}
        >
          view prediction on intuition portal ↗
        </a>
      )}

      {/* What the source market already published. Shown ABOVE the buttons on
          purpose: the admin should read the answer before reaching for a
          verdict, not after. */}
      {jury && friendsDecide && (
        <FriendJuryPanel
          jury={jury}
          status={prediction.status}
          isResolving={isResolving}
          onRecord={() => onRecordFriends(prediction)}
          onVoid={() => onResolve(prediction, 'voided', { sourceUrl: '', note: '' })}
        />
      )}

      {!isResolved && sourceOutcome !== undefined && (
        <SourceOutcomeBanner outcome={sourceOutcome} url={prediction.external?.url} />
      )}

      {/* The receipt, captured before the verdict rather than after: users see
          "resolved false" and currently have to take Somoco's word for it. A
          link and a sentence are the difference between a record and a claim. */}
      {!isResolved && !friendsDecide && (
        <div style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
          <input
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="source url — where anyone can check this (optional)"
            style={{
              width: '100%', padding: '9px 12px', fontSize: 12,
              fontFamily: 'var(--font-mono)', background: '#0a0a0a',
              border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text)',
            }}
          />
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={500}
            placeholder="why, in one line — shown to everyone who staked (optional)"
            style={{
              width: '100%', padding: '9px 12px', fontSize: 12,
              background: '#0a0a0a', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text)',
            }}
          />
        </div>
      )}

      {friendsDecide ? null : !isResolved ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => onResolve(prediction, 'resolved_true', { sourceUrl, note })}
            disabled={isResolving}
            className="btn btn-yes"
            style={{
              flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10,
              opacity: isResolving ? 0.5 : dimUnless(sourceOutcome, 'resolved_true'),
            }}
          >
            {isResolving
              ? '⟳ resolving...'
              : sourceOutcome === 'resolved_true'
                ? '✓ confirm TRUE'
                : '✓ mark true'}
          </button>
          <button
            onClick={() => onResolve(prediction, 'resolved_false', { sourceUrl, note })}
            disabled={isResolving}
            className="btn btn-no"
            style={{
              flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 10,
              opacity: isResolving ? 0.5 : dimUnless(sourceOutcome, 'resolved_false'),
            }}
          >
            {sourceOutcome === 'resolved_false' ? '✗ confirm FALSE' : '✗ mark false'}
          </button>

          {/* Third exit, deliberately smaller and last: the honest answer when
              the question collapsed. Refunds everyone fee-free. Before this
              existed, such a market's only ways out were a coin-flip verdict
              or waiting 30 days for the permissionless timeout. */}
          <button
            onClick={() => onResolve(prediction, 'voided', { sourceUrl, note })}
            disabled={isResolving}
            title="Refund everyone — use when the question can no longer be answered"
            style={{
              padding: '10px 14px', fontSize: 13, borderRadius: 10, cursor: 'pointer',
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              opacity: isResolving ? 0.5 : 1,
            }}
          >
            ⊘ void
          </button>
        </div>
      ) : (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: outcomeStyle(prediction.status).bg,
            color: outcomeStyle(prediction.status).color,
            border: `1px solid ${outcomeStyle(prediction.status).border}`,
            borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 700,
            marginBottom: 10,
          }}>
            {outcomeStyle(prediction.status).text}
          </div>

          <div style={{
            background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 8,
            padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'var(--text-dim)', lineHeight: 1.8,
          }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{'// resolution triple → '}</span>
              [prediction] [resolved] [{prediction.status === 'resolved_true' ? 'true' : 'false'}]
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{'// reputation triple → '}</span>
              [{prediction.creatorDisplay}] [{prediction.status === 'resolved_true' ? 'correctly' : 'incorrectly'} predicted] [prediction]
            </div>
            {isReal && (
              <div style={{ marginTop: 6, color: 'var(--accent)' }}>
                ✓ written for real on intuition mainnet
              </div>
            )}
          </div>

          {/* Portal links to the two Triples this resolution just created */}
          {portalLinks && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <a
                href={`https://portal.intuition.systems/explore/triple/${portalLinks.resolution}?tab=positions`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', textDecoration: 'underline' }}
              >
                view resolution triple on intuition portal ↗
              </a>
              {portalLinks.reputation && (
                <a
                  href={`https://portal.intuition.systems/explore/triple/${portalLinks.reputation}?tab=positions`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', textDecoration: 'underline' }}
                >
                  view reputation triple on intuition portal ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Fades the button that CONTRADICTS a published outcome, so the confirming
 * action is the one that reads as the default. Deliberately a fade and not a
 * disable — overriding the source has to stay possible, just never accidental.
 */
/**
 * How a finished prediction reads. Voided is intentionally grey, not red or
 * green: nobody was right and nobody was wrong, everyone got their stake back.
 */
function outcomeStyle(status: 'pending' | AdminOutcome): {
  text: string; bg: string; color: string; border: string
} {
  if (status === 'resolved_true') {
    return { text: '✓ resolved true', bg: 'var(--accent-dark)', color: 'var(--accent)', border: 'var(--accent-border)' }
  }
  if (status === 'voided') {
    return { text: '⊘ voided — everyone refunded', bg: '#141414', color: 'var(--text-muted)', border: 'var(--border)' }
  }
  return { text: '✗ resolved false', bg: '#1a0a0a', color: '#ff6b6b', border: '#3d1a1a' }
}

/** What a friend market's contract has settled on, or null while it is still open/locked. */
function settledOutcome(view: Extract<JuryView, { kind: 'jury' }>): AdminOutcome | null {
  if (view.marketState === 'voided') return 'voided'
  if (view.marketState !== 'resolved') return null
  if (view.marketOutcome === 'yes') return 'resolved_true'
  if (view.marketOutcome === 'no') return 'resolved_false'
  return null
}

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Stands in for the verdict buttons on a friend market. Somoco's only moves
 * here are to refund everyone (void) or to copy what the friends decided into
 * its own record — both checked again by the server against the chain.
 */
function FriendJuryPanel({
  jury, status, isResolving, onRecord, onVoid,
}: {
  jury: JuryEntry
  status: 'pending' | AdminOutcome
  isResolving: boolean
  onRecord: () => void
  onVoid: () => void
}) {
  const box: React.CSSProperties = {
    borderRadius: 10, padding: '12px 14px', marginBottom: 12,
    background: 'var(--purple-bg)', border: '1px solid var(--purple-border)',
    fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-muted)',
  }
  const heading = (
    <div style={{ fontSize: 10, letterSpacing: 1, fontFamily: 'var(--font-mono)', color: 'var(--purple)', marginBottom: 6 }}>
      FRIEND MARKET · THE FRIENDS DECIDE, NOT SOMOCO
    </div>
  )

  if (jury.kind === 'loading') {
    return <div style={box}>{heading}checking on-chain who decides this…</div>
  }
  if (jury.kind === 'unreadable') {
    return (
      <div style={box}>
        {heading}
        Couldn&apos;t read this market&apos;s jury from the chain, so the verdict buttons stay hidden.
        Reload to try again. <span style={{ color: 'var(--text-dim)' }}>({jury.reason})</span>
      </div>
    )
  }
  if (jury.kind !== 'jury') return null

  const j = jury.jury
  const settled = settledOutcome(jury)
  const recorded = status !== 'pending'
  const judgeLine = j.finalized
    ? 'the jury has ruled'
    : j.disputed
      ? 'votes are split — the judge can rule now'
      : j.judgeCanActNow
        ? 'voting window is over — the judge can rule now'
        : `the judge can rule from ${new Date(j.judgeFrom * 1000).toLocaleString()}`

  const buttonStyle: React.CSSProperties = {
    padding: '9px 14px', fontSize: 12.5, borderRadius: 10, cursor: 'pointer',
    background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
    opacity: isResolving ? 0.5 : 1,
  }

  return (
    <div style={box}>
      {heading}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {j.votesCast} of {j.voterCount} voted ({j.votesYes} yes · {j.votesNo} no) · judge {short(j.judge)} · {judgeLine}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        on-chain: {settled ? outcomeStyle(settled).text : `not settled yet (${jury.marketState})`}
        {recorded && <> · somoco&apos;s record: {outcomeStyle(status).text}</>}
      </div>

      {/* The record and the money disagree — say so plainly. */}
      {recorded && settled !== status && (
        <div style={{ marginTop: 8, color: 'var(--amber)' }}>
          {settled
            ? 'Somoco’s record does not match what the contract settled. Recording the friends’ result will correct it.'
            : 'Somoco’s record says this is settled, but the contract hasn’t settled — the stakes are still locked. The friends or their judge can still decide it; then record their result here. Or void it to refund everyone.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        {settled && settled !== status && (
          <button onClick={onRecord} disabled={isResolving} className="btn" style={{ ...buttonStyle, color: 'var(--text)' }}>
            {isResolving ? '⟳ recording…' : 'record their result'}
          </button>
        )}
        {!settled && (
          <button
            onClick={onVoid}
            disabled={isResolving}
            title="Refund everyone — the only outcome Somoco may give a friend market"
            style={buttonStyle}
          >
            {isResolving ? '⟳ voiding…' : '⊘ void — refund everyone'}
          </button>
        )}
      </div>
    </div>
  )
}

function dimUnless(outcome: SourceOutcome | undefined, side: 'resolved_true' | 'resolved_false'): number {
  if (outcome === 'resolved_true' || outcome === 'resolved_false') return outcome === side ? 1 : 0.4
  return 1
}

/**
 * The bridge, made visible. Somoco imported this prediction from a market that
 * settles its own outcomes, so resolving it is not a judgement call — it is
 * recording what was already decided somewhere public and checkable.
 */
function SourceOutcomeBanner({ outcome, url }: { outcome: SourceOutcome; url?: string }) {
  const base: React.CSSProperties = {
    borderRadius: 10, padding: '10px 14px', marginBottom: 12,
    fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
  }

  if (outcome === 'loading') {
    return (
      <div style={{ ...base, background: '#0a0a0a', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
        reading the source market...
      </div>
    )
  }

  // Mirrored, but the source hasn't settled. Resolving now means the admin is
  // making the call personally — which is exactly what they should be told.
  if (outcome === null) {
    return (
      <div style={{ ...base, background: '#1a1405', border: '1px solid #4a3a0a', color: 'var(--amber)' }}>
        <strong>the source has not settled this yet.</strong>
        <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          resolving now is your own judgement, not a confirmation.{' '}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)', textDecoration: 'underline' }}>
              check the source ↗
            </a>
          )}
        </div>
      </div>
    )
  }

  const yes = outcome === 'resolved_true'
  return (
    <div
      style={{
        ...base,
        background: yes ? 'var(--accent-dark)' : '#1a0a0a',
        border: `1px solid ${yes ? 'var(--accent-border)' : '#3d1a1a'}`,
        color: yes ? 'var(--accent)' : '#ff6b6b',
      }}
    >
      <strong>🔗 polymarket settled this {yes ? 'TRUE' : 'FALSE'}</strong>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
        you are confirming a published outcome, not deciding one.{' '}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: yes ? 'var(--accent)' : '#ff6b6b', textDecoration: 'underline' }}
          >
            verify at the source ↗
          </a>
        )}
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
