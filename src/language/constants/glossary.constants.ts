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

/** Most-recent annotations considered per consolidation run (keeps the prompt bounded). */
export const GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT = 200;
