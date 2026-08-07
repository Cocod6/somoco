'use client'

// Somoco — client half of the admin signature flow.
//
// Pairs with lib/adminAuth.ts on the server. The message built here MUST match
// adminMessage() there byte for byte, or verification fails.
//
// UX note: this prompts the admin's wallet to sign once per privileged action
// (each approve, each reject, each resolution). That signature is the proof the
// server checks — it's what stops someone with the public anon key from
// approving their own predictions.

import type { WalletClient } from 'viem'
import type { AdminAuth } from './adminAuth'

/** Must stay identical to adminMessage() in lib/adminAuth.ts. */
function buildAdminMessage(action: string, targetId: string, issuedAt: number): string {
  return [
    'Somoco admin action',
    `action: ${action}`,
    `target: ${targetId}`,
    `issued: ${issuedAt}`,
  ].join('\n')
}

/**
 * Asks the connected admin wallet to sign off on one action.
 * Returns the auth blob to send in the request body.
 */
export async function signAdminAction(
  walletClient: WalletClient,
  address: string,
  action: string,
  targetId: string
): Promise<AdminAuth> {
  const issuedAt = Date.now()
  const signature = await walletClient.signMessage({
    account: address as `0x${string}`,
    message: buildAdminMessage(action, targetId, issuedAt),
  })
  return { address, signature, issuedAt }
}
