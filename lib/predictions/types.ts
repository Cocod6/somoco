// Somoco — Phase 1: shared types for prediction parsing

export interface ParsedPrediction {
  /** The entity the prediction is about, e.g. "Bitcoin" */
  subject: string
  /** What is being claimed, e.g. "reaches $150K" */
  claim: string
  /** The timeframe or condition, e.g. "before December 2026" */
  condition: string
  /**
   * Category id (politics, crypto, football, …) for the Polymarket-style feed
   * sections. Classified by the AI parser; keyword-derived as a fallback.
   * See lib/predictions/categories.ts.
   */
  category: string
  /**
   * The ISO date (YYYY-MM-DD) when this prediction can be judged.
   * e.g. "2026-12-31". Null if the AI couldn't extract one.
   */
  resolutionDate: string | null
  /** True if the AI needs to ask the user for a resolution date */
  needsClarification: boolean
  /** The question to show the user if clarification is needed */
  clarificationQuestion: string | null
  /** The original free-text the user typed */
  originalText: string
}

// How a prediction will be judged — written at submit time so users see the
// resolution contract up front (the rules are the contract, not the headline).
// See lib/predictions/resolutionRules.ts for the preset sources per category.
export interface ResolutionPlan {
  method: 'automated_feed' | 'named_source' | 'human_review'
  /** e.g. ["Chainlink Data Feeds"] */
  sources: string[]
  /** The exact, readable true/false condition */
  criteria: string
  /** True if no clear resolution path → hold for admin review */
  needsReview: boolean
  /** Why it needs review, if it does */
  reviewReason: string | null
  /**
   * Set only on predictions imported from an external market (Polymarket).
   * Lets settlement READ the outcome instead of judging it — see
   * lib/predictions/polymarket.ts. Absent on hand-written predictions.
   *
   * It lives inside the plan on purpose: `resolution_plan` is already a
   * submitter-owned jsonb column (schema.sql), so imports need no migration.
   */
  external?: ExternalResolutionRef
}

/** Pointer back to the third-party market an imported prediction mirrors. */
export interface ExternalResolutionRef {
  provider: 'polymarket'
  /** Gamma's market id — what readPolymarketOutcome() looks up. */
  marketId: string
  slug: string
  conditionId: string | null
  /** Original ISO timestamp from the source, kept verbatim for auditing. */
  endDate: string | null
  url: string
}

export interface ExistingAtomMatch {
  /** Intuition's term_id for this Atom */
  atomId: string
  /** The Atom's label, e.g. "Bitcoin" */
  label: string
}

export interface ParseResponse {
  parsed: ParsedPrediction
  /** How this prediction will resolve — always present, worst case a preset default */
  resolutionPlan: ResolutionPlan
  /** Atoms already on Intuition that match the subject — reuse, don't duplicate */
  subjectMatches: ExistingAtomMatch[]
  /** Atoms already on Intuition that match the claim/predicate — reuse, don't duplicate */
  predicateMatches: ExistingAtomMatch[]
  /** Atoms already on Intuition that match the condition/object — reuse, don't duplicate */
  objectMatches: ExistingAtomMatch[]
}
