import type { PrivyClientConfig } from '@privy-io/react-auth'
import { intuition } from './wagmi'

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

// Privy client config. Matches Somoco's dark UI (lime accent #c8f135) and pins
// Intuition mainnet as the only chain. Users who log in with email/social get an
// embedded wallet so they can still transact on-chain.
export const privyConfig: PrivyClientConfig = {
  defaultChain: intuition,
  supportedChains: [intuition],
  // NOTE: every method here must also be enabled in the Privy dashboard
  // (Login Methods), or Privy throws "Login with <method> not allowed".
  // 'google' requires enabling Google OAuth in the dashboard first — add it
  // back here once that's done.
  loginMethods: ['wallet', 'email'],
  appearance: {
    theme: 'dark',
    accentColor: '#c8f135',
    walletChainType: 'ethereum-only',
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
}
