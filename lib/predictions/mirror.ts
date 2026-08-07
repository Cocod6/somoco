// Somoco — Polymarket auto-mirror
//
// Imports the top Polymarket markets into Somoco on a schedule: mints the Atoms
// + Triple on Intuition, then writes the bookkeeping row. Unlike every other
// write path in the app, nobody is standing at a wallet prompt — so this module
// spends real TRUST unattended, and is built defensively around that:
//
//   • dryRun defaults to TRUE. You must explicitly pass dryRun:false to spend.
//   • maxSpendTrust is a hard ceiling, checked before every mint. The run stops
//     rather than going one market over.
//   • the wallet balance is checked up front — a half-finished run that dies on
//     an out-of-gas revert is the worst outcome, so we'd rather not start.
//   • markets already mirrored are skipped, so re-running is safe and cheap.
//   • a market making a claim Somoco already has open is skipped, and one
//     resolving in the next few days is never fetched at all — Polymarket runs
//     the same question as a ladder of dated variants, and importing every rung
//     buries the feed in the same bet.
//
// Atom reuse matters more here than anywhere else: "Bitcoin" already exists on
// Intuition, so a Bitcoin market only pays for the parts that are genuinely new.
// A market whose subject, claim and condition all already exist costs one triple
// fee instead of four.

import { createPublicClient, createWalletClient, http, formatEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  getMultiVaultAddressFromChainId,
  multiVaultGetAtomCost,
  multiVaultGetTripleCost,
} from '@0xintuition/protocol'

import { INTUITION_RPC_URL, intuition } from '@/lib/chain'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { findExistingAtoms } from '@/lib/predictions/dedup'
import { submitPredictionOnChain } from '@/lib/predictions/onchain'
import { parsePredictionText } from '@/lib/predictions/parse'
import { fetchPolymarketDrafts, type PolymarketDraft } from '@/lib/predictions/polymarket'
import type { ExternalResolutionRef } from '@/lib/predictions/types'

export interface MirrorOptions {
  /** Max markets to import in one run. Default 5, hard cap 25. */
  limit?: number
  /** Minimum lifetime USD volume. Default 250k — a much higher bar than manual
   *  browsing, because nobody is reviewing what this imports. */
  minVolume?: number
  /** Restrict to one Somoco category id. */
  category?: string
  /** Hard ceiling on TRUST spent in this run. Default 5. */
  maxSpendTrust?: number
  /** MUST be explicitly false to spend anything. Default true. */
  dryRun?: boolean
  /** Mirrored markets skip the approval queue by default — that is the point of
   *  an auto-mirror. Set false to land them as 'pending' instead. */
  autoApprove?: boolean
  /** Run each question through the Haiku parser so the claim reads as English.
   *  Default true. Set false to use the free split and spend no AI credit. */
  useAiParse?: boolean
  /** Skip markets resolving sooner than this many days out. Default 7. */
  minDaysToResolution?: number
  /** Import a market even if Somoco already has an open prediction making the
   *  same claim about the same subject. Default false — see loadOpenClaimKeys. */
  allowDuplicateClaims?: boolean
}

export interface MirrorPlanItem {
  question: string
  subject: string
  claim: string
  condition: string
  category: string
  resolutionDate: string | null
  /** How many of the three Atoms must be created (0–3). The rest are reused. */
  newAtoms: number
  costTrust: string
  sourceUrl: string
  /** Present once actually minted. */
  tripleId?: string
  txHash?: string
  error?: string
}

export interface MirrorReport {
  dryRun: boolean
  /** Mirror wallet address, or null in a dry run with no key configured. */
  wallet: string | null
  walletBalanceTrust: string | null
  scanned: number
  alreadyMirrored: number
  /** Dropped because Somoco already has an open prediction with this claim. */
  duplicateClaims: MirrorPlanItem[]
  planned: MirrorPlanItem[]
  imported: MirrorPlanItem[]
  failed: MirrorPlanItem[]
  estimatedCostTrust: string
  spentTrust: string
  /** Why the run ended early, if it did. */
  stoppedBecause: string | null
}

/** Reads the mirror wallet's key. Absent is fine for a dry run. */
function readMirrorKey(): Hex | null {
  const key = process.env.MIRROR_PRIVATE_KEY?.trim()
  if (!key) return null
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex
}

