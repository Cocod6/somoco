// Somoco — auto-settlement from the source market
//
// This is the payoff of importing markets with a pointer back to where they came
// from. A prediction mirrored from Polymarket carries an ExternalResolutionRef,
// so Somoco does not have to JUDGE whether it came true — it reads the outcome
// the source already published and records it.
//
// That matters beyond convenience. lib/predictions/resolutionRules.ts says the
// rules are the contract, and a prediction market where the house decides who
// won is not a market, it's an opinion. Every prediction settled through this
// path was decided by UMA's optimistic oracle and the traders who bonded against
// it, not by anyone at Somoco.
//
// THE SECURITY PROPERTY THAT MAKES THIS SAFE TO RUN UNATTENDED:
// the caller cannot say what the outcome is. There is no outcome parameter. This
// module re-reads it from the source itself, and will only touch predictions
// that carry an external ref. A leaked secret therefore cannot fabricate a
// resolution — the worst it can do is trigger one the source already published.
// That is why this doesn't need the admin wallet signature /api/admin/resolve
// requires: that route accepts a human's judgement and must prove who made it.
//
// Same defensive defaults as the mirror: dryRun is TRUE unless explicitly
// disabled, and there's a hard spend ceiling checked before every write.

import { createPublicClient, createWalletClient, http, formatEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { INTUITION_RPC_URL, intuition } from '@/lib/chain'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { readPolymarketOutcome } from '@/lib/predictions/polymarket'
import { resolvePredictionOnChain } from '@/lib/predictions/resolveOnchain'
import { getMarketAddress, readMarketInfo } from '@/lib/predictions/settlement'
import { writeResolutionSentence } from '@/lib/predictions/resolutionSentence'
import type { ExternalResolutionRef } from '@/lib/predictions/types'

export interface SettleOptions {
  /** MUST be explicitly false to write anything. Default true. */
  dryRun?: boolean
  /** Max predictions to settle in one run. Default 10. */
  limit?: number
  /** Hard ceiling on TRUST spent in this run. Default 2. */
  maxSpendTrust?: number
  /**
   * Write the outcome Triple to Intuition as well as Somoco's own record.
   * Default true — a resolution that exists only in Somoco's database is the
   * forgeable kind this project deliberately moved away from.
   */
  writeOnChain?: boolean
  /** Settle only this prediction id. Useful for a first careful run. */
  predictionId?: string
}

export interface SettleItem {
  id: string
  subject: string
  claim: string
  condition: string | null
  resolutionDate: string | null
  sourceUrl: string
  outcome: 'resolved_true' | 'resolved_false'
  /** Present once written. */
  resolutionTripleId?: string
  txHash?: string
  costTrust?: string
  error?: string
}

export interface SettleReport {
  dryRun: boolean
  wallet: string | null
  walletBalanceTrust: string | null
  /** Approved, unresolved predictions carrying a source pointer. */
  candidates: number
  /** The source hasn't published an outcome yet — left alone, correctly. */
  stillOpen: number
  /** Has a money pool this wallet can't settle. Needs an admin. See below. */
  needsAdmin: SettleItem[]
  planned: SettleItem[]
  settled: SettleItem[]
  failed: SettleItem[]
  spentTrust: string
  stoppedBecause: string | null
}

interface CandidateRow {
  id: string
  triple_id: string
  creator_address: string
  subject: string
  claim: string
  condition: string | null
  resolution_date: string | null
  resolution_plan: { external?: ExternalResolutionRef } | null
}

/** Reads the settler's key — the same burner the mirror mints with. */
function readSettlerKey(): Hex | null {
  const key = process.env.MIRROR_PRIVATE_KEY?.trim()
  if (!key) return null
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex
}

/**
 * Predictions eligible for automatic settlement: approved, not yet resolved,
 * and carrying a pointer to a source that publishes its own outcome.
 *
 * Rejected rows are excluded on purpose — a human took them out of the feed, and
 * spending TRUST to write an outcome Triple for a prediction nobody can see is
 * money for nothing.
 */
async function loadCandidates(predictionId?: string): Promise<CandidateRow[]> {
  const db = supabaseAdmin()
  let query = db
    .from('predictions')
    .select('id, triple_id, creator_address, subject, claim, condition, resolution_date, resolution_plan')
    .eq('approval_status', 'approved')
    .eq('resolution_status', 'unresolved')
  if (predictionId) query = query.eq('id', predictionId)

  const { data, error } = await query
  if (error) throw new Error(`Could not read predictions: ${error.message}`)

  return (data ?? []).filter(
    (row): row is CandidateRow => row?.resolution_plan?.external?.provider === 'polymarket'
  )
}

/** Columns added by the 2026-08-18 receipt migration — see schema.sql. */
const RECEIPT_COLUMNS = [
  'resolution_source_url',
  'resolution_note',
  'resolved_at',
  'resolved_by',
] as const

export async function runSettlement(options: SettleOptions = {}): Promise<SettleReport> {
  const dryRun = options.dryRun !== false
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50)
  const writeOnChain = options.writeOnChain !== false
  const maxSpendWei = BigInt(Math.round((options.maxSpendTrust ?? 2) * 1e6)) * 10n ** 12n

  const publicClient = createPublicClient({ chain: intuition, transport: http(INTUITION_RPC_URL) })

  const key = readSettlerKey()
  const account = key ? privateKeyToAccount(key) : null
  const walletClient = account
    ? createWalletClient({ account, chain: intuition, transport: http(INTUITION_RPC_URL) })
    : null

  let balance: bigint | null = null
  if (account) balance = await publicClient.getBalance({ address: account.address })

  const report: SettleReport = {
    dryRun,
    wallet: account?.address ?? null,
    walletBalanceTrust: balance === null ? null : formatEther(balance),
    candidates: 0,
    stillOpen: 0,
    needsAdmin: [],
    planned: [],
    settled: [],
    failed: [],
    spentTrust: '0',
    stoppedBecause: null,
  }

  if (!dryRun && writeOnChain && !walletClient) {
    report.stoppedBecause =
      'MIRROR_PRIVATE_KEY is not set — cannot write the outcome Triple. Add a funded burner key, run with dryRun, or pass writeOnChain:false.'
    return report
  }

  const candidates = await loadCandidates(options.predictionId)
  report.candidates = candidates.length

  let spent = 0n

  for (const row of candidates) {
    if (report.planned.length + report.settled.length >= limit) break

    const external = row.resolution_plan!.external!

    // The source is the only authority here. No outcome comes from the caller.
    let outcome: 'resolved_true' | 'resolved_false' | null = null
    try {
      outcome = await readPolymarketOutcome(external)
    } catch {
      // A source that's unreachable is not a resolution — leave it open.
      outcome = null
    }
    if (!outcome) {
      report.stillOpen++
      continue
    }

    const item: SettleItem = {
      id: row.id,
      subject: row.subject,
      claim: row.claim,
      condition: row.condition,
      resolutionDate: row.resolution_date,
      sourceUrl: external.url,
      outcome,
    }

    // If real money is pooled on this prediction, settling it is not just a
    // bookkeeping write — the PredictionMarket contract has to declare the
    // outcome so winners can claim, and only the factory's resolver can do
    // that. The settler wallet isn't the resolver, so it stops and hands the
    // prediction to a human rather than marking it resolved in the database
    // while the pool sits open with no way to pay anyone out.
    try {
      const market = await getMarketAddress(publicClient, row.triple_id as Hex)
      if (market) {
        const info = await readMarketInfo(publicClient, market)
        if (info.state !== 'resolved' && info.state !== 'voided') {
          item.error = `Has a settlement pool at ${market} in state "${info.state}" — an admin must resolve it from the Resolve page so stakers can claim.`
          report.needsAdmin.push(item)
          continue
        }
      }
    } catch (err) {
      item.error = `Could not check the settlement pool: ${err instanceof Error ? err.message : 'unknown error'}`
      report.needsAdmin.push(item)
      continue
    }

    if (dryRun) {
      report.planned.push(item)
      continue
    }

    if (balance !== null && writeOnChain && balance - spent < maxSpendWei / BigInt(limit)) {
      report.stoppedBecause = `Settler wallet is low on TRUST (${formatEther(balance - spent)} left).`
      break
    }

    try {
      let txHash: string | undefined
      if (writeOnChain) {
        const before = await publicClient.getBalance({ address: account!.address })
        const result = await resolvePredictionOnChain({
          publicClient,
          walletClient: walletClient!,
          chainId: intuition.id,
          predictionTripleId: row.triple_id as Hex,
          creatorAddress: row.creator_address,
          outcome: outcome === 'resolved_true' ? 'true' : 'false',
          // Nobody predicted this — Somoco imported it. Writing "the import
          // wallet correctly predicted X" would be a lie in the graph.
          includeReputation: false,
        })
        const after = await publicClient.getBalance({ address: account!.address })
        txHash = result.txHash
        item.resolutionTripleId = result.resolutionTripleId
        item.txHash = result.txHash
        item.costTrust = formatEther(before - after)
        spent += before - after

        if (spent > maxSpendWei) {
          report.stoppedBecause = `Budget cap of ${formatEther(maxSpendWei)} TRUST reached.`
        }
      }

      // Somoco's own record last: if the on-chain write above failed, the
      // prediction stays unresolved and the next run retries it cleanly.
      const db = supabaseAdmin()
      const update: Record<string, unknown> = {
        resolution_status: outcome,
        resolution_tx_hash: txHash ?? null,
        // The receipt. This path has the strongest one there is: the outcome
        // was READ from the source, never judged, so the link is the whole
        // justification and 'polymarket-settler' names the mechanism rather
        // than a person — nobody exercised discretion here.
        resolution_source_url: external.url ?? null,
        // Same sentence writer the admin path uses, so a mechanically settled
        // market reads like every other one. It cannot invent evidence (it is
        // never told what happened), and if it is unavailable the fixed
        // sentence below stands in — this job runs unattended and must not
        // depend on a second service being up.
        resolution_note:
          (await writeResolutionSentence({
            subject: row.subject,
            claim: row.claim,
            condition: row.condition,
            outcome,
            sourceUrl: external.url,
            sourceName: 'the source market',
          })) ?? 'Settled automatically from the source market’s published outcome.',
        resolved_at: new Date().toISOString(),
        resolved_by: 'polymarket-settler',
      }
      let { error } = await db.from('predictions').update(update).eq('id', row.id)

      // Receipt columns are newer than this table. If schema.sql has not been
      // re-run, record the outcome anyway rather than losing a settlement that
      // already happened on-chain (same rule as insertPredictionRows).
      if (error && RECEIPT_COLUMNS.some(column => error!.message.includes(column))) {
        for (const column of RECEIPT_COLUMNS) delete update[column]
        ;({ error } = await db.from('predictions').update(update).eq('id', row.id))
        if (!error) item.error = 'Settled, but the receipt columns are missing — re-run schema.sql.'
      }
      if (error) item.error = `Triple written but Somoco's record did not update: ${error.message}`

      report.settled.push(item)
      if (report.stoppedBecause) break
    } catch (err) {
      item.error = err instanceof Error ? err.message : 'Unknown error'
      report.failed.push(item)
      if (report.failed.length >= 3) {
        report.stoppedBecause = 'Three settlements failed in a row — stopping.'
        break
      }
    }
  }

  report.spentTrust = formatEther(spent)
  return report
}
