// Somoco — Phase 1.5: real on-chain submission
// This actually writes Atoms + a Triple to Intuition mainnet (chain 1155).
// Verified against official docs: docs.intuition.systems/docs/intuition-smart-contracts/deployments
//
// IMPORTANT: Atom IDs and Triple IDs on Intuition are "bytes32" values —
// a fixed 32-byte hex string like "0x1a2b3c...". They are NOT plain numbers.
// Treating them as numbers (bigint) was the bug that caused submission to fail.
//
// How a prediction becomes a Triple:
//   subject   → e.g. "Bitcoin"           (reused if it already exists)
//   predicate → e.g. "reaches"           (reused if it already exists)
//   object    → e.g. "$150K before Dec"  (reused if it already exists)
// Every Atom and every Triple costs a small TRUST fee to create — this code
// asks the contract for the live cost rather than guessing a number.
// Only the parts that DON'T already exist on Intuition get created fresh.

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

export interface SubmitPredictionParams {
  publicClient: PublicClient
  walletClient: WalletClient
  chainId: number
  /** If the subject already exists on Intuition, pass its bytes32 ID here to reuse it */
  existingSubjectAtomId: Hex | null
  subjectLabel: string
  /** If the claim/predicate already exists on Intuition, pass its bytes32 ID here to reuse it */
  existingPredicateAtomId: Hex | null
  claimLabel: string // becomes the predicate
  /** If the condition/object already exists on Intuition, pass its bytes32 ID here to reuse it */
  existingObjectAtomId: Hex | null
  conditionLabel: string // becomes the object
}

export interface SubmitPredictionResult {
  /** The transaction hash for the Triple creation — link to this on the explorer */
  txHash: string
  tripleId: Hex
  subjectAtomId: Hex
  predicateAtomId: Hex
  objectAtomId: Hex
}

/**
 * Creates whatever Atoms are missing (reusing matched ones), then creates
 * the Triple linking them. Returns the on-chain bytes32 IDs + tx hash.
 */
export async function submitPredictionOnChain(
  params: SubmitPredictionParams
): Promise<SubmitPredictionResult> {
  const {
    publicClient,
    walletClient,
    chainId,
    existingSubjectAtomId,
    subjectLabel,
    existingPredicateAtomId,
    claimLabel,
    existingObjectAtomId,
    conditionLabel,
  } = params

  const address = getMultiVaultAddressFromChainId(chainId)

  // --- Step 1: create whatever Atoms don't already exist ---
  const atomCost = await multiVaultGetAtomCost({ address, publicClient })

  // Each slot is either "reuse this existing bytes32 ID" or "needs creating"
  const slots: Array<{ kind: 'subject' | 'predicate' | 'object'; existingId: Hex | null; label: string }> = [
    { kind: 'subject', existingId: existingSubjectAtomId, label: subjectLabel },
    { kind: 'predicate', existingId: existingPredicateAtomId, label: claimLabel },
    { kind: 'object', existingId: existingObjectAtomId, label: conditionLabel },
  ]

  const slotsNeedingCreation = slots.filter(s => s.existingId === null)
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
    // termId comes back from the contract as a bytes32 hex string already —
    // no conversion needed, just use it as-is
    newAtomIds = atomEvents.map(e => e.args.termId as Hex)
  }

  // Map each slot to its final bytes32 ID — either reused or newly created
  let cursor = 0
  const resolvedIds: Hex[] = slots.map(s =>
    s.existingId !== null ? s.existingId : newAtomIds[cursor++]
  )
  const [subjectAtomId, predicateAtomId, objectAtomId] = resolvedIds

  // --- Step 2: create the Triple linking subject → predicate → object ---
  const tripleCost = await multiVaultGetTripleCost({ address, publicClient })

  const tripleTxHash = await multiVaultCreateTriples(
    { address, walletClient, publicClient },
    {
      args: [[subjectAtomId], [predicateAtomId], [objectAtomId], [tripleCost]],
      value: tripleCost,
    }
  )

  const tripleEvents = await eventParseTripleCreated(publicClient, tripleTxHash)
  const tripleId = tripleEvents[0]?.args.termId as Hex | undefined

  if (!tripleId) {
    throw new Error(
      `Triple was created on-chain (tx: ${tripleTxHash}) but its ID could not be read back.`
    )
  }

  return {
    txHash: tripleTxHash,
    tripleId,
    subjectAtomId,
    predicateAtomId,
    objectAtomId,
  }
}