/**
 * Every Polymarket market id Somoco has already imported.
 *
 * Read from resolution_plan rather than a dedicated column so that mirroring
 * needs no migration. The whole column is pulled and filtered in JS — the table
 * is small, and a jsonb path filter that silently matches nothing would cause
 * duplicate spending, which is the one failure mode worth being clumsy about.
 */
async function loadMirroredMarketIds(): Promise<Set<string>> {
  const db = supabaseAdmin()
  const { data, error } = await db.from('predictions').select('resolution_plan')
  if (error) throw new Error(`Could not read existing predictions: ${error.message}`)

  const ids = new Set<string>()
  for (const row of data ?? []) {
    const plan = row?.resolution_plan as { external?: ExternalResolutionRef } | null
    const external = plan?.external
    if (external?.provider === 'polymarket' && external.marketId) {
      ids.add(String(external.marketId))
    }
  }
  return ids
}

/**
 * Collapses a subject + claim pair into a comparison key.
 *
 * Deliberately lossy: case, punctuation, a leading article and repeated spaces
 * are all noise when the question is "is this the same bet?". The CONDITION is
 * excluded on purpose — the whole point is to catch Polymarket's date-laddered
 * variants, which differ ONLY in the condition.
 */
function claimKey(subject: string, claim: string): string {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9$% ]+/g, ' ')
      .replace(/^(the|a|an) /, '')
      .replace(/\s+/g, ' ')
      .trim()
  return `${norm(subject)}::${norm(claim)}`
}

/**
 * Claim keys Somoco already has an OPEN prediction for.
 *
 * Polymarket runs the same question as a ladder of dated variants — "Strait of
 * Hormuz traffic returns to normal" existed for August 15, August 31 and
 * September 30 at once. The marketId check above sees three different markets
 * and imports all three, filling the feed with the same bet three times and
 * splitting whatever liquidity Somoco has across them.
 *
 * Only open predictions block an import. Once a claim has resolved, the same
 * claim about a later date is a genuinely new bet ("Bitcoin above $62k" in
 * August and in December are not the same question), and a rejected row means a
 * human already decided that one shouldn't be in the feed — it shouldn't
 * permanently reserve the claim either.
 */
async function loadOpenClaimKeys(): Promise<Set<string>> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('predictions')
    .select('subject, claim, approval_status, resolution_status')
    .in('approval_status', ['approved', 'pending'])
    .eq('resolution_status', 'unresolved')
  if (error) throw new Error(`Could not read existing claims: ${error.message}`)

  const keys = new Set<string>()
  for (const row of data ?? []) {
    keys.add(claimKey(String(row?.subject ?? ''), String(row?.claim ?? '')))
  }
  return keys
}

/**
 * Looks up which of the three labels already exist on Intuition.
 *
 * `mintedThisRun` covers a gap the indexer leaves open: two markets in the same
 * batch often share a label ("Strait of Hormuz" appears in several), but an Atom
 * minted seconds ago is not yet queryable from the GraphQL indexer. Without this
 * cache the second market would pay to create a duplicate of the Atom the first
 * one just made — wasting TRUST and fragmenting exactly the graph this app is
 * supposed to be consolidating.
 */
async function resolveAtomReuse(labels: TripleLabels, mintedThisRun: Map<string, Hex>) {
  const lookup = async (label: string): Promise<Hex | null> => {
    const cached = mintedThisRun.get(label.trim().toLowerCase())
    if (cached) return cached
    const matches = await findExistingAtoms(label)
    return (matches[0]?.atomId as Hex | undefined) ?? null
  }

  const [existingSubjectAtomId, existingPredicateAtomId, existingObjectAtomId] = await Promise.all([
    lookup(labels.subject),
    lookup(labels.claim),
    lookup(labels.condition),
  ])
  return { existingSubjectAtomId, existingPredicateAtomId, existingObjectAtomId }
}

interface TripleLabels {
  subject: string
  claim: string
  condition: string
}

/**
 * Turns a market question into a claim in Somoco's house voice.
 *
 * The free split in polymarket.ts drops the leading "Will", which leaves the
 * verb in the infinitive — "Apple be the largest company", "the Fed increase
 * interest rates". Fine as data, but it reads as broken English in the feed.
 * The Haiku parser writes the third-person form the rest of the app uses
 * ("is the largest company", "increases interest rates").
 *
 * Falls back to the free split if the AI is unavailable — a mirrored market
 * with clumsy grammar beats a run that dies on a missing API key.
 */
