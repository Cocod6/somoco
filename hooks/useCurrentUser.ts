'use client'

// Somoco — current-user hook
// Runs the first-connection handler (lib/users.ts → ensureUser) whenever a
// wallet connects, then exposes that wallet's trust score and whether it clears
// the minimum needed to submit predictions (curated creator gating).
//
// The threshold lives in NEXT_PUBLIC_MIN_TRUST_SCORE (default 15). Set it to 0
// to open submission to everyone.

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { ensureUser } from '@/lib/users'
import type { UserRecord } from '@/lib/supabase'

const MIN_TRUST_SCORE = Number(process.env.NEXT_PUBLIC_MIN_TRUST_SCORE ?? '15')

export interface CurrentUser {
  /** The connected wallet's Somoco record, once loaded */
  user: UserRecord | null
  loading: boolean
  trustScore: number
  /** True once the score is known AND it clears the submit threshold */
  isEligible: boolean
  minTrustScore: number
}

export function useCurrentUser(): CurrentUser {
  const { address, isConnected } = useAccount()

  // Keyed by the wallet it was loaded for, so a record from a previous
  // address is never exposed while the next one is still loading.
  const [loaded, setLoaded] = useState<{ address: string; record: UserRecord } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!isConnected || !address) return
      setLoading(true)
      try {
        // null = score unknown (server unreachable); leave `loaded` alone so the
        // hook reports "not loaded" rather than gating on a score we don't have.
        const record = await ensureUser(address)
        if (!cancelled && record) setLoaded({ address, record })
      } catch (err) {
        console.warn('useCurrentUser: could not load user:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [address, isConnected])

  const user =
    isConnected && address && loaded?.address === address ? loaded.record : null
  const trustScore = user?.trust_score ?? 0

  return {
    user,
    loading,
    trustScore,
    isEligible: !!user && trustScore >= MIN_TRUST_SCORE,
    minTrustScore: MIN_TRUST_SCORE,
  }
}
