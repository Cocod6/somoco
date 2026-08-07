'use client'

// Client-side providers (Privy auth → react-query → wagmi). Kept out of
// layout.tsx so the root layout stays a Server Component and can export
// metadata — providers only need to wrap {children}.

import { useState } from 'react'
import { WagmiProvider } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrivyProvider } from '@privy-io/react-auth'
import { config } from '../lib/wagmi'
import { privyConfig, PRIVY_APP_ID } from '../lib/privy'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
