// Somoco — user records + first-connection handler
//
// The first time a wallet connects, we compute its trust score and upsert a row
// into Somoco's `users` table. On later connections we refresh it at most once a
// day so the score stays current without hammering the RPC.
//
// The score is computed and written by the SERVER (app/api/users/ensure) using
// the service-role key. It deliberately does NOT happen here: if the browser
// could write its own trust_score, the submission gate would be meaningless.
// Freshness/caching logic lives in that route too, so there's one owner of it.
//
// This is Somoco's own bookkeeping, separate from Intuition.

import { supabase, type UserRecord } from './supabase'

/** Fetch a user's cached record, or null if they've never connected. */
export async function getUser(address: string): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('address', address.toLowerCase())
    .maybeSingle()

  if (error) {
    console.warn('getUser error:', error.message)
    return null
  }
  return (data as UserRecord) ?? null
}

/**
 * Ensures a user row exists for this wallet, computing/refreshing its trust
 * score as needed. Returns the up-to-date record, or null if the call failed.
 *
 * Null means "score unknown", which useCurrentUser treats as not-yet-loaded and
 * so does NOT gate submission — a bookkeeping outage should never lock users
 * out. We return null rather than a fabricated record precisely because a score
 * this client made up must never be mistaken for one the server issued.
 */
export async function ensureUser(address: string): Promise<UserRecord | null> {
  const key = address.toLowerCase()

  try {
    const res = await fetch('/api/users/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: key }),
    })

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(error ?? 'ensure failed')
    }

    return (await res.json()) as UserRecord
  } catch (err) {
    console.warn('ensureUser failed:', err instanceof Error ? err.message : err)
    return null
  }
}
