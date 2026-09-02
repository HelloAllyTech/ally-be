/** Language-glossary constants (LANGUAGE_GLOSSARY_DESIGN.md §4-§5). */

/**
 * Hard cap on the compiled Tier 0 (injectionMode='always') block, in
 * o200k_base tokens. Publish is blocked when the language's always-set would
 * exceed this — the cap is enforced at authoring time, never truncated
 * silently at runtime. Chars are not the unit: Indic scripts inflate 2–4×.
 */
export const TIER0_TOKEN_CAP = 2000;

/** Registry prompt that generates a language's draft glossary (seeded by migration). */
export const GLOSSARY_GENERATION_PROMPT_CODE = 'glossary_generation';

/**
 * Fixed compile order for Tier 0 sections; codes not listed sort after these,
 * alphabetically. Order is deterministic so the system-prompt prefix stays
 * stable across turns (prompt-cache friendly).
 */
export const GLOSSARY_SECTION_ORDER = [
  'core_style',
  'pronouns_kinship',
  'code_mixing',
] as const;

/** Max entries accepted per section in one upsert (sanity bound, not a product limit). */
export const MAX_GLOSSARY_ENTRIES_PER_SECTION = 200;

/** Registry prompt that consolidates judge error annotations into proposed entries. */
export const GLOSSARY_CONSOLIDATION_PROMPT_CODE = 'glossary_consolidation';

/**
 * Judge dimensions the consolidation loop mines. Style/lexicon dimensions plus
 * `fluency`, which is admitted ONLY through the systematicity gate (the same
 * grammatical category recurring ≥ GLOSSARY_SYSTEMATIC_MIN times) — one-off
 * grammar slips are model competence; a recurring pattern is a correctable
 * rule. coherence/understanding stay excluded outright.
 */
export const GLOSSARY_CONSOLIDATION_DIMENSIONS = [
  'register',
  'dialect_lexicon',
  'colloquialness',
  'codeswitch',
  'persona_social',
  'fluency',
] as const;

/** Cluster support floor (construct-class pipeline). Below this, a candidate
 * never reaches the LLM — no single-anecdote rules (adaptive: singletons pass
 * while a language has <20 unconsumed annotations, so thin languages don't stall). */
export const GLOSSARY_MIN_CLUSTER_SUPPORT = 2;

/** Same-category recurrences before a fluency (grammar) error counts as systematic. */
export const GLOSSARY_SYSTEMATIC_MIN = 5;

/** Learner-corpus occurrences of an avoid-term above which the entry is
 * CONTRADICTED (the population itself says the word — don't fight real usage). */
export const GLOSSARY_LEXICAL_CONTRADICTION_MIN = 5;

/** Tier scoring: severity-weighted error mass counts this much per weighted
 * unit relative to one corpus term occurrence. Severity weights follow the
 * platform's read-time convention (minor 1 / major 5 / critical 10). */
export const TIER_ERROR_MASS_WEIGHT = 20;
export const TIER_SEVERITY_WEIGHTS: Record<string, number> = {
  minor: 1,
  major: 5,
  critical: 10,
};

/** Density band around the knapsack cut inside which a section keeps its
 * current tier — prevents cycle-to-cycle tier flapping. */
export const TIER_HYSTERESIS = 0.15;

/**
 * Most-recent UNCONSUMED annotations considered per consolidation run (keeps
 * the prompt bounded). The consumed-set is excluded in SQL before this limit
 * applies — capping the recent rows and dropping consumed ones afterwards let
 * consumed rows spend the whole budget, which stalled the loop entirely
 * (see `unconsumedAnnotationsQuery`).
 */
export const GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT = 200;

/**
 * How far back the consolidation read reaches.
 *
 * A glossary rule goes into the agent's every-turn prompt, so the evidence
 * behind it has to describe the agent we ship NOW. An unbounded read does not:
 * measured 2026-09-02, the unconsumed pool stretched back to 2026-04-06 and
 * spanned two different agent LLMs per language, so 1,044 annotations would
 * have written today's prompt from a retired model's mistakes.
 *
 * 90 days deliberately matches the scheduler's own worklist window
 * (`queryCandidateLanguages`) — a language qualifies for consolidation on
 * 90-day-recent annotations, so those are the annotations it should mine.
 *
 * Annotations older than this are never mined and stay permanently unconsumed;
 * that is intended, not a leak. Rows with a NULL `occurredAt` (none exist in
 * production) cannot satisfy a recency test and are excluded by the same token.
 */
export const GLOSSARY_CONSOLIDATION_RECENCY_DAYS = 90;

/** Registry prompt that adjudicates queued proposals (seeded by migration). */
export const GLOSSARY_ADJUDICATION_PROMPT_CODE = 'glossary_adjudication';

/**
 * Proposals sent to the adjudicator in one call. Small on purpose: the
 * adjudicator must weigh each proposal against the existing glossary, and a
 * long list invites it to skim. Batches beyond this are adjudicated in
 * successive calls.
 */
export const GLOSSARY_ADJUDICATION_BATCH = 25;
