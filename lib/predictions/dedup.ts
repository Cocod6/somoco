// Somoco — Phase 1: Atom dedup check
// Searches Intuition for existing Atoms before creating new ones.
// Uses the same GraphQL endpoint already in ExploreAtoms.tsx.
//
// IMPORTANT: this must be an EXACT match (case-insensitive), not "contains."
// Searching for "awesome" with a contains-match could wrongly match an
// unrelated Atom like a GitHub URL that happens to have "awesome" inside it
// somewhere — completely different meaning, but it would get reused as if
// it were the same thing. Exact match avoids that entirely.

import type { ExistingAtomMatch } from './types'

const GRAPHQL_URL = 'https://mainnet.intuition.sh/v1/graphql'

/**
 * Searches Intuition for an Atom whose label EXACTLY matches the given text
 * (case-insensitive). Returns up to 5 matches, though in practice there
 * should only ever be one true exact match.
 * Note: Intuition's schema uses "term_id" (not "id") as the Atom identifier.
 */
export async function findExistingAtoms(searchText: string): Promise<ExistingAtomMatch[]> {
  const trimmed = searchText.trim()
  if (!trimmed) return []

  // Escape ilike wildcards so a label containing % or _ (e.g. "drops 50%")
  // still means "equals", not "matches anything" — wildcard noise could
  // otherwise crowd the true exact match out of the 5-row limit.
  const pattern = trimmed.replace(/[\\%_]/g, '\\$&')

  const query = `
    query SearchAtoms($pattern: String!) {
      atoms(
        where: { label: { _ilike: $pattern } }
        limit: 5
        order_by: { created_at: desc }
      ) {
        term_id
        label
      }
    }
  `

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // No unescaped % wildcards — this means "equals" (case-insensitive), not "contains"
        query,
        variables: { pattern },
      }),
    })

    if (!res.ok) return []

    const json = await res.json()
    const atoms = json?.data?.atoms ?? []

    // Extra safety net: even though the query asks for an exact match,
    // double-check client-side before trusting any result as reusable.
    return atoms
      .filter((a: { label: string }) => a.label.toLowerCase() === trimmed.toLowerCase())
      .map((a: { term_id: string; label: string }) => ({
        atomId: String(a.term_id),
        label: a.label,
      }))
  } catch {
    // If search fails, return empty — user can still proceed
    return []
  }
}
