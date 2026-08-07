// Somoco — TEST ONLY fake parser
// No AI call, no cost. Lets you test dedup + on-chain submission while you
// don't have AI API credit yet.
//
// Subject/claim splitting understands: "X will Y", "X won't Y", "X is/are
// going to Y", headline style "X to hit Y", question form "Will X reach Y?",
// leading hedges ("I predict that...", "my prediction:"), and falls back to a
// known-verb split ("Bitcoin hits $150K by 2026") before giving up.
//
// Timeframes recognised (most specific first): explicit dates ("January 15,
// 2027", "15th of Dec", "2026-12-31", "31/12/2026"), quarters with or without
// a year ("Q3 2025", "by Q3"), half-years ("H1 2026", "first half of 2026"),
// early/mid/late year, month+year incl. abbreviations ("Dec 2026"), football
// seasons ("2026/27 season"), a bare FUTURE year (dollar amounts like "$2050"
// and past years are NOT mistaken for one), durations ("within 6 months", "in
// two weeks"), relative phrases ("next year", "this month", "tomorrow"), and
// a month on its own ("in December" — "may" needs a connector so the modal
// verb never reads as the month).
//
// Still not as smart as the real AI parser — switch back anytime (route.ts).
// Only truly date-less predictions fall through to "no condition".

import type { ParsedPrediction } from './types'
import { categorizeText } from './categories'

// Full names first so the alternation prefers "december" over "dec".
const MONTH_DEFS: string[][] = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'],
  ['may'], ['june', 'jun'], ['july', 'jul'], ['august', 'aug'],
  ['september', 'sept', 'sep'], ['october', 'oct'], ['november', 'nov'],
  ['december', 'dec'],
]
const MONTH_ALT = MONTH_DEFS.flat().sort((a, b) => b.length - a.length).join('|')

/** "dec"/"december" → 11; -1 if not a month token. */
function monthIndexOf(token: string): number {
  return MONTH_DEFS.findIndex(names => names.includes(token.toLowerCase()))
}

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Words that can introduce a timeframe — consumed when stripping the detected
// timeframe off the tail of the claim.
const CONNECTORS =
  'by the end of|before the end of|by end of|before end of|end of|before|by|after|until|within|during|in|on'

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
const NUMBER_ALT = `\\d{1,3}|${Object.keys(WORD_NUMBERS).join('|')}`

const lastDayOfMonth = (year: number, monthIndex0: number) =>
  new Date(year, monthIndex0 + 1, 0).getDate()
