// Somoco — resolution sources & criteria conventions
//
// This file answers one question for every prediction on Somoco: WHO decides
// whether it came true, and what exactly do they have to say for it to count?
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS NOT GUESSWORK. It was rebuilt on 2026-08-11 from a live sample of
// 800 open Polymarket markets (scratchpad/mine-polymarket-sources.mjs and
// mine-source-clauses.mjs re-run it any time). The earlier version of this file
// was written from imagination and got the sources materially wrong. What the
// real data showed:
//
//   83%   of markets state their resolution source IN the criteria text.
//         It is a required structural element, not a nice-to-have.
//   46%   point at "official information from [the governing body]" + a URL —
//         the league, the government, the awarding body, the company itself.
//   30%   of those clauses add "however, a consensus of credible reporting may
//         also be used" as an explicit fallback when the authority is silent.
//   10%   name a news desk — and for US elections it is always the same trio:
//         "the Associated Press, Fox News, and NBC" (64 markets, verbatim).
//   77%   state a timezone. 56% use "11:59 PM ET" as the deadline.
//   45%   carry an "Other" bucket for outcomes that can't be determined.
//   33/35 crypto markets resolve against BINANCE 1-minute candles.
//
// Corrections that fell out of that, versus what this file used to claim:
//   - Crypto did NOT resolve against Chainlink or Pyth. Not once in 35 crypto
//     markets. It resolves against a named exchange, a named trading pair, and
//     a named candle field. Chainlink/Pyth were removed.
//   - "Opta / Stats Perform" appeared ZERO times. Football resolves against the
//     competition's own governing body. Opta was removed.
//   - Reuters and Bloomberg appeared too rarely to make the cut anywhere. The
//     authority is nearly always the PARTY ITSELF (the company announcing its
//     own earnings, the league publishing its own result), not a newspaper
//     reporting on it. News is the fallback, not the primary.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE BEHIND ALL OF IT: the criteria is the contract, the question is
// just a headline. Every dispute Polymarket has ever had traces back to criteria
// that were readable two ways. So a prediction should not go live on Somoco
// until it names its authority and pins down its edge cases.

export type ResolutionMethod = 'automated_feed' | 'named_source' | 'human_review'

/** A specific, nameable authority — with the page you actually go read. */
export interface ResolutionSource {
  /** How it's written in the criteria, e.g. "official information from UEFA". */
  name: string
  /** Where a human goes to check. Omitted when the source is a class, not a site. */
  url?: string
  /** What to read once you're there. */
  note?: string
}

export interface CategoryResolutionRule {
  /** Display label. `getResolutionRule` also matches the app's category id. */
  category: string
  /** The app's category id (lib/predictions/categories.ts). */
  id: string
  method: ResolutionMethod
  /** Who decides, in priority order. First one that speaks, wins. */
  primary: ResolutionSource[]
  /** What to do when every primary source is silent or unclear. */
  fallback: string
  /** Plain-English guidance the AI parser reads when writing criteria. */
  guidance: string
  /**
   * The edge cases criteria in this category MUST pin down before going live.
   * Derived from what the high-volume Polymarket markets in each topic bother
   * to spell out — these are the places money actually gets argued over.
   */
  mustState: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared conventions — the parts that are the same in every category
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polymarket's fallback clause, near-verbatim (51.5% of all criteria contain
 * this phrase). It exists because official sources go quiet, get delayed, or
 * never address the exact question. Without a stated fallback, that silence is
 * an unresolvable market.
 */
export const CREDIBLE_REPORTING_FALLBACK =
  'a consensus of credible reporting may also be used'

/**
 * Somoco resolves in UTC, not ET.
 *
 * Polymarket uses "11:59 PM ET" because Polymarket is a US company. Somoco is
 * not: it settles on Intuition, whose block timestamps are UTC, and its users
 * are not US-centric. Mixing the two is how a market resolves five hours early.
 * Pick one, state it every time — this is the one.
 */
export const RESOLUTION_TIMEZONE = 'UTC'
export const DEADLINE_CONVENTION = '23:59 UTC on the resolution date'

