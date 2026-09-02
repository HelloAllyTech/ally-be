/**
 * Script consistency for consolidation evidence.
 *
 * The glossary mines the judge's error annotations for lexical rules. An
 * annotation whose evidence is written in a script the target language does
 * not use is not evidence about that language's lexicon — it is evidence the
 * AGENT DRIFTED into another language, which is a prompt/persona failure with
 * its own dimensions (`persona_social`, `codeswitch`).
 *
 * Measured in production 2026-09-02: 84 English annotations carried Tamil
 * script, all from English-configured DEMCARES sessions where the counsellor
 * spoke only English and the agent drifted. Consolidation duly mined them and
 * proposed Tamil accusative-case and Tamil register rules into the ENGLISH
 * glossary — creating `lexicon_tamil`, `register_tamil` and
 * `grammar_and_syntax_tamil` sections under en-IN. Left to `auto`, that would
 * have published Tamil grammar into every English session's prompt.
 *
 * Latin is never foreign: every Indic language here code-mixes English
 * ("tension", "app", "call"), and those borrowings are exactly what several
 * glossary rules prescribe. So the rule is narrow — a language excludes only
 * the OTHER Indic scripts, never Latin.
 */

/** Unicode block bounds, as codepoints, for the scripts the platform serves. */
const SCRIPT_RANGES: Record<string, [number, number]> = {
  tamil: [0x0b80, 0x0bff],
  devanagari: [0x0900, 0x097f],
  kannada: [0x0c80, 0x0cff],
  telugu: [0x0c00, 0x0c7f],
  malayalam: [0x0d00, 0x0d7f],
  bengali: [0x0980, 0x09ff],
  gujarati: [0x0a80, 0x0aff],
  gurmukhi: [0x0a00, 0x0a7f],
  odia: [0x0b00, 0x0b7f],
};

/** The script a language is written in, by `languages.value` prefix. */
const LANGUAGE_SCRIPT: Record<string, keyof typeof SCRIPT_RANGES | 'latin'> = {
  en: 'latin',
  ta: 'tamil',
  hi: 'devanagari',
  mr: 'devanagari',
  kn: 'kannada',
  te: 'telugu',
  ml: 'malayalam',
  bn: 'bengali',
  gu: 'gujarati',
  pa: 'gurmukhi',
  or: 'odia',
};

/** Script for a `languages.value` such as `ta-IN`; null when unknown. */
export function scriptForLanguage(
  languageValue: string,
): keyof typeof SCRIPT_RANGES | 'latin' | null {
  const prefix = (languageValue ?? '').toLowerCase().split('-')[0];
  return LANGUAGE_SCRIPT[prefix] ?? null;
}

/**
 * Scripts that would make an annotation's evidence foreign to this language —
 * every Indic block except the language's own. Empty for an unknown language,
 * so an unrecognized code filters nothing rather than filtering everything.
 */
export function foreignScriptsFor(
  languageValue: string,
): (keyof typeof SCRIPT_RANGES)[] {
  const own = scriptForLanguage(languageValue);
  if (own === null) return [];
  return (Object.keys(SCRIPT_RANGES) as (keyof typeof SCRIPT_RANGES)[]).filter(
    (s) => s !== own,
  );
}

/**
 * SQL predicate excluding annotations whose evidence contains a foreign
 * script. Returns null when there is nothing to exclude, so the caller can
 * skip the clause entirely.
 *
 * Built with `chr()` rather than literal characters on purpose: the query text
 * stays pure ASCII, which matters because these statements travel through
 * base64/SSM/docker layers that mangle multi-byte literals.
 *
 * `column` is the full column expression, e.g. `a."aiText"`. A NULL column
 * cannot contain a foreign script, so NULLs are KEPT — evidence text is
 * nullable and dropping it would silently narrow the corpus.
 */
export function excludeForeignScripts(
  column: string,
  languageValue: string,
): string | null {
  const foreign = foreignScriptsFor(languageValue);
  if (foreign.length === 0) return null;
  const classBody = foreign
    .map((script) => {
      const [lo, hi] = SCRIPT_RANGES[script];
      return `chr(${lo}) || '-' || chr(${hi})`;
    })
    .join(' || ');
  return `(${column} IS NULL OR ${column} !~ ('[' || ${classBody} || ']'))`;
}
