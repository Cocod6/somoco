// Somoco — Intuition chain definition
//
// Kept in its own module (rather than living in lib/wagmi.ts) so SERVER code can
// import the chain without dragging in @privy-io/wagmi, which is client-only.
// The trust-score API route needs an RPC connection on the server; importing
// lib/wagmi.ts there would pull Privy's React bundle into the server build.

import { defineChain } from 'viem'

export const INTUITION_RPC_URL = 'https://rpc.intuition.systems'

export const intuition = defineChain({
  id: 1155,
  name: 'Intuition',
  nativeCurrency: {
    name: 'TRUST',
    symbol: 'TRUST',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [INTUITION_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Intuition Explorer', url: 'https://explorer.intuition.systems' },
  },
})
