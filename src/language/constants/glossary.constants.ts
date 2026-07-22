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
