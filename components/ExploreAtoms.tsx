'use client'

import { useState } from 'react'

const INTUITION_API = 'https://mainnet.intuition.sh/v1/graphql'

type AtomFilter = 'All' | 'Thing' | 'Account' | 'TextObject'

interface Atom {
  term_id: string
  label: string
  type: string
  image: string | null
  emoji: string | null
}

async function searchAtoms(query: string, filter: AtomFilter): Promise<Atom[]> {
  // User text goes in as a GraphQL variable, never spliced into the query
  // string — quotes or braces in the search box must not break the query.
  const whereClause = filter === 'All'
    ? `{ label: { _ilike: $pattern } }`
    : `{ label: { _ilike: $pattern }, type: { _eq: $type } }`

  const response = await fetch(INTUITION_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query SearchAtoms($pattern: String!${filter === 'All' ? '' : ', $type: String!'}) {
          atoms(
            where: ${whereClause}
            limit: 20
            order_by: { created_at: desc }
          ) {
            term_id
            label
            type
            image
            emoji
          }
        }
      `,
      variables: filter === 'All'
        ? { pattern: `%${query}%` }
        : { pattern: `%${query}%`, type: filter },
    })
  })

  const data = await response.json()

  if (data.errors) {
    console.error('GraphQL errors:', data.errors)
    return []
  }

  return data?.data?.atoms || []
}

const TYPE_ICONS: Record<string, string> = {
  Thing: '🧩',
  Account: '⛓️',
  TextObject: '📝',
}

const FILTER_LABELS: Record<AtomFilter, string> = {
  All: 'All',
  Thing: 'Things',
  Account: 'Accounts',
  TextObject: 'Text',
}

export default function ExploreAtoms() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AtomFilter>('All')
  const [results, setResults] = useState<Atom[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const handleSearch = async () => {
    if (!search.trim()) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const atoms = await searchAtoms(search, filter)
      setResults(atoms)
    } catch (e) {
      setError('Search failed. Check console for details.')
      console.error(e)
    }
    setLoading(false)
  }

  const getIcon = (atom: Atom) => {
    if (atom.emoji) return atom.emoji
    return TYPE_ICONS[atom.type] || '🔮'
  }

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        explore atoms
      </div>

      {/* Filters — scrollable on a phone rather than wrapping into a block */}
      <div style={{
        display: 'flex', gap: 8, marginTop: 20, marginBottom: 16,
        overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none',
      }}>
        {(['All', 'Thing', 'Account', 'TextObject'] as AtomFilter[]).map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`chip${filter === t ? ' active' : ''}`}
          >
            {FILTER_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search atoms..."
          style={{
            flex: 1, padding: '10px 16px', borderRadius: 10, fontSize: 14,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text)', fontFamily: 'var(--font-mono)', outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="btn btn-accent"
          style={{ padding: '10px 20px', fontSize: 14, borderRadius: 10 }}
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: '#ff44441a',
          borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.length === 0 && !loading && searched && !error && (
          <div style={{
            textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
            fontSize: 13, padding: 40,
          }}>
            no atoms found
          </div>
        )}
        {results.map(atom => (
          <div key={atom.term_id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            {atom.image && !atom.image.startsWith('ipfs://') ? (
              <img src={atom.image} alt={atom.label}
                style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: '#222', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 18,
              }}>
                {getIcon(atom)}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{atom.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {atom.type} · {atom.term_id.slice(0, 10)}...
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
