// Somoco — resolution rules & preset sources
// Modeled on how Polymarket/UMA actually resolve markets:
//   - Objective, machine-readable outcomes (crypto prices, sports scores)
//     → automated data feeds (Chainlink, official stats providers)
//   - Subjective / long-tail outcomes (elections, geopolitics, culture)
//     → human judgement against named authoritative sources
//
// The single biggest lesson from Polymarket: the RULES are the contract,
// the title is just a headline. Poorly written resolution criteria are the
// #1 cause of disputes. So every prediction should carry an explicit,
// readable resolution plan before it ever goes live.
//
// This file is the editable source of truth. Change providers here without
// touching any AI logic — the parser reads these as its guidance.

export type ResolutionMethod = 'automated_feed' | 'named_source' | 'human_review'

export interface CategoryResolutionRule {
  category: string
  method: ResolutionMethod
  /** The default data source(s) for this category */
  defaultSources: string[]
  /** Plain-english guidance the AI uses to write the resolution criteria */
  guidance: string
}

// Categories mirror the app's existing category list.
export const RESOLUTION_RULES: CategoryResolutionRule[] = [
  {
    category: 'Crypto',
    method: 'automated_feed',
    defaultSources: ['Chainlink Data Feeds', 'Pyth Network'],
    guidance:
      'Resolve against the reported price at the exact resolution timestamp from a decentralized price oracle. State the asset, the exact price threshold, and the timestamp. Example: "Resolves YES if BTC/USD on Chainlink is at or above $150,000 at 23:59 UTC on the resolution date."',
  },
  {
    category: 'Football',
    method: 'named_source',
    defaultSources: ['Opta / Stats Perform', 'official league result'],
    guidance:
      'Resolve against the official final result as reported by the league and verified by Opta/Stats Perform. State exactly what counts (e.g. full-time result, including or excluding extra time / penalties). Be explicit about postponed or abandoned matches.',
  },
  {
    category: 'Sports',
    method: 'named_source',
    defaultSources: ['official league/governing body result', 'Opta / Stats Perform'],
    guidance:
      'Resolve against the official final result from the relevant governing body. State the exact event, what counts as a win/completion, and how postponements or cancellations are handled.',
  },
  {
    category: 'Politics',
    method: 'human_review',
    defaultSources: ['Associated Press (AP)', 'Reuters', 'official electoral commission'],
    guidance:
      'Resolve against the official certified result from the relevant electoral authority, corroborated by AP and Reuters. State the exact office/measure, the date by which it must occur, and how a contested or delayed result is treated.',
  },
  {
    category: 'Business',
    method: 'named_source',
    defaultSources: ['official company filing (SEC/press release)', 'Reuters', 'Bloomberg'],
    guidance:
      'Resolve against an official company announcement, regulatory filing, or two independent major financial outlets. State the exact event and the reporting deadline.',
  },
  {
    category: 'Tech & AI',
    method: 'named_source',
    defaultSources: ['official company announcement', 'Reuters', 'The Verge / TechCrunch'],
    guidance:
      'Resolve against an official announcement from the company involved, corroborated by a major tech outlet. State the exact product/event and deadline. Beware vague terms like "launch" — define whether it means announced, released, or generally available.',
  },
  {
    category: 'Science',
    method: 'named_source',
    defaultSources: ['peer-reviewed publication', 'official agency (NASA/WHO/etc.)', 'Reuters'],
    guidance:
      'Resolve against an official agency statement or peer-reviewed source. State the exact claim and what specific evidence counts as confirmation.',
  },
  {
    category: 'Culture',
    method: 'human_review',
    defaultSources: ['official awarding body / chart', 'Reuters', 'AP'],
    guidance:
      'Resolve against the official source for the event (e.g. Billboard for charts, the awarding body for awards), corroborated by a major outlet. Define ties and edge cases explicitly.',
  },
  {
    category: 'Other',
    method: 'human_review',
    defaultSources: ['two independent reputable news sources'],
    guidance:
      'Resolve against at least two independent reputable sources reporting the same outcome. If no clear authoritative source exists, flag for manual review before going live.',
  },
]

/**
 * Look up the rule for a category, falling back to "Other" if unknown.
 * Accepts both the app's category ids ('tech', 'crypto') and the display
 * labels used above ('Tech & AI') — the prefix match is what lets the id
 * 'tech' find the 'Tech & AI' rule.
 */
export function getResolutionRule(category: string): CategoryResolutionRule {
  const c = category.trim().toLowerCase()
  const found = RESOLUTION_RULES.find(r => {
    const label = r.category.toLowerCase()
    return label === c || label.startsWith(c) || c.startsWith(label)
  })
  return found ?? RESOLUTION_RULES[RESOLUTION_RULES.length - 1]
}

/** A compact version of all rules, for injecting into the AI prompt. */
export function rulesForPrompt(): string {
  return RESOLUTION_RULES.map(
    r => `- ${r.category} (${r.method}): sources = ${r.defaultSources.join(', ')}. ${r.guidance}`
  ).join('\n')
}
