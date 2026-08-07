import { createConfig } from '@privy-io/wagmi'
import { http } from 'viem'
import { intuition, INTUITION_RPC_URL } from './chain'

// The chain itself now lives in lib/chain.ts so server code can import it
// without pulling Privy in. Re-exported here so existing imports keep working.
export { intuition }

// wagmi config is now built by @privy-io/wagmi (not RainbowKit's getDefaultConfig).
// Privy owns the connect flow; wagmi still backs all the useAccount/useWalletClient/
// usePublicClient hooks the app already uses, so nothing downstream changes.
export const config = createConfig({
  chains: [intuition],
  transports: {
    [intuition.id]: http(INTUITION_RPC_URL),
  },
})
