// Somoco — Phase 3.5: real on-chain resolution
// When you mark a prediction true/false, this writes TWO new Triples to
// Intuition mainnet:
//   1. [prediction] [resolved] [true/false]                — the outcome
//   2. [creator]    [correctly/incorrectly predicted] [prediction] — reputation
// Both Triples use the ORIGINAL prediction's Triple ID as one of their
// subject/object slots — on Intuition, a Triple has its own bytes32 ID just
// like an Atom does, so it can be referenced inside another Triple.

import {
  getMultiVaultAddressFromChainId,
  multiVaultGetAtomCost,
  multiVaultCreateAtoms,
  multiVaultGetTripleCost,
  multiVaultCreateTriples,
  multiVaultIsTermCreated,
  eventParseAtomCreated,
  eventParseTripleCreated,
  MultiVaultAbi,
} from '@0xintuition/protocol'
import { toHex } from 'viem'
import type { PublicClient, WalletClient, Hex, Address } from 'viem'

export interface ResolvePredictionParams {
  publicClient: PublicClient
  walletClient: WalletClient
  chainId: number
  /** The bytes32 Triple ID of the original prediction being resolved */
  predictionTripleId: Hex
  /** The wallet address of the person who created the original prediction */
  creatorAddress: string
  outcome: 'true' | 'false'
  /**
   * Write the reputation Triple as well. Default true.
   *
   * Set false for predictions nobody actually predicted — a market mirrored in
   * from Polymarket is created by Somoco's own import wallet, and minting
   * "0x592d… correctly predicted X" would credit a wallet that made no call.
   * The outcome Triple is still worth writing; the reputation one is not.
   */
  includeReputation?: boolean
}

export interface ResolvePredictionResult {
  txHash: string
  resolutionTripleId: Hex
  /** Null when includeReputation was false. */
  reputationTripleId: Hex | null
}

// Resolution atoms ("resolved", "true"/"false", the creator's address, and
// "correctly/incorrectly predicted") are Somoco's own vocabulary — always
// created with data = toHex(label). So we can find them by a DIRECT contract
// read: compute the deterministic atom id from the label and ask the chain
// whether that term already exists.
//
// This deliberately avoids the GraphQL indexer here. The indexer lags a few
// seconds behind the chain, and when resolving several predictions in quick
// succession that lag made a just-created shared atom look missing — so the old
// code tried to create it again and the transaction reverted with "atom already
// exists". A direct read is always current.
async function findAtomIdOnChain(
  label: string,
  address: Address,
  publicClient: PublicClient
): Promise<Hex | null> {
  const data = toHex(label)
  const atomId = (await publicClient.readContract({
    address,
    abi: MultiVaultAbi,
    functionName: 'calculateAtomId',
    args: [data],
  })) as Hex
  const exists = await multiVaultIsTermCreated({ address, publicClient }, { args: [atomId] })
  return exists ? atomId : null
}

export async function resolvePredictionOnChain(
  params: ResolvePredictionParams
): Promise<ResolvePredictionResult> {
  const { publicClient, walletClient, chainId, predictionTripleId, creatorAddress, outcome } = params
  const includeReputation = params.includeReputation !== false

  const address = getMultiVaultAddressFromChainId(chainId)

  // The 4 Atoms we might need: "resolved", "true"/"false", the creator's
  // identity, and "correctly predicted"/"incorrectly predicted". The last two
  // are only needed for the reputation Triple.
  const outcomeLabel = outcome // "true" or "false"
  const reputationLabel = outcome === 'true' ? 'correctly predicted' : 'incorrectly predicted'

  const slots = [
    { key: 'resolvedPredicate', label: 'resolved' },
    { key: 'outcomeObject', label: outcomeLabel },
    ...(includeReputation
      ? ([
          { key: 'creatorIdentity', label: creatorAddress },
          { key: 'reputationPredicate', label: reputationLabel },
        ] as const)
      : []),
  ] as const

  // Check which of these already exist on Intuition — reuse, don't duplicate.
  // Direct contract reads (not GraphQL) so quick successive resolutions can't
  // trip over indexer lag. See findAtomIdOnChain above.
  const existingIds = await Promise.all(
    slots.map(s => findAtomIdOnChain(s.label, address, publicClient))
  )

  const atomCost = await multiVaultGetAtomCost({ address, publicClient })
  const slotsNeedingCreation = slots.filter((_, i) => existingIds[i] === null)
  const urisToCreate = slotsNeedingCreation.map(s => toHex(s.label))
  const depositsToCreate = slotsNeedingCreation.map(() => atomCost)

  let newAtomIds: Hex[] = []
  if (urisToCreate.length > 0) {
    const totalAtomValue = depositsToCreate.reduce((a, b) => a + b, 0n)
    const atomsTxHash = await multiVaultCreateAtoms(
      { address, walletClient, publicClient },
      { args: [urisToCreate, depositsToCreate], value: totalAtomValue }
    )
    const atomEvents = await eventParseAtomCreated(publicClient, atomsTxHash)
    newAtomIds = atomEvents.map(e => e.args.termId as Hex)
  }

  let cursor = 0
  const resolvedIds = existingIds.map(id => (id !== null ? id : newAtomIds[cursor++]))
  const [resolvedPredicateId, outcomeObjectId, creatorIdentityId, reputationPredicateId] = resolvedIds

  // Now create the Triples in a single batched transaction
  const tripleCost = await multiVaultGetTripleCost({ address, publicClient })

  // subjects / predicates / objects, positionally aligned:
  //   [prediction] [resolved]                  [true/false]
  //   [creator]    [correctly/…ly predicted]   [prediction]   ← reputation only
  const subjects: Hex[] = [predictionTripleId]
  const predicates: Hex[] = [resolvedPredicateId]
  const objects: Hex[] = [outcomeObjectId]
  if (includeReputation) {
    subjects.push(creatorIdentityId)
    predicates.push(reputationPredicateId)
    objects.push(predictionTripleId)
  }
  const deposits = subjects.map(() => tripleCost)

  const tripleTxHash = await multiVaultCreateTriples(
    { address, walletClient, publicClient },
    {
      args: [subjects, predicates, objects, deposits],
      value: tripleCost * BigInt(subjects.length),
    }
  )

  const tripleEvents = await eventParseTripleCreated(publicClient, tripleTxHash)
  if (tripleEvents.length < subjects.length) {
    // The Triples are already written on-chain; we just couldn't read the ids
    // back. Surface it rather than returning an undefined id downstream.
    throw new Error(
      `Resolution Triples were created (tx: ${tripleTxHash}) but only ${tripleEvents.length} of ${subjects.length} ids could be read back.`
    )
  }
  const resolutionTripleId = tripleEvents[0].args.termId as Hex
  const reputationTripleId = includeReputation ? (tripleEvents[1].args.termId as Hex) : null

  return { txHash: tripleTxHash, resolutionTripleId, reputationTripleId }
}