const iso = (year: number, monthIndex0: number, day: number) =>
  `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const isoOf = (d: Date) => iso(d.getFullYear(), d.getMonth(), d.getDate())

/** today + n months, clamped to the target month's last day. */
function addMonths(today: Date, n: number): Date {
  const target = new Date(today.getFullYear(), today.getMonth() + n, 1)
  const day = Math.min(today.getDate(), lastDayOfMonth(target.getFullYear(), target.getMonth()))
  target.setDate(day)
  return target
}

interface Timeframe {
  /** A concise, human condition for the Triple object, e.g. "by end of Q3 2025" */
  condition: string
  /** ISO date the prediction can be judged on */
  resolutionDate: string
  /** The raw text that matched, so it can be trimmed off the claim */
  matched: string
}

const endOfQuarter = (quarter: number, year: number): Timeframe => {
  const endMonth0 = quarter * 3 - 1 // Q1→Mar(2), Q2→Jun(5), Q3→Sep(8), Q4→Dec(11)
  return {
    condition: `by end of Q${quarter} ${year}`,
    resolutionDate: iso(year, endMonth0, lastDayOfMonth(year, endMonth0)),
    matched: '',
  }
}

/**
 * Pulls a timeframe out of free text, in priority order (most specific first).
 * Returns null when the text mentions no time reference at all.
 */
function detectTimeframe(text: string, todayISO: string): Timeframe | null {
  const lower = text.toLowerCase()
  const today = new Date(todayISO)
  const thisYear = today.getFullYear()

  // 1. Explicit dates.
  // "December 15" / "Dec 15th, 2026" — (?!\d) keeps the day from grabbing the
  // first digits of a year, so "December 2026" falls through to month+year.
  const mdy = lower.match(
    new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?\\b`)
  )
  // "15 December 2026" / "15th of Dec"
  const dmy = lower.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s*(20\\d{2}))?\\b`)
  )
  const dateParts = mdy
    ? { month: monthIndexOf(mdy[1]), day: Number(mdy[2]), year: mdy[3] ? Number(mdy[3]) : null, matched: mdy[0] }
    : dmy
      ? { month: monthIndexOf(dmy[2]), day: Number(dmy[1]), year: dmy[3] ? Number(dmy[3]) : null, matched: dmy[0] }
      : null
  if (dateParts && dateParts.day >= 1 && dateParts.day <= lastDayOfMonth(dateParts.year ?? thisYear, dateParts.month)) {
    let { year } = dateParts
    if (year === null) {
      // No year stated — the next occurrence of that date from today.
      year = thisYear
      if (new Date(year, dateParts.month, dateParts.day) < today) year += 1
    }
    return {
      condition: `by ${MONTH_FULL[dateParts.month]} ${dateParts.day}, ${year}`,
      resolutionDate: iso(year, dateParts.month, dateParts.day),
      matched: dateParts.matched,
    }
  }

  // "2026-12-31" (ISO)
  const isoDate = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (isoDate) {
    const [y, m, d] = [Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])]
    if (m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m - 1)) {
      return { condition: `by ${MONTH_FULL[m - 1]} ${d}, ${y}`, resolutionDate: iso(y, m - 1, d), matched: isoDate[0] }
    }
  }

  // "31/12/2026" — day-first when the first number can't be a month.
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
  if (slash) {
    const [a, b, y] = [Number(slash[1]), Number(slash[2]), Number(slash[3])]
    const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b] // ambiguous → DD/MM
    if (m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m - 1)) {
      return { condition: `by ${MONTH_FULL[m - 1]} ${d}, ${y}`, resolutionDate: iso(y, m - 1, d), matched: slash[0] }
    }
  }

  // 2. Quarter — "Q3 2025", or "by Q3" (next occurrence)
  const q = lower.match(/\bq([1-4])\s*(20\d{2})?\b/)
  if (q) {
    const quarter = Number(q[1])
    let year = q[2] ? Number(q[2]) : thisYear
    if (!q[2] && new Date(endOfQuarter(quarter, year).resolutionDate) < today) year += 1
    return { ...endOfQuarter(quarter, year), matched: q[0] }
  }

  // 3. Half-year — "H1 2026", "first half of 2026"
  const half = lower.match(/\b(h1|h2|first half|second half)(?:\s+of)?\s+(20\d{2})\b/)
  if (half) {
    const second = half[1] === 'h2' || half[1] === 'second half'
    const year = Number(half[2])
    return {
      condition: `by end of ${second ? 'H2' : 'H1'} ${year}`,
      resolutionDate: second ? iso(year, 11, 31) : iso(year, 5, 30),
      matched: half[0],
    }
  }

  // 4. "early/mid/late 2026"
  const part = lower.match(/\b(early|mid|late)[- ](20\d{2})\b/)
  if (part) {
    const year = Number(part[2])
    const end = part[1] === 'early' ? iso(year, 3, 30) : part[1] === 'mid' ? iso(year, 5, 30) : iso(year, 11, 31)
    return { condition: `by ${part[1]} ${year}`, resolutionDate: end, matched: part[0] }
  }

  // 5. Month + year — "December 2026", "dec 2026"
  const my = lower.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(20\\d{2})\\b`))
  if (my) {
    const monthIndex = monthIndexOf(my[1])
    const year = Number(my[2])
    return {
      condition: `by ${MONTH_FULL[monthIndex]} ${year}`,
      resolutionDate: iso(year, monthIndex, lastDayOfMonth(year, monthIndex)),
      matched: my[0],
    }
  }

  // 6. Football-style season — "2026/27 season", "2026/2027 season".
  //    Seasons end in spring of the second year.
  const season = lower.match(/\b(20\d{2})\s*[/–-]\s*(20\d{2}|\d{2})(?=\s*season\b)/)
  if (season) {
    const endYear = season[2].length === 2 ? Number(`20${season[2]}`) : Number(season[2])
    return {
      condition: `in the ${season[1]}/${season[2]} season`,
      resolutionDate: iso(endYear, 4, 31),
      matched: season[0],
    }
  }

  // 7. A bare year — "in 2026", "end of 2026". Guards: not part of a money
  //    amount ("$2050", "1,2026") or unit ("2050k"), and not a past year
  //    ("exceeds its 2021 peak" is a reference, not a deadline).
  const year = lower.match(/(?<![$\d.,])\b(20\d{2})\b(?!\s*[km%])/)
  if (year && Number(year[1]) >= thisYear) {
    const y = Number(year[1])
    return { condition: `by end of ${y}`, resolutionDate: iso(y, 11, 31), matched: year[0] }
  }

  // 8. Durations — "within 6 months", "in two weeks", "over the next year"
  const dur = lower.match(
    new RegExp(`\\b(?:in|within|over)\\s+(?:the\\s+next\\s+)?(${NUMBER_ALT})\\s+(day|week|month|year)s?\\b`)
  )
  if (dur) {
    const n = WORD_NUMBERS[dur[1]] ?? Number(dur[1])
    const unit = dur[2]
    if (n > 0) {
      let target: Date
      if (unit === 'day') target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n)
      else if (unit === 'week') target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n * 7)
      else if (unit === 'month') target = addMonths(today, n)
      else target = addMonths(today, n * 12)
      return { condition: `by ${isoOf(target)}`, resolutionDate: isoOf(target), matched: dur[0] }
    }
  }

  // 9. Relative phrases
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    return { condition: `by ${isoOf(d)}`, resolutionDate: isoOf(d), matched: 'tomorrow' }
  }
  const week = lower.match(/\b(this|next) week\b/)
  if (week) {
    // End of the named week — Sunday of this week, or the one after.
    const daysToSunday = (7 - today.getDay()) % 7
    const offset = week[1] === 'this' ? daysToSunday : daysToSunday + 7
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
    return { condition: `by ${isoOf(d)}`, resolutionDate: isoOf(d), matched: week[0] }
  }
  if (/\bnext year\b/.test(lower)) {
    const y = thisYear + 1
    return { condition: `by end of ${y}`, resolutionDate: iso(y, 11, 31), matched: 'next year' }
  }
  const eoy = lower.match(/\bthis year\b|\bend of (?:the )?year\b/)
  if (eoy) {
    return { condition: `by end of ${thisYear}`, resolutionDate: iso(thisYear, 11, 31), matched: eoy[0] }
  }
  if (/\bnext month\b/.test(lower)) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return {
      condition: 'by end of next month',
      resolutionDate: iso(d.getFullYear(), d.getMonth(), lastDayOfMonth(d.getFullYear(), d.getMonth())),
      matched: 'next month',
    }
  }
  if (/\bthis month\b/.test(lower)) {
    return {
      condition: 'by end of this month',
      resolutionDate: iso(thisYear, today.getMonth(), lastDayOfMonth(thisYear, today.getMonth())),
      matched: 'this month',
    }
  }

  // 10. A month on its own — its next occurrence from today. "may" only counts
  //     with a connector in front ("by may"), otherwise the modal verb in
  //     "Arsenal may win the league" would read as the month of May.
  const monthOnly = lower.match(new RegExp(`\\b(${MONTH_ALT})\\b`))
  if (monthOnly) {
    const token = monthOnly[1]
    const guarded = token === 'may' &&
      !new RegExp(`\\b(?:by|before|in|until|during|after)\\s+(?:the\\s+)?may\\b`).test(lower)
    if (!guarded) {
      const monthIndex = monthIndexOf(token)
      let y = thisYear
      if (monthIndex < today.getMonth()) y += 1
      return {
        condition: `by ${MONTH_FULL[monthIndex]} ${y}`,
        resolutionDate: iso(y, monthIndex, lastDayOfMonth(y, monthIndex)),
        matched: monthOnly[0],
      }
    }
  }

  return null
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Trims the DETECTED timeframe (plus any connector introducing it) off the end
// of the claim — "hit $150K before December 2026" → "hit $150K". A timeframe
// buried mid-claim ("...in 2026 if ETFs continue") is left alone.
function stripTimeframe(claim: string, matched: string): string {
  if (!matched) return claim.trim()
  // \b guards keep the connector and the timeframe from matching inside a
  // word — without them "win AFCON next year" loses its "ON" to the
  // connector "on", leaving "win AFC".
  const re = new RegExp(
    `[,\\s]*(?:\\b(?:${CONNECTORS})\\s+)?(?:the\\s+)?\\b${escapeRegex(matched)}[\\s.,!?]*$`,
    'i'
  )
  return claim.replace(re, '').trim()
}

