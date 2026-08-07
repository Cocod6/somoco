// Somoco — prediction categories (Polymarket-style feed sections)
//
// Predictions have no stored category yet, so we DERIVE one from the text
// (subject + claim + condition) via keyword matching. This works on every
// existing prediction with no DB migration. When we later add a `category`
// column, populate it in the parser and prefer that over this derivation.

import type { PredictionRecord } from '@/lib/supabase'

export interface Category {
  id: string
  label: string
  icon: string
}

// 'all' is a virtual tab (no filtering). The rest are real, in display order.
export const CATEGORIES: Category[] = [
  { id: 'all', label: 'All', icon: '◎' },
  { id: 'politics', label: 'Politics', icon: '🏛' },
  { id: 'crypto', label: 'Crypto', icon: '₿' },
  { id: 'football', label: 'Football', icon: '⚽' },
  { id: 'sports', label: 'Sports', icon: '🏅' },
  { id: 'tech', label: 'Tech & AI', icon: '🤖' },
  { id: 'business', label: 'Business', icon: '📈' },
  { id: 'culture', label: 'Culture', icon: '🎬' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'other', label: 'Other', icon: '✦' },
]

// Keyword rules, checked in this order — FIRST match wins, so put the more
// specific buckets (football, crypto) before the broad ones (sports, business).
const RULES: { id: string; keywords: string[] }[] = [
  { id: 'football', keywords: [
    'football', 'soccer', 'premier league', 'la liga', 'serie a', 'bundesliga',
    'champions league', 'uefa', 'fifa', 'world cup', 'arsenal', 'chelsea',
    'liverpool', 'man city', 'manchester', 'real madrid', 'barcelona', 'psg',
    'messi', 'ronaldo', 'mbappe', 'haaland', 'ballon', 'epl',
  ] },
  { id: 'crypto', keywords: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'token',
    'coin', 'defi', 'nft', 'stablecoin', 'altcoin', 'blockchain', 'binance',
    'dogecoin', 'ripple', 'xrp', 'onchain', 'on-chain', 'trust', 'intuition',
  ] },
  { id: 'politics', keywords: [
    'election', 'president', 'senate', 'congress', 'parliament', 'vote', 'voting',
    'government', 'trump', 'biden', 'harris', 'minister', 'policy', 'campaign',
    'referendum', 'primary', 'governor', 'nominee', 'coup', 'sanction', 'tinubu',
    // Added for the Polymarket import: geopolitics is most of Polymarket's
    // volume, and without these every war/election market landed in 'other'.
    // Whole-word matching (see COMPILED_RULES) keeps these tight — 'war' does
    // not match "Warriors", 'primary' does not match "primarily".
    'presidential', 'presidency', 'nomination', 'prime minister', 'ceasefire',
    'war', 'invade', 'invasion', 'blockade', 'treaty', 'impeachment', 'sanctions',
    'ballot', 'incumbent', 'summit', 'diplomatic',
  ] },
  { id: 'sports', keywords: [
    'nba', 'nfl', 'mlb', 'nhl', 'basketball', 'baseball', 'tennis', 'cricket',
    'rugby', 'golf', 'boxing', 'ufc', 'mma', 'f1', 'formula 1', 'formula one',
    'grand prix', 'olympics', 'super bowl', 'wimbledon', 'lebron', 'championship',
  ] },
  { id: 'tech', keywords: [
    'ai', 'a.i.', 'openai', 'chatgpt', 'gpt', 'claude', 'anthropic', 'google',
    'apple', 'iphone', 'tesla', 'spacex', 'nvidia', 'chip', 'gpu', 'software',
    'app', 'startup', 'robot', 'agi', 'llm', 'meta', 'microsoft', 'amazon',
  ] },
  { id: 'business', keywords: [
    'stock', 'stocks', 'market', 'gdp', 'inflation', 'fed', 'interest rate',
    'recession', 'ipo', 'revenue', 'earnings', 'company', 'ceo', 'acquisition',
    'merger', 'economy', 'dollar', 'oil', 'gold', 'nasdaq', 's&p', 'valuation',
  ] },
  { id: 'culture', keywords: [
    'movie', 'film', 'oscar', 'grammy', 'emmy', 'album', 'netflix', 'box office',
    'celebrity', 'music', 'song', 'artist', 'award', 'spotify', 'taylor swift',
    'drake', 'show', 'series', 'streaming', 'concert', 'tour',
  ] },
  { id: 'science', keywords: [
    'nasa', 'climate', 'vaccine', 'space', 'mars', 'moon', 'rocket', 'discovery',
    'research', 'study', 'quantum', 'fusion', 'asteroid', 'temperature',
    'hurricane', 'earthquake', 'nobel', 'gene', 'covid', 'pandemic',
  ] },
]

// Real category ids (everything except the virtual 'all' tab) — handed to the
// LLM parser as its allowed set, and used to validate what it returns.
export const CATEGORY_IDS = CATEGORIES.filter(c => c.id !== 'all').map(c => c.id)

// One compiled whole-word regex per rule. Substring matching was wrong for
// short keywords — 'ai' matched inside "Naira", 'eth' inside "whether".
// Lookarounds instead of \b so keywords ending in punctuation ('a.i.', 's&p')
// still terminate correctly.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const COMPILED_RULES = RULES.map(rule => ({
  id: rule.id,
  re: new RegExp(`(?<!\\w)(?:${rule.keywords.map(escapeRegex).join('|')})(?!\\w)`, 'i'),
}))

/** Keyword-derive a category id from arbitrary text. Falls back to 'other'. */
export function categorizeText(text: string): string {
  for (const rule of COMPILED_RULES) {
    if (rule.re.test(text)) return rule.id
  }
  return 'other'
}

/** Derive a category id for a prediction from its parts. Falls back to 'other'. */
export function categorize(p: Pick<PredictionRecord, 'subject' | 'claim' | 'condition'>): string {
  return categorizeText(`${p.subject} ${p.claim} ${p.condition ?? ''}`)
}

/** Return `raw` if it's a known real category id, otherwise null. */
export function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const id = raw.trim().toLowerCase()
  return CATEGORY_IDS.includes(id) ? id : null
}
