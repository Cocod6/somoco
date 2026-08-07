'use client'

import { useWallets } from '@privy-io/react-auth'

// True when the currently-active wallet is a Privy embedded wallet (minted for
// email/social logins) rather than an external wallet (MetaMask, Rabby, …).
// Embedded wallets start with zero on-chain history, so we exempt them from the
// trust-score gate — see SubmitPrediction.
export function useIsEmbeddedWallet(address?: string): boolean {
  const { wallets } = useWallets()
  if (!address) return false
  const active = wallets.find(
    (w) => w.address.toLowerCase() === address.toLowerCase()
  )
  if (!active) return false
  return active.connectorType === 'embedded' || active.walletClientType === 'privy'
}