async function refineLabels(draft: PolymarketDraft): Promise<TripleLabels> {
  try {
    const { parsed } = await parsePredictionText(draft.question)
    if (parsed.subject.trim() && parsed.claim.trim()) {
      return {
        subject: parsed.subject.trim(),
        claim: parsed.claim.trim(),
        // Polymarket's end date still wins for resolution_date; this is only
        // the human-readable object atom, where the AI's phrasing reads better.
        //
        // 'no condition' is the parser's placeholder for free text with no
        // timeframe. A Polymarket market ALWAYS has an end date, so that
        // placeholder is never right here — and it renders in the feed as
        // "Yossi Cohen becomes the next Prime Minister of Israel no condition?".
        condition:
          !parsed.condition.trim() || parsed.condition.trim() === 'no condition'
            ? draft.suggested.condition
            : parsed.condition.trim(),
      }
    }
  } catch {
    // fall through to the deterministic split
  }
  return draft.suggested
}

/** One row of the report. Built for skipped markets too, so a rejected import
 *  is as legible as an accepted one. */
function toPlanItem(
  draft: PolymarketDraft,
  labels: TripleLabels,
  newAtoms: number,
  cost: bigint
): MirrorPlanItem {
  return {
    question: draft.question,
    subject: labels.subject,
    claim: labels.claim,
    condition: labels.condition,
    category: draft.category,
    resolutionDate: draft.resolutionDate,
    newAtoms,
    costTrust: formatEther(cost),
    sourceUrl: draft.sourceUrl,
  }
}

/**
 * Runs one mirror pass. Safe to call repeatedly — already-imported markets are
 * skipped, so a cron hitting this hourly converges rather than duplicating.
 */
