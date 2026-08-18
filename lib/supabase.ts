// Somoco — private database connection
// This is SEPARATE from Intuition. Intuition holds the real, permanent,
// public prediction data (the Triple itself). This database is Somoco's
// own private bookkeeping: which predictions came through OUR app, whether
// they're approved, and whether they've been resolved yet. Nobody outside
// Somoco's own submission flow can write into this list.

import { createClient } from '@supabase/supabase-js'
import type { ResolutionPlan } from './predictions/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * How a prediction ended.
 *
 * 'voided' is not a third outcome — it is the ABSENCE of one. The question
 * collapsed (the match was cancelled, the pair delisted, the metric never
 * defined) so nobody was right, the contract refunds every stake fee-free,
 * and it must never count for or against anyone's record.
 */
export type ResolutionStatus = 'unresolved' | 'resolved_true' | 'resolved_false' | 'voided'

export interface PredictionRecord {
  id: string
  triple_id: string
  creator_address: string
  subject: string
  claim: string
  condition: string | null
  /** Feed category id (politics, crypto, football, …); null on rows predating the column */
  category: string | null
  /** How this prediction resolves (method/sources/criteria); null on rows predating the column */
  resolution_plan: ResolutionPlan | null
  /** Optional creator-attached image (public URL); null if none or column predates it */
  image_url: string | null
  /**
   * Friend market: kept out of the public feed, settled by the invited wallets
   * instead of by Somoco. Undefined on rows predating the column, which is why
   * every check is `=== true` rather than a truthiness test.
   */
  is_private?: boolean | null
  /** Wallets invited to bet and to vote on the outcome (the requested jury). */
  invited_wallets?: string[] | null
  /** Requested tiebreaker — rules if the group disagrees. Must not bet. */
  judge_wallet?: string | null
  /** How long the group gets to vote before the judge may step in. */
  vote_window_seconds?: number | null
  resolution_date: string | null
  approval_status: 'pending' | 'approved' | 'rejected'
  resolution_status: ResolutionStatus
  resolution_tx_hash: string | null
  /**
   * The resolution receipt. All four are null for anything resolved before
   * 2026-08-18 — an empty receipt is honest, a fabricated one is not.
   */
  resolution_source_url?: string | null
  /** Why, in the resolver's own words. The only free text a user ever sees here. */
  resolution_note?: string | null
  resolved_at?: string | null
  /**
   * The address the SERVER recovered from the admin signature, or
   * 'polymarket-settler' when the outcome was read mechanically from the
   * source. Never accepted from the client.
   */
  resolved_by?: string | null
  created_at: string
}

// One row per wallet that has connected to Somoco. The trust score is computed
// on first connection (see lib/trust.ts) and cached here; it gates who may
// submit predictions. Separate from Intuition — Somoco's own bookkeeping.
export interface UserRecord {
  /** lowercased wallet address (primary key) */
  address: string
  trust_score: number
  /** raw signals JSON, for display/debugging */
  trust_signals: Record<string, unknown> | null
  created_at: string
  updated_at: string
}
