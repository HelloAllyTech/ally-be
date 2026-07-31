/**
 * Prompt codes resolved through PromptSharedService (folder file, or a dashboard
 * override once an admin edits it). Convention: `<subdir>_<filename>` — this one
 * is src/prompts/analytics_suggestions/generate.txt.
 */
export const SUGGESTION_PROMPT_CODES = {
  GENERATE: 'analytics_suggestions_generate',
} as const;

/**
 * How many suggestions one run may produce.
 *
 * A cap rather than a target. The prompt is explicit that fewer is better than
 * padded, and this number only stops a runaway response from filling the queue —
 * it is never used to top a short list up.
 */
export const MAX_SUGGESTIONS_PER_RUN = 10;

/**
 * Field caps applied to the model's output before it is stored.
 *
 * BODY matches the roadmap's own description limit, because the body is what
 * pre-fills the file-an-opportunity form on accept: a suggestion whose body could
 * not be filed would be a dead end at the last step.
 */
export const SUGGESTION_FIELD_LIMITS = {
  TITLE: 200,
  BODY: 1000,
  RATIONALE: 1000,
  EVIDENCE_ITEMS: 5,
  EVIDENCE_ITEM: 300,
  REJECTED_REASON: 1000,
} as const;

/**
 * How much history goes into the prompt as "do not re-propose this".
 *
 * Bounded because the payload already carries a whole analytics window and the
 * context is the part that grows without limit as the queue fills. Newest-first,
 * so what falls off the end is the oldest decision — the one least likely to be
 * re-proposed anyway.
 */
export const SUGGESTION_CONTEXT_LIMITS = {
  REJECTED: 100,
  ALREADY_PROPOSED: 100,
  OPPORTUNITIES: 200,
  /** Per-opportunity description excerpt; enough to recognise, not to re-read. */
  OPPORTUNITY_EXCERPT: 200,
} as const;

/** Anthropic call shape for the one generation call per run. */
export const SUGGESTION_LLM = {
  MAX_TOKENS: 4000,
  /**
   * Generous, because this call reads a whole window's aggregates before it
   * writes anything. The client aborts at this bound rather than leaving the
   * request hanging on a socket the reader is still waiting on.
   */
  TIMEOUT_MS: 120_000,
} as const;

/**
 * Payload compaction budget.
 *
 * SECTION_MAX_CHARS drops a single oversized section rather than truncating it
 * mid-structure: half a JSON object in a prompt is worse than a named absence,
 * because the model cannot tell which half it is missing. Dropped sections are
 * reported to the reader in `sections.failed`, never silently.
 */
export const SUGGESTION_PAYLOAD_LIMITS = {
  SECTION_MAX_CHARS: 12_000,
  /** Trailing buckets kept from any time series. */
  SERIES_POINTS: 12,
  /** Rows kept from any ranked list (orgs, languages, competencies, tracks). */
  LIST_ROWS: 15,
} as const;