// Prediction verbs, for splitting headline-style text with no "will" —
// "Bitcoin hits $150K by 2026" → subject "Bitcoin", claim "hits $150K...".
const VERB_ALT = [
  'hits?', 'reach(?:es)?', 'cross(?:es)?', 'surpass(?:es)?', 'exceeds?',
  'wins?', 'loses?', 'flips?', 'beats?', 'drops?', 'falls?', 'rises?',
  'launch(?:es)?', 'releases?', 'ships?', 'becomes?', 'passes?', 'breaks?',
  'gets?', 'goes', 'stays?', 'remains?', 'closes?', 'trades?',
].join('|')

/** Split free text into subject + claim using the strongest available cue. */
function splitSubjectClaim(text: string): { subject: string; claim: string } {
  const lower = text.toLowerCase()

  const splitters: Array<{ marker: RegExp; keep?: string }> = [
    { marker: /\s+will\s+/ },
    { marker: /\s+won't\s+/, keep: "won't " },
    { marker: /\s+(?:is|are)\s+going\s+to\s+/ },
    { marker: /\s+gonna\s+/ },
  ]
  for (const { marker, keep } of splitters) {
    const m = lower.match(marker)
    if (m && m.index !== undefined && m.index > 0) {
      return {
        subject: text.slice(0, m.index).trim(),
        claim: (keep ?? '') + text.slice(m.index + m[0].length).trim(),
      }
    }
  }

  // Headline style — "Bitcoin to hit $150K" (short subject only, so a mid-
  // sentence "to" in a long clause doesn't split in the wrong place).
  const headline = lower.match(/^((?:\S+\s+){1,3}?)to\s+(\S.*)$/)
  if (headline) {
    return { subject: text.slice(0, headline[1].length).trim(), claim: text.slice(headline[1].length + 3).trim() }
  }

  // Known prediction verb — split right before it.
  const verb = lower.match(new RegExp(`\\b(?:${VERB_ALT})\\b`))
  if (verb && verb.index !== undefined && verb.index > 0) {
    return { subject: text.slice(0, verb.index).trim(), claim: text.slice(verb.index).trim() }
  }

  // Fallback: first 2 words are the subject, the rest is the claim.
  const words = text.split(/\s+/)
  return { subject: words.slice(0, 2).join(' '), claim: words.slice(2).join(' ') }
}

export function fakeParsePrediction(
  text: string,
  todayISO: string
): Omit<ParsedPrediction, 'originalText'> {
  // Trailing punctuation and leading hedges ("I predict that...", "Will ...?")
  // carry no meaning for the Triple — drop them before splitting.
  let trimmed = text.trim().replace(/[\s.!?]+$/, '')
  trimmed = trimmed.replace(
    /^(?:i\s+(?:predict|think|believe|bet|reckon|expect|guess)\s+(?:that\s+)?|(?:my\s+)?prediction\s*[:–-]?\s+)/i,
    ''
  )
  trimmed = trimmed.replace(/^will\s+/i, '') // question form: "Will X reach Y?"

  const { subject, claim: rawClaim } = splitSubjectClaim(trimmed)

  // Detect the timeframe from the full text, then trim it off the claim.
  const tf = detectTimeframe(trimmed, todayISO)
  const claim = stripTimeframe(rawClaim, tf?.matched ?? '') || 'is predicted'

  const condition = tf?.condition ?? ''
  const resolutionDate = tf?.resolutionDate ?? null

  const needsClarification = resolutionDate === null
  const clarificationQuestion = needsClarification
    ? "Test parser couldn't find a date — when should this be checked?"
    : null

  return {
    subject: subject || 'unknown',
    claim,
    condition,
    category: categorizeText(trimmed),
    resolutionDate,
    needsClarification,
    clarificationQuestion,
  }
}
