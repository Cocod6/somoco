// Somoco — batch on-chain submission (the "cart")
// Submits several predictions to Intuition in just TWO transactions total,
// instead of two per prediction: one multicall creates every Atom that doesn't
// already exist, and one multicall creates every Triple.
//
// Two layers of Atom reuse keep this cheap and clean:
//   1. Cross-graph reuse — if an Atom already exists on Intuition, its bytes32
//      id is passed in and no new Atom is created (same as single submit).
//   2. In-batch reuse — if two predictions in the same cart both mention
//      "Bitcoin", we create that Atom ONCE and point both Triples at it.
//
// Atom and Triple ids are bytes32 hex strings — never run them through BigInt.

import {
  getMultiVaultAddressFromChainId,
  multiVaultGetAtomCost,
  multiVaultCreateAtoms,
  multiVaultGetTripleCost,
  multiVaultCreateTriples,
  eventParseAtomCreated,
  eventParseTripleCreated,
} from '@0xintuition/protocol'
import { toHex } from 'viem'
import type { PublicClient, WalletClient, Hex } from 'viem'

/** One prediction queued in the cart, already parsed + dedup-checked. */
export interface BatchPredictionItem {
  existingSubjectAtomId: Hex | null
  subjectLabel: string
  existingPredicateAtomId: Hex | null
  claimLabel: string // becomes the predicate
  existingObjectAtomId: Hex | null
  conditionLabel: string // becomes the object
}

export interface BatchSubmitParams {
  publicClient: PublicClient
  walletClient: WalletClient
  chainId: number
  items: BatchPredictionItem[]
}

export interface BatchSubmitResult {
  txHash: string
  /** One entry per input item, in the same order */
  triples: Array<{
    tripleId: Hex
    subjectAtomId: Hex
    predicateAtomId: Hex
    objectAtomId: Hex
  }>
}

// Internal: a slot that still needs an Atom created for it.
interface PendingSlot {
  label: string
  existingId: Hex | null
}

/**
 * Creates all missing Atoms (once each), then all Triples, for a whole cart.
 * Returns the on-chain ids for every prediction in input order.
 */
export async function submitBatchOnChain(
  params: BatchSubmitParams
): Promise<BatchSubmitResult> {
  const { publicClient, walletClient, chainId, items } = params
  if (items.length === 0) {
    throw new Error('The cart is empty — add at least one prediction first.')
  }

  const address = getMultiVaultAddressFromChainId(chainId)

  // --- Step 1: figure out every distinct new Atom the whole cart needs ---
  // Key by "reuse this bytes32 id" or by lowercased label so identical labels
  // across predictions collapse to a single creation.
  const atomCost = await multiVaultGetAtomCost({ address, publicClient })

  // Maps a label (lowercased) -> index in the newAtomIds array we'll fill later.
  const labelToNewIndex = new Map<string, number>()
  const newAtomLabels: string[] = []

  /** Resolve a single slot to either its existing id or a placeholder index. */
  function planSlot(slot: PendingSlot): { existingId: Hex | null; newIndex: number } {
    if (slot.existingId) return { existingId: slot.existingId, newIndex: -1 }
    const key = slot.label.toLowerCase()
    let idx = labelToNewIndex.get(key)
    if (idx === undefined) {
      idx = newAtomLabels.length
      labelToNewIndex.set(key, idx)
      newAtomLabels.push(slot.label)
    }
    return { existingId: null, newIndex: idx }
  }

  // Plan all three slots for every item up front.
  const plannedItems = items.map(item => ({
    subject: planSlot({ label: item.subjectLabel, existingId: item.existingSubjectAtomId }),
    predicate: planSlot({ label: item.claimLabel, existingId: item.existingPredicateAtomId }),
    object: planSlot({ label: item.conditionLabel, existingId: item.existingObjectAtomId }),
  }))

  // --- Step 2: create every new Atom in one transaction ---
  let newAtomIds: Hex[] = []
  if (newAtomLabels.length > 0) {
    const uris = newAtomLabels.map(label => toHex(label))
    const deposits = newAtomLabels.map(() => atomCost)
    const totalValue = deposits.reduce((a, b) => a + b, 0n)

    const atomsTxHash = await multiVaultCreateAtoms(
      { address, walletClient, publicClient },
      { args: [uris, deposits], value: totalValue }
    )
    const atomEvents = await eventParseAtomCreated(publicClient, atomsTxHash)
    newAtomIds = atomEvents.map(e => e.args.termId as Hex)

    if (newAtomIds.length !== newAtomLabels.length) {
      throw new Error(
        `Expected ${newAtomLabels.length} new Atoms but the chain reported ${newAtomIds.length}.`
      )
    }
  }

  /** Turn a planned slot into its final bytes32 id. */
  const resolve = (slot: { existingId: Hex | null; newIndex: number }): Hex =>
    slot.existingId ?? newAtomIds[slot.newIndex]

  // --- Step 3: create every Triple in one transaction ---
  const tripleCost = await multiVaultGetTripleCost({ address, publicClient })

  const subjects = plannedItems.map(p => resolve(p.subject))
  const predicates = plannedItems.map(p => resolve(p.predicate))
  const objects = plannedItems.map(p => resolve(p.object))
  const costs = plannedItems.map(() => tripleCost)

  const tripleTxHash = await multiVaultCreateTriples(
    { address, walletClient, publicClient },
    {
      args: [subjects, predicates, objects, costs],
      value: tripleCost * BigInt(plannedItems.length),
    }
  )

  const tripleEvents = await eventParseTripleCreated(publicClient, tripleTxHash)
  if (tripleEvents.length !== plannedItems.length) {
    throw new Error(
      `Created ${plannedItems.length} Triples but only read back ${tripleEvents.length} ids (tx: ${tripleTxHash}).`
    )
  }

  const triples = plannedItems.map((p, i) => ({
    tripleId: tripleEvents[i].args.termId as Hex,
    subjectAtomId: subjects[i],
    predicateAtomId: predicates[i],
    objectAtomId: objects[i],
  }))

  return { txHash: tripleTxHash, triples }
}
