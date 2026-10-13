// Somoco — proof that a submitted prediction is real and is the submitter's
//
// /api/predictions takes triple_id and creator_address from the browser, and
// nothing about that request proves either one. Before auto-approval that was
// fine: the worst a forged request could do was park a *pending* row in front
// of the Approve queue. Since auto-approval, a forged row that passes the
// screens goes straight onto the public feed — under any wallet's name, for a
// Triple that may not exist.
//
// The browser already holds the proof: the hash of the transaction that
// created the Triple. MultiVault emits TripleCreated(creator, termId, ...) in
// that transaction, so reading the receipt answers both questions at once —
// the Triple exists, and THIS wallet created it — straight from the chain.
//
// Deliberately not the GraphQL indexer: auto-approval runs seconds after the
// transaction confirms, and the indexer can lag that. The receipt is available
// the moment the browser stops waiting for it.
//
// This does NOT bring back the trust-score gate. Embedded Privy wallets are
// still exempt from the score; this only checks that a wallet is claiming its
// own prediction, which every wallet type can prove.
//
// FAILS CLOSED, like the AI screen: no hash, an unreadable receipt, or any
// mismatch means `verified: false`, and the row waits for a human.

import 'server-only'
import { createPublicClient, http, parseEventLogs, isHash, type Hex, type TransactionReceipt } from 'viem'
import { MultiVaultAbi, getMultiVaultAddressFromChainId } from '@0xintuition/protocol'
import { intuition, INTUITION_RPC_URL } from '@/lib/chain'

const publicClient = createPublicClient({
  chain: intuition,
  transport: http(INTUITION_RPC_URL),
})

const MULTIVAULT = getMultiVaultAddressFromChainId(intuition.id).toLowerCase()

export type CreatorCheck = { verified: true } | { verified: false; reason: string }

/**
 * Receipts by tx hash, for one request. A cart submit puts every prediction in
 * the same transaction, so a batch of ten reads the chain once, not ten times.
 */
export type ReceiptCache = Map<string, Promise<TransactionReceipt | null>>

function loadReceipt(hash: Hex, cache: ReceiptCache): Promise<TransactionReceipt | null> {
  const key = hash.toLowerCase()
  let pending = cache.get(key)
  if (!pending) {
    pending = publicClient.getTransactionReceipt({ hash }).catch(() => null)
    cache.set(key, pending)
  }
  return pending
}

/**
 * Checks that `txHash` is a successful MultiVault transaction that created
 * `tripleId` from `creatorAddress`.
 */
export async function verifyTripleCreator(
  tripleId: string,
  creatorAddress: string,
  txHash: unknown,
  cache: ReceiptCache
): Promise<CreatorCheck> {
  if (typeof txHash !== 'string' || !isHash(txHash)) {
    return { verified: false, reason: 'No creation transaction was supplied, so the creator could not be checked.' }
  }

  const receipt = await loadReceipt(txHash, cache)
  if (!receipt) {
    return { verified: false, reason: 'The creation transaction could not be read from Intuition.' }
  }
  if (receipt.status !== 'success') {
    return { verified: false, reason: 'The creation transaction failed on-chain.' }
  }

  // Only MultiVault's own logs count — any contract can emit an event that
  // happens to be shaped like TripleCreated.
  const created = parseEventLogs({
    abi: MultiVaultAbi,
    eventName: 'TripleCreated',
    logs: receipt.logs.filter(log => log.address.toLowerCase() === MULTIVAULT),
  })

  const match = created.find(e => String(e.args.termId).toLowerCase() === tripleId.toLowerCase())
  if (!match) {
    return { verified: false, reason: 'That transaction did not create this Triple.' }
  }
  if (String(match.args.creator).toLowerCase() !== creatorAddress.toLowerCase()) {
    return { verified: false, reason: 'This Triple was created by a different wallet than the one named as its creator.' }
  }

  return { verified: true }
}
