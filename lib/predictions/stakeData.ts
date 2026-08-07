// Somoco — on-chain stake / conviction data for a prediction Triple
//
// On Intuition, conviction in a Triple is expressed as $TRUST staked FOR it
// (the Triple's own term) versus AGAINST it (its counter-term). We read those
// from the public Intuition graph so the feed can show a real conviction bar
// instead of invented numbers.
//
// IMPORTANT: the exact vault/term field names on the public graph have shifted
// across Intuition releases, so this is deliberately BEST-EFFORT. Any schema
// mismatch is logged (look for "getTripleStake GraphQL error" in the console)
// and the function returns null — the feed then simply omits the stake bar for
// that card rather than breaking. Fix the query here if every card is blank.

const GRAPHQL_URL = 'https://mainnet.intuition.sh/v1/graphql'

/** 18-decimal on-chain integer string → human $TRUST number. */
function toTrust(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0
  try {
    // Use BigInt for the integer part to avoid precision loss on large values,
    // then fall back to Number for the fractional display scale.
    return Number(BigInt(String(raw))) / 1e18
  } catch {
    const n = Number(raw)
    return Number.isFinite(n) ? n / 1e18 : 0
  }
}

export interface TripleStake {
  /** $TRUST staked in favour of the prediction */
  forTrust: number
  /** $TRUST staked against the prediction (its counter-term) */
  againstTrust: number
  /** Total staked either way */
  totalTrust: number
  /** 0–100: share of stake that is FOR the prediction */
  convictionPct: number
  /** number of distinct predictors backing the FOR side */
  forPositions: number
  /** number of distinct predictors backing the AGAINST side */
  againstPositions: number
  /** total distinct predictors on either side */
  totalPositions: number
}

/**
 * Fetches the for/against stake for a single prediction Triple by its bytes32
 * term_id. Returns null if the data is unavailable (schema mismatch, network
 * error, or the Triple simply has no positions yet).
 */
export async function getTripleStake(tripleId: string): Promise<TripleStake | null> {
  const id = tripleId?.trim()
  if (!id) return null

  const query = `
    query TripleStake($id: String!) {
      triple(term_id: $id) {
        term_id
        term { total_assets positions_aggregate { aggregate { count } } }
        counter_term { total_assets positions_aggregate { aggregate { count } } }
      }
    }
  `

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { id } }),
    })

    if (!res.ok) {
      console.warn(`getTripleStake GraphQL error: HTTP ${res.status}`)
      return null
    }

    const json = await res.json()
    if (json?.errors) {
      console.warn('getTripleStake GraphQL error:', json.errors)
      return null
    }

    const triple = json?.data?.triple
    if (!triple) return null

    const forTrust = toTrust(triple.term?.total_assets)
    const againstTrust = toTrust(triple.counter_term?.total_assets)
    const totalTrust = forTrust + againstTrust
    const forPositions = Number(triple.term?.positions_aggregate?.aggregate?.count ?? 0)
    const againstPositions = Number(triple.counter_term?.positions_aggregate?.aggregate?.count ?? 0)

    return {
      forTrust,
      againstTrust,
      totalTrust,
      convictionPct: totalTrust > 0 ? Math.round((forTrust / totalTrust) * 100) : 0,
      forPositions,
      againstPositions,
      totalPositions: forPositions + againstPositions,
    }
  } catch (err) {
    console.warn('getTripleStake GraphQL error:', err)
    return null
  }
}

/**
 * Fetches stake for many Triples at once, keyed by term_id. Missing/failed
 * lookups are simply absent from the map. Runs the per-Triple queries in
 * parallel — fine for the handful of cards a feed shows at a time.
 */
export async function getStakeForTriples(
  tripleIds: string[]
): Promise<Record<string, TripleStake>> {
  const unique = Array.from(new Set(tripleIds.filter(Boolean)))
  const results = await Promise.all(
    unique.map(async id => [id, await getTripleStake(id)] as const)
  )
  const map: Record<string, TripleStake> = {}
  for (const [id, stake] of results) {
    if (stake) map[id] = stake
  }
  return map
}
