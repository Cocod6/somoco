// Somoco — wallet trust score
//
// Every wallet gets a 0–100 trust score the first time it connects. The score
// gates who can submit predictions (see curated creator gating in
// SubmitPrediction) and is shown on profiles/leaderboards later.
//
// v1 is deliberately built on signals we can read RELIABLY and permissionlessly
// from the chain itself — no third-party API keys required:
//   • activity   — transaction count (nonce). A wallet that has actually used
//                  the chain is more credible than a fresh burner.
//   • holdings   — native $TRUST balance. Skin in the game.
//   • protocol   — best-effort count of Atoms/Triples the wallet created on
//                  Intuition. Real protocol participation.
//
// Socials (Twitter/X followers, ENS, Farcaster) are intentionally NOT wired
// here — they need API keys and off-chain identity plumbing. `socialBoost` is
// left as a clearly-marked extension point: feed it a 0–20 value from a future
// socials service and it folds straight into the total.

import type { PublicClient } from 'viem'

const GRAPHQL_URL = 'https://mainnet.intuition.sh/v1/graphql'

export interface TrustBreakdown {
  /** 0–100 final score */
  score: number
  /** 0–45 from transaction count */
  activity: number
  /** 0–25 from native $TRUST balance */
  holdings: number
  /** 0–30 from Intuition protocol participation */
  protocol: number
  /** raw signals, handy for display/debugging */
  signals: {
    txCount: number
    balanceTrust: number
    atomsCreated: number
  }
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n))

/** Best-effort: how many Atoms this wallet has created on Intuition. */
async function countIntuitionAtoms(address: string): Promise<number> {
  const query = `
    query CreatedAtoms($creator: String!) {
      atoms_aggregate(where: { creator_id: { _eq: $creator } }) {
        aggregate { count }
      }
    }
  `
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { creator: address.toLowerCase() } }),
    })
    if (!res.ok) return 0
    const json = await res.json()
    if (json?.errors) {
      // Schema for creator filtering varies across Intuition releases — treat
      // as "no data" rather than failing the whole score.
      console.warn('trust: intuition atom count unavailable:', json.errors)
      return 0
    }
    return Number(json?.data?.atoms_aggregate?.aggregate?.count ?? 0)
  } catch (err) {
    console.warn('trust: intuition atom count error:', err)
    return 0
  }
}

/**
 * Computes a wallet's trust score from on-chain signals.
 * @param socialBoost optional 0–20 add-on from a future socials service
 */
export async function computeTrustScore(
  address: string,
  publicClient: PublicClient,
  socialBoost = 0
): Promise<TrustBreakdown> {
  // Reliable, always-available signals via the RPC.
  const [txCount, balanceWei] = await Promise.all([
    publicClient.getTransactionCount({ address: address as `0x${string}` }),
    publicClient.getBalance({ address: address as `0x${string}` }),
  ])
  const balanceTrust = Number(balanceWei) / 1e18

  // Best-effort protocol signal.
  const atomsCreated = await countIntuitionAtoms(address)

  // --- Scoring ---
  // Activity: 2 points per tx, capped at 45 (≈ 23 txs maxes it out).
  const activity = clamp(txCount * 2, 45)

  // Holdings: tiered so simply holding some $TRUST counts, with diminishing
  // returns — we don't want the score to just track whale balances.
  let holdings = 0
  if (balanceTrust >= 100) holdings = 25
  else if (balanceTrust >= 10) holdings = 18
  else if (balanceTrust >= 1) holdings = 12
  else if (balanceTrust > 0) holdings = 6

  // Protocol: 10 points per Atom created, capped at 30.
  const protocol = clamp(atomsCreated * 10, 30)

  const score = clamp(activity + holdings + protocol + clamp(socialBoost, 20), 100)

  return {
    score,
    activity,
    holdings,
    protocol,
    signals: { txCount, balanceTrust, atomsCreated },
  }
}