/**
 * Somoco's replacement for Polymarket's "Other" outcome.
 *
 * 45% of Polymarket markets carry an "Other" bucket for outcomes that can't be
 * determined — the election never happens, the match is cancelled, the company
 * never files. Somoco's settlement layer is BINARY (YES/NO only, see
 * docs/settlement-v1-spec.md §2), so it has no "Other" to resolve to.
 *
 * Its equivalent is VOID: the contract's void() returns every staker exactly
 * their stake with zero fee taken. Criteria must therefore route undeterminable
 * outcomes to void, never to a coin-flip NO.
 */
export const VOID_CLAUSE =
  'If the outcome cannot be determined from the sources above by the deadline, the market is VOIDED and every stake is refunded in full — it does not resolve NO by default.'

/**
 * Named authorities, matched by keyword against the prediction text.
 *
 * This is the part that makes criteria specific instead of generic. A football
 * prediction doesn't resolve against "the official league" — it resolves
 * against UEFA, or France Football, or the Premier League, depending on what
 * the prediction is about. Polymarket names the exact body every time; the
 * counts below are how many markets in the 800-market sample named each one.
 *
 * Add to this list freely — it is the cheapest possible improvement to
 * resolution quality, and it needs no AI change.
 */
export const AUTHORITIES: { match: RegExp; source: ResolutionSource; categories: string[] }[] = [
  // ── Football ───────────────────────────────────────────────────────────────
  {
    match: /\bballon d'?or\b/i,
    // 24 markets named France Football for exactly this. Somoco has two live
    // Ballon d'Or predictions (Messi, Rodri) — both should carry this source.
    source: { name: 'official announcement from France Football', url: 'https://www.francefootball.fr/', note: 'the awarding ceremony result' },
    categories: ['football', 'sports', 'culture'],
  },
  {
    match: /\bchampions league|\bucl\b|europa league|conference league|uefa\b/i,
    source: { name: 'official information from UEFA', url: 'https://www.uefa.com/', note: 'official competition results' },
    categories: ['football', 'sports'],
  },
  {
    match: /\bworld cup\b|\bfifa\b/i,
    source: { name: 'official information from FIFA', url: 'https://www.fifa.com/', note: 'official tournament results' },
    categories: ['football', 'sports'],
  },
  {
    match: /premier league|\bepl\b/i,
    source: { name: 'official information from the Premier League', url: 'https://www.premierleague.com/', note: 'final league table' },
    categories: ['football', 'sports'],
  },
  {
    match: /\bla liga\b|serie a\b|bundesliga|ligue 1\b/i,
    source: { name: "official information from the competition's governing body", note: 'final league table' },
    categories: ['football', 'sports'],
  },
  {
    match: /afcon|africa cup of nations|\bcaf\b/i,
    source: { name: 'official information from CAF', url: 'https://www.cafonline.com/', note: 'official tournament results' },
    categories: ['football', 'sports'],
  },

  // ── Other sports (all measured in the sample) ──────────────────────────────
  {
    match: /\bnfl\b|super bowl/i,
    source: { name: 'official information from the NFL', url: 'https://www.nfl.com/' }, // 41 markets
    categories: ['sports'],
  },
  {
    match: /\bnba\b|\bfinals\b/i,
    source: { name: 'official information from the NBA', url: 'https://www.nba.com/' }, // 17 markets
    categories: ['sports'],
  },
  {
    match: /\bmlb\b|world series/i,
    source: { name: 'official information from MLB', url: 'https://www.mlb.com/' }, // 24 markets
    categories: ['sports'],
  },
  {
    match: /\bnhl\b|stanley cup/i,
    source: { name: 'official information from the NHL', url: 'https://www.nhl.com/' },
    categories: ['sports'],
  },
  {
    match: /formula 1|\bf1\b|grand prix/i,
    source: { name: 'official information from Formula 1', url: 'https://www.formula1.com/', note: 'final driver/constructor standings' }, // 22 markets
    categories: ['sports'],
  },
  {
    match: /\bufc\b|\bmma\b/i,
    source: { name: 'official information from the UFC', url: 'https://www.ufc.com/', note: 'official bout result including any overturn' },
    categories: ['sports'],
  },
  {
    match: /\batp\b|\bwta\b|wimbledon|us open|roland garros|australian open/i,
    source: { name: 'official information from the ATP/WTA', url: 'https://www.atptour.com/en/scores/current' },
    categories: ['sports'],
  },
  {
    match: /olympic|\bioc\b/i,
    source: { name: 'official information from the IOC', url: 'https://olympics.com/', note: 'official medal table after any reallocation' },
    categories: ['sports'],
  },

  // ── Crypto ────────────────────────────────────────────────────────────────
  {
    match: /\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|dogecoin|doge|bnb|trust)\b.*\b(price|reach|hit|above|below|\$)/i,
    // 33 of 35 crypto markets. Note the mechanics, not just the venue.
    source: {
      name: 'Binance spot price, 1-minute candles',
      url: 'https://www.binance.com/en/trade/BTC_USDT',
      note: 'name the exact pair (e.g. BTC/USDT) and the candle field (High / Low / Close)',
    },
    categories: ['crypto'],
  },

  // ── Macro / rates ─────────────────────────────────────────────────────────
  {
    match: /\bfed\b|federal reserve|\bfomc\b|interest rate|rate (cut|hike)/i,
    source: { name: 'the official FOMC statement', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', note: 'the target range published in the statement' }, // 30 markets
    categories: ['business', 'crypto', 'politics'],
  },
  {
    match: /\bcpi\b|inflation|unemployment|jobs report|\bgdp\b/i,
    source: { name: 'the official release from the Bureau of Labor Statistics / BEA', url: 'https://www.bls.gov/', note: 'first published print, not later revisions — say so explicitly' },
    categories: ['business', 'politics'],
  },

  // ── US politics (the measured trio + the party-source pattern) ─────────────
  {
    match: /\b(us|u\.s\.|american|presidential|senate|house|governor|midterm) (election|race|seat)|wins? the (\d{4} )?(us |u\.s\. )?(presidential )?election/i,
    // 64 markets, verbatim: "the Associated Press, Fox News, and NBC".
    source: { name: 'the Associated Press, Fox News, and NBC', note: 'the race called by all three; if they disagree, wait for certification' },
    categories: ['politics'],
  },
  {
    match: /(democratic|republican) (presidential )?(nomination|nominee|primary)/i,
    // 47 + 37 markets: nominations resolve against the party, not the press.
    source: { name: 'a consensus of official party sources', note: 'the party formally naming its nominee' },
    categories: ['politics'],
  },
  {
    match: /\bnobel\b/i,
    source: { name: 'the first official announcement from the Norwegian Nobel Committee', url: 'https://www.nobelprize.org/' }, // 19 markets
    categories: ['culture', 'science', 'politics'],
  },

  // ── Nigeria / Africa — Somoco's own backyard, not in the Polymarket sample.
  // Added because Somoco's live feed already carries Tinubu predictions and
  // "AP, Fox News and NBC" is the wrong authority for a Nigerian question.
  {
    match: /\b(inec|nigeria|nigerian|tinubu|naira|cbn)\b/i,
    source: { name: 'official information from INEC / the Central Bank of Nigeria / the Presidency, as applicable', url: 'https://www.inecnigeria.org/', note: 'for a public statement, the official transcript or broadcast published by the Presidency' },
    categories: ['politics', 'business', 'other'],
  },

  // ── Business / company events ─────────────────────────────────────────────
  {
    match: /market cap(italization)?|largest company/i,
    source: { name: "the primary exchange's official listing data", note: 'shares outstanding × official closing price; name the exchange' },
    categories: ['business', 'tech'],
  },
  {
    match: /\bipo\b|goes public|earnings|revenue|acquisi|acquires|merger/i,
    source: { name: 'official information from the listed company and/or its leadership', note: 'the filing or press release; an ANNOUNCED agreement counts even if it later collapses — say which you mean' },
    categories: ['business', 'tech'],
  },

  // ── Tech / AI ─────────────────────────────────────────────────────────────
  {
    match: /\b(openai|anthropic|google|deepmind|meta|apple|microsoft|xai)\b|\b(gpt|claude|gemini|llama|grok)\b|releases? a model|\bagi\b/i,
    source: { name: 'the official announcement from the company involved', note: 'define "launch" — announced, released, or generally available are three different dates' },
    categories: ['tech'],
  },

  // ── Culture ───────────────────────────────────────────────────────────────
  {
    match: /oscar|academy award|grammy|emmy|golden globe/i,
    source: { name: 'the official announcement from the awarding body' },
    categories: ['culture'],
  },
  {
    match: /billboard|chart|number one|#1 (song|album)/i,
    source: { name: 'the official Billboard chart', url: 'https://www.billboard.com/charts/', note: 'name the exact chart and the chart-dated week' },
    categories: ['culture'],
  },
  {
    match: /box office|grosses?/i,
    source: { name: 'Box Office Mojo', url: 'https://www.boxofficemojo.com/', note: 'name domestic vs worldwide' },
    categories: ['culture'],
  },

  // ── Science ───────────────────────────────────────────────────────────────
  {
    match: /\bnasa\b|launch|rocket|spacex|mars|moon landing/i,
    source: { name: 'official information from NASA / the launch provider', url: 'https://www.nasa.gov/', note: 'define success — launch, orbit, or landing' },
    categories: ['science', 'tech'],
  },
  {
    match: /\bwho\b (declares|announces)|pandemic|outbreak|vaccine approval|\bfda\b/i,
    source: { name: 'the official statement from the WHO / FDA', note: 'the formal declaration or approval notice, not press coverage of it' },
    categories: ['science'],
  },

  // ── Geopolitics — deliberately consensus-only ─────────────────────────────
  {
    match: /ceasefire|invade|invasion|\bwar\b|airstrike|treaty|sanctions|blockade|annex|coup/i,
    // Verbatim from the sample's best-written geopolitical clause. There is no
    // registry of who controls what; the honest source IS informed consensus.
    source: {
      name: 'a consensus of credible reporting',
      note: 'assessing the situation on the ground at the specified time; define what physically must have happened, not who says it has',
    },
    categories: ['politics', 'other'],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Per-category defaults — used when no named authority above matches
// ─────────────────────────────────────────────────────────────────────────────

export const RESOLUTION_RULES: CategoryResolutionRule[] = [
  {
    category: 'Crypto',
    id: 'crypto',
    method: 'automated_feed',
    primary: [
      {
        name: 'Binance spot price, 1-minute candles',
        url: 'https://www.binance.com/en/trade/BTC_USDT',
        note: 'the exact trading pair named in the criteria',
      },
      { name: 'Coinbase spot price', url: 'https://www.coinbase.com/price', note: 'only if the asset is not listed on Binance — say which applies' },
    ],
    fallback:
      'If the asset is not listed on either venue, the market is voided rather than resolved from an unnamed source.',
    guidance:
      'Name the exchange, the exact trading pair, the candle interval, and WHICH price field counts (High / Low / Close). Say whether it resolves the instant the threshold is touched or only at the deadline — these give different answers. State that prices from other exchanges do not count. Example: "Resolves YES if any Binance BTC/USDT 1-minute candle between now and 23:59 UTC on the resolution date has a High at or above $150,000. Prices from other exchanges do not count."',
    mustState: [
      'the exact trading pair (BTC/USDT, not "Bitcoin")',
      'which price field counts — High, Low, or Close',
      'whether touching the threshold at any moment wins, or only the price at the deadline',
      'that other exchanges do not count',
    ],
  },
  {
    category: 'Football',
    id: 'football',
    method: 'named_source',
    primary: [
      { name: "official information from the competition's governing body", note: 'UEFA, FIFA, the national league, or France Football for the Ballon d\'Or' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Resolve against the official final result published by the body that runs the competition — not a news report of it. Be explicit about what counts as "winning": full-time only, or including extra time and penalties. Say what happens if the match is postponed, abandoned, or awarded.',
    mustState: [
      'whether extra time and penalties count',
      'what happens if the match is postponed, abandoned, or awarded off the pitch',
      'for a season-long claim: that it resolves NO early if the team is mathematically eliminated',
      'how a tie or shared title is treated',
    ],
  },
  {
    category: 'Sports',
    id: 'sports',
    method: 'named_source',
    primary: [
      { name: 'official information from the governing body', note: 'NFL, NBA, MLB, F1, ATP/WTA, the IOC — name the specific one' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Resolve against the official result from the body that runs the competition, at the URL it publishes. State the exact event, what counts as a win, and how cancellations and ties are handled. For season-long claims, state that elimination resolves it NO early.',
    mustState: [
      'the exact event and season',
      'that mathematical elimination resolves NO early',
      'cancellation or postponement handling, with a cut-off date',
      'the tiebreak procedure, using the governing body\'s own rules',
      'whether a later disqualification or reallocation changes the result',
    ],
  },
  {
    category: 'Politics',
    id: 'politics',
    method: 'named_source',
    // Deliberately generic. The specific cases — the US call trio, party
    // nominations, INEC — live in AUTHORITIES above so they attach only to
    // predictions they actually fit. Listing them here put "for US races: the
    // Associated Press, Fox News, and NBC" on a Nigerian prediction.
    primary: [
      { name: 'official information from the relevant electoral authority or government', note: 'INEC, the FEC, the certifying body — name it' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Name the office or measure exactly, and say what act settles it — being called, being certified, or being sworn in are three different dates and the gap between them is where disputes live. State whether interim or caretaker holders count. For geopolitical events, resolve against a consensus of credible reporting on what physically happened, and define the physical act precisely.',
    mustState: [
      'the exact office, measure, or event',
      'which act counts: called, certified, or sworn in',
      'whether interim or acting holders count',
      'what happens if the vote is delayed, contested, or annulled',
    ],
  },
  {
    category: 'Business',
    id: 'business',
    method: 'named_source',
    // The exchange-listing source is in AUTHORITIES, keyed to market-cap and
    // share-price wording, so it attaches only where it belongs.
    primary: [
      { name: 'official information from the company and/or its leadership', note: 'the filing, press release, or earnings statement' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'The company itself is the authority on its own events, not a newspaper reporting on them. State the exact event and the reporting deadline. For an acquisition, say whether an ANNOUNCED agreement counts or only a completed one. For a market-cap claim, define it (shares outstanding × official closing price) and name the exchange.',
    mustState: [
      'the exact event and its deadline',
      'for deals: announced agreement vs completed transaction',
      'for figures: the exact definition and which exchange or filing it comes from',
      'whether later restatements or revisions change the result',
    ],
  },
  {
    category: 'Tech & AI',
    id: 'tech',
    method: 'named_source',
    primary: [
      { name: 'the official announcement from the company involved' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Resolve against the company\'s own announcement. The single biggest trap in this category is the word "launch" — announced, released in preview, and generally available are three different dates. Define which one counts. Same for "beats" or "best" on a benchmark: name the benchmark, the version, and the leaderboard.',
    mustState: [
      'what "launch"/"release" means here — announced, preview, or generally available',
      'for benchmark claims: the exact benchmark, version, and leaderboard URL',
      'whether a limited or regional release counts',
    ],
  },
  {
    category: 'Science',
    id: 'science',
    method: 'named_source',
    primary: [
      { name: 'the official statement from the responsible agency', note: 'NASA, WHO, FDA, the national met office — name it' },
      { name: 'a peer-reviewed publication', note: 'name the journal and what finding counts' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Resolve against the agency\'s own formal statement or a peer-reviewed publication — not a press release about a preprint. State exactly what evidence counts as confirmation, and what does not.',
    mustState: [
      'the exact claim and what evidence confirms it',
      'whether a preprint counts or only peer review',
      'for missions: whether launch, orbit, or landing is the bar',
    ],
  },
  {
    category: 'Culture',
    id: 'culture',
    method: 'named_source',
    primary: [
      { name: 'the official announcement from the awarding body or chart', note: 'the Academy, the Nobel Committee, Billboard, Box Office Mojo' },
    ],
    fallback: CREDIBLE_REPORTING_FALLBACK,
    guidance:
      'Resolve against the body that actually confers the thing. Name the exact award, category, and year, or the exact chart and chart-dated week. Define ties, withdrawals, and posthumous or revoked awards.',
    mustState: [
      'the exact award/chart, category, and edition or week',
      'tie handling',
      'whether a later revocation or reallocation changes the result',
    ],
  },
  {
    category: 'Other',
    id: 'other',
    method: 'human_review',
    primary: [
      { name: 'a consensus of credible reporting', note: 'multiple independent outlets reporting the same specific fact' },
    ],
    fallback:
      'If no authoritative source addresses the claim by the deadline, the market is voided and all stakes are refunded.',
    guidance:
      'This is the catch-all and it is the most dangerous category, because "credible reporting" is only as precise as the thing being reported. Define the PHYSICAL, OBSERVABLE event that must happen — not an interpretation of it. If you cannot write a sentence that two people who disagree would both accept as settling it, the prediction is not resolvable and should be flagged with needsReview rather than approved.',
    mustState: [
      'the specific observable event, in terms both sides would accept',
      'what explicitly does NOT count',
      'that the market voids if no source addresses it',
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up the rule for a category, falling back to "Other" if unknown.
 * Accepts both the app's category ids ('tech', 'crypto') and the display
 * labels above ('Tech & AI').
 */
export function getResolutionRule(category: string): CategoryResolutionRule {
  const c = category.trim().toLowerCase()
  const found = RESOLUTION_RULES.find(r => {
    if (r.id === c) return true
    const label = r.category.toLowerCase()
    return label === c || label.startsWith(c) || c.startsWith(label)
  })
  return found ?? RESOLUTION_RULES[RESOLUTION_RULES.length - 1]
}

/**
 * Find the specific named authorities for a prediction, by matching its text.
 * This is what turns "the official league" into "official information from
 * UEFA" — the difference between criteria that settle themselves and criteria
 * that start an argument.
 *
 * Returns [] when nothing specific matches; callers fall back to the category's
 * `primary` list.
 */
export function findAuthorities(text: string, category?: string): ResolutionSource[] {
  const haystack = text.trim()
  if (!haystack) return []
  const cat = category?.trim().toLowerCase()
  const out: ResolutionSource[] = []
  for (const entry of AUTHORITIES) {
    if (cat && !entry.categories.includes(cat)) continue
    if (entry.match.test(haystack)) out.push(entry.source)
  }
  return out
}

/**
 * The source names for a prediction, best-first: any specifically matched
 * authority, then the category's defaults. This is what lands in
 * `ResolutionPlan.sources`.
 */
export function resolveSources(text: string, category: string): string[] {
  const rule = getResolutionRule(category)
  const matched = findAuthorities(text, rule.id)
  const names = [...matched.map(s => s.name), ...rule.primary.map(s => s.name)]
  // Capped at three. A source list is an instruction to whoever resolves this,
  // and a list of six is not an instruction — it's a shrug. Specific matches
  // come first, so the cap only ever trims generic category defaults.
  return [...new Set(names)].slice(0, 3)
}

/** Just the category's default source names — no text matching. */
export function sourceNames(rule: CategoryResolutionRule): string[] {
  return rule.primary.map(s => s.name)
}

/**
 * The full checklist a category's criteria must answer, including the shared
 * conventions. Useful for the approval gate and for showing the submitter what
 * a good prediction looks like.
 */
export function criteriaChecklist(category: string): string[] {
  const rule = getResolutionRule(category)
  return [
    `a named source — ${rule.primary[0]?.name ?? 'a specific authority'}`,
    `a deadline stated as ${DEADLINE_CONVENTION}`,
    ...rule.mustState,
    'what happens if it cannot be determined (void, not NO)',
  ]
}

/** A compact version of all rules, for injecting into the AI prompt. */
export function rulesForPrompt(): string {
  const rules = RESOLUTION_RULES.map(r => {
    const primary = r.primary.map(s => (s.url ? `${s.name} (${s.url})` : s.name)).join(' → ')
    return [
      `- ${r.category} [${r.id}] (${r.method})`,
      `    primary source: ${primary}`,
      `    if silent: ${r.fallback}`,
      `    must state: ${r.mustState.join('; ')}`,
      `    ${r.guidance}`,
    ].join('\n')
  }).join('\n')

  return `${rules}

SHARED CONVENTIONS — these apply to every category:
- All times are ${RESOLUTION_TIMEZONE}. Deadlines are written as "${DEADLINE_CONVENTION}". Never use ET or a local timezone.
- Name the authority specifically ("official information from UEFA"), never generically ("the official league").
- Prefer the party itself over a news report about it: the league publishes its own results, the company announces its own earnings. News is the fallback, not the primary.
- ${VOID_CLAUSE}`
}

/**
 * The specific-authority hints for one prediction, for the AI prompt. Keeps the
 * parser from inventing a source when Somoco already knows the right one.
 *
 * `category` is optional because at prompt-building time the category has not
 * been chosen yet — the AI picks it. Omitting it matches across all categories,
 * which is the right behaviour for a hint.
 */
export function authorityHintForPrompt(text: string, category?: string): string {
  const matched = findAuthorities(text, category ? getResolutionRule(category).id : undefined)
  if (matched.length === 0) return ''
  const lines = matched.map(s => {
    const bits = [s.name]
    if (s.url) bits.push(`(${s.url})`)
    if (s.note) bits.push(`— ${s.note}`)
    return `  - ${bits.join(' ')}`
  })
  return `\nSomoco already knows the right authority for this prediction. Use it:\n${lines.join('\n')}`
}