export async function runMirror(options: MirrorOptions = {}): Promise<MirrorReport> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25)
  const minVolume = options.minVolume ?? 250_000
  const dryRun = options.dryRun !== false
  const autoApprove = options.autoApprove !== false
  const useAiParse = options.useAiParse !== false
  const minDaysToResolution = Math.max(options.minDaysToResolution ?? 7, 0)
  const allowDuplicateClaims = options.allowDuplicateClaims === true
  const maxSpendWei = BigInt(Math.round((options.maxSpendTrust ?? 5) * 1e6)) * 10n ** 12n

  const publicClient = createPublicClient({ chain: intuition, transport: http(INTUITION_RPC_URL) })
  const multiVault = getMultiVaultAddressFromChainId(intuition.id)

  // Live costs, not guesses — the contract is the only honest source.
  const [atomCost, tripleCost] = await Promise.all([
    multiVaultGetAtomCost({ address: multiVault, publicClient }),
    multiVaultGetTripleCost({ address: multiVault, publicClient }),
  ])

  const key = readMirrorKey()
  const account = key ? privateKeyToAccount(key) : null
  const walletClient = account
    ? createWalletClient({ account, chain: intuition, transport: http(INTUITION_RPC_URL) })
    : null

  let balance: bigint | null = null
  if (account) balance = await publicClient.getBalance({ address: account.address })

  const report: MirrorReport = {
    dryRun,
    wallet: account?.address ?? null,
    walletBalanceTrust: balance === null ? null : formatEther(balance),
    scanned: 0,
    alreadyMirrored: 0,
    duplicateClaims: [],
    planned: [],
    imported: [],
    failed: [],
    estimatedCostTrust: '0',
    spentTrust: '0',
    stoppedBecause: null,
  }

  if (!dryRun && !walletClient) {
    report.stoppedBecause =
      'MIRROR_PRIVATE_KEY is not set — cannot mint. Add a funded burner key to .env.local, or run with dryRun.'
    return report
  }

  // Over-fetch: most candidates will already be mirrored on later runs.
  const { drafts, scanned } = await fetchPolymarketDrafts({
    limit: limit * 5,
    minVolume,
    category: options.category,
    minDaysToResolution,
  })
  report.scanned = scanned

  const mirrored = await loadMirroredMarketIds()
  // Claims Somoco already has an open prediction for. Grown as the run goes, so
  // two date-laddered variants in the SAME batch can't both get through.
  const openClaims = allowDuplicateClaims ? new Set<string>() : await loadOpenClaimKeys()
  // Atoms created earlier in THIS run, keyed by lowercased label — the indexer
  // won't know about them yet. See resolveAtomReuse.
  const mintedThisRun = new Map<string, Hex>()
  let spent = 0n
  let estimated = 0n

  for (const draft of drafts) {
    if (report.planned.length + report.imported.length >= limit) break

    const external = draft.resolutionPlan.external
    if (!external) continue
    if (mirrored.has(external.marketId)) {
      report.alreadyMirrored++
      continue
    }

    // Cheap check first, on the free split, so an obvious repeat doesn't pay
    // for an AI call. The refined labels are checked again below, because the
    // parser's wording is what actually lands in the feed.
    if (!allowDuplicateClaims && openClaims.has(claimKey(draft.suggested.subject, draft.suggested.claim))) {
      report.duplicateClaims.push(toPlanItem(draft, draft.suggested, 0, 0n))
      continue
    }

    const labels = useAiParse ? await refineLabels(draft) : draft.suggested

    const key = claimKey(labels.subject, labels.claim)
    if (!allowDuplicateClaims && openClaims.has(key)) {
      report.duplicateClaims.push(toPlanItem(draft, labels, 0, 0n))
      continue
    }

    const reuse = await resolveAtomReuse(labels, mintedThisRun)
    const newAtoms = [
      reuse.existingSubjectAtomId,
      reuse.existingPredicateAtomId,
      reuse.existingObjectAtomId,
    ].filter(id => id === null).length

    const cost = atomCost * BigInt(newAtoms) + tripleCost
    const item = toPlanItem(draft, labels, newAtoms, cost)

    // Budget gate — checked BEFORE spending, so the ceiling is never crossed.
    if (estimated + spent + cost > maxSpendWei) {
      report.stoppedBecause = `Budget cap of ${formatEther(maxSpendWei)} TRUST reached.`
      break
    }

    if (dryRun) {
      estimated += cost
      // Claimed within this run too, so a dry run's plan matches what a real
      // run would import rather than listing three variants of one bet.
      openClaims.add(key)
      report.planned.push(item)
      continue
    }

    if (balance !== null && balance < spent + cost) {
      report.stoppedBecause = `Mirror wallet is out of TRUST (${formatEther(balance)} left).`
      break
    }

    try {
      const result = await submitPredictionOnChain({
        publicClient,
        walletClient: walletClient!,
        chainId: intuition.id,
        subjectLabel: labels.subject,
        claimLabel: labels.claim,
        conditionLabel: labels.condition,
        ...reuse,
      })

      // Remember what this mint produced so later markets in the same run reuse
      // these Atoms instead of paying to duplicate them.
      mintedThisRun.set(labels.subject.trim().toLowerCase(), result.subjectAtomId)
      mintedThisRun.set(labels.claim.trim().toLowerCase(), result.predicateAtomId)
      mintedThisRun.set(labels.condition.trim().toLowerCase(), result.objectAtomId)
      // This claim is now open in Somoco — later drafts in the same run that
      // make it again are date-ladder variants, not new bets.
      openClaims.add(key)

      const db = supabaseAdmin()
      const { error } = await db.from('predictions').insert([
        {
          triple_id: result.tripleId,
          creator_address: account!.address.toLowerCase(),
          subject: labels.subject,
          claim: labels.claim,
          condition: labels.condition,
          category: draft.category,
          resolution_date: draft.resolutionDate,
          resolution_plan: draft.resolutionPlan,
          approval_status: autoApprove ? 'approved' : 'pending',
        },
      ])

      // The Triple is already on-chain and paid for at this point. A failed
      // insert must NOT read as a failed import, or the next run would mint the
      // same market again — so it's recorded as imported, with the error noted.
      if (error) item.error = `On-chain OK but DB insert failed: ${error.message}`

      item.tripleId = result.tripleId
      item.txHash = result.txHash
      spent += cost
      report.imported.push(item)
    } catch (err) {
      item.error = err instanceof Error ? err.message : 'Unknown error'
      report.failed.push(item)
      // One bad market shouldn't abort the run, but a repeated failure usually
      // means the wallet or the RPC is unhealthy — stop after three.
      if (report.failed.length >= 3) {
        report.stoppedBecause = 'Three markets failed in a row — stopping.'
        break
      }
    }
  }

  report.estimatedCostTrust = formatEther(estimated)
  report.spentTrust = formatEther(spent)
  return report
}
