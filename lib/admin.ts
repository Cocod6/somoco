// Somoco — admin access control
// Approve and Resolve are privileged views: they gate what the whole app shows
// and they spend real $TRUST writing resolution Triples on-chain. Only wallets
// on an explicit allowlist may reach them.
//
// The allowlist lives in NEXT_PUBLIC_ADMIN_ADDRESSES as a comma-separated list
// of wallet addresses, e.g.
//   NEXT_PUBLIC_ADMIN_ADDRESSES=0x45E4...D64b,0xabc...123
// Addresses are compared case-insensitively. If the env var is empty, NOBODY
// is an admin — the admin pages stay locked rather than falling open.

'use client'

import { useAccount } from 'wagmi'

/** Parses the env allowlist into a lowercased Set for O(1) membership checks. */
function getAdminAddresses(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? ''
  return new Set(
    raw
      .split(',')
      .map(a => a.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** True if the given address is on the admin allowlist. */
export function isAdmin(address?: string | null): boolean {
  if (!address) return false
  return getAdminAddresses().has(address.toLowerCase())
}

/** React hook: is the currently connected wallet an admin? */
export function useIsAdmin(): boolean {
  const { address } = useAccount()
  return isAdmin(address)
}
