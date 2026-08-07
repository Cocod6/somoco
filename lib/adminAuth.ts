// Somoco — SERVER-SIDE admin verification
//
// lib/admin.ts is the CLIENT-side allowlist check. It decides what UI to render
// and nothing more — anyone can edit their own browser state, so it proves
// nothing to the server. This module is the real gate.
//
// How it works: before a privileged action, the admin's wallet signs a short
// message describing exactly what they're authorising. The server recovers the
// signing address from that signature and checks it against the allowlist. You
// cannot forge this without the admin's private key.
//
// The message embeds the action, the target row id, and a timestamp, so a
// captured signature can't be replayed against a different row or used later.

import 'server-only'
import { verifyMessage } from 'viem'

/** How long a signed admin action stays valid. Keeps replays to a short window. */
const MAX_AGE_MS = 5 * 60 * 1000

/**
 * The exact message an admin signs. Client and server must build this
 * identically — see buildAdminMessage in lib/adminSign.ts for the client half.
 */
export function adminMessage(action: string, targetId: string, issuedAt: number): string {
  return [
    'Somoco admin action',
    `action: ${action}`,
    `target: ${targetId}`,
    `issued: ${issuedAt}`,
  ].join('\n')
}

/** Parses the env allowlist into a lowercased Set. Empty env = nobody is admin. */
function adminAddresses(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? ''
  return new Set(
    raw
      .split(',')
      .map(a => a.trim().toLowerCase())
      .filter(Boolean)
  )
}

export interface AdminAuth {
  address: string
  signature: string
  issuedAt: number
}

/**
 * Verifies a signed admin action. Returns null if it checks out, or a
 * human-readable reason to reject.
 */
export async function verifyAdmin(
  auth: Partial<AdminAuth> | undefined,
  action: string,
  targetId: string
): Promise<string | null> {
  const { address, signature, issuedAt } = auth ?? {}

  if (!address || !signature || typeof issuedAt !== 'number') {
    return 'Missing admin signature.'
  }

  // Check the allowlist BEFORE spending work on signature recovery.
  if (!adminAddresses().has(address.toLowerCase())) {
    return 'Not an admin address.'
  }

  const age = Date.now() - issuedAt
  // Allow a little negative drift for clock skew between browser and server.
  if (age > MAX_AGE_MS || age < -60_000) {
    return 'Admin signature expired — please try again.'
  }

  let valid = false
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: adminMessage(action, targetId, issuedAt),
      signature: signature as `0x${string}`,
    })
  } catch {
    return 'Malformed admin signature.'
  }

  return valid ? null : 'Admin signature does not match.'
}
