/**
 * Turns rendered with NO target-script content at all — the actor answering a
 * Hindi session in English, or in romanised Hindi.
 *
 * This exists because nothing measured it. Script fidelity deliberately
 * tolerates Latin letters so that code-switching is not punished
 * (`isTurnScriptClean` counts Latin as in-script), which is correct for what it
 * measures — rendering and encoding failures — but means a turn that is 100%
 * Latin scores a perfect 1.0. hi-IN reported 99.3% script fidelity over a
 * corpus containing fully English turns. The `codeswitch` judge dimension
 * should have caught those and fired once in 429 hi-IN turns.
 *
 * Deterministic on purpose. It needs no judge, so it covers all history the
 * moment it ships and costs nothing to recompute when the rule changes — which
 * is the opposite of the rubric fix this replaced.
 */

/**
 * Target script per language prefix, as Unicode code-point bounds.
 *
 * Only languages with a NON-Latin script appear. A language written in Latin
 * has no "wrong script" to detect, and including it would flag every turn.
 */
export const TARGET_SCRIPT_RANGES: Record<string, [number, number]> = {
  hi: [0x0900, 0x097f], // Devanagari
  mr: [0x0900, 0x097f],
  bn: [0x0980, 0x09ff],
  as: [0x0980, 0x09ff],
  pa: [0x0a00, 0x0a7f],
  gu: [0x0a80, 0x0aff],
  or: [0x0b00, 0x0b7f],
  ta: [0x0b80, 0x0bff],
  te: [0x0c00, 0x0c7f],
  kn: [0x0c80, 0x0cff],
  ml: [0x0d00, 0x0d7f],
  ur: [0x0600, 0x06ff], // Arabic
};

/**
 * Letters a turn needs before it can be judged off-language.
 *
 * Short turns are legitimately script-free — "Hmm", "Okay", a name — and
 * flagging them would bury the real signal in noise. Fifteen letters is about
 * three words, which is where a turn starts making a language choice rather
 * than an interjection.
 */
export const MIN_LETTERS_FOR_LANGUAGE_CHECK = 15;

const letterCount = (text: string): number =>
  (text.match(/\p{L}/gu) ?? []).length;

/** The script bounds for a language tag, or null when it is Latin-scripted. */
export function targetScriptRange(
  language: string | null | undefined,
): [number, number] | null {
  const prefix = (language ?? '').toLowerCase().split('-')[0];
  return TARGET_SCRIPT_RANGES[prefix] ?? null;
}

/**
 * Whether a turn is eligible to be checked at all: long enough to have made a
 * language choice, in a language that HAS a non-Latin script.
 */
export function isEligibleForLanguageCheck(
  text: string,
  language: string | null | undefined,
): boolean {
  if (!targetScriptRange(language)) return false;
  return letterCount(text ?? '') >= MIN_LETTERS_FOR_LANGUAGE_CHECK;
}

/**
 * True when an eligible turn contains NOT ONE character of the target script.
 *
 * Zero, not "mostly Latin". Heavy code-mixing is normal, correct speech —
 * "maybe मैं overthink कर रही हूँ" is what an urban Hindi speaker actually
 * says, and a proportional threshold would flag it. Only the complete absence
 * of the target script is unambiguous.
 */
export function isTurnOffLanguage(
  text: string,
  language: string | null | undefined,
): boolean {
  const range = targetScriptRange(language);
  if (!range) return false;
  if (!isEligibleForLanguageCheck(text, language)) return false;
  const [lo, hi] = range;
  for (const ch of text ?? '') {
    const cp = ch.codePointAt(0)!;
    if (cp >= lo && cp <= hi) return false;
  }
  return true;
}

/** Off-language turns and the eligible turns they are measured against. */
export function countOffLanguage(
  texts: string[],
  language: string | null | undefined,
): { offLanguage: number; eligible: number } {
  let offLanguage = 0;
  let eligible = 0;
  for (const t of texts ?? []) {
    if (!isEligibleForLanguageCheck(t ?? '', language)) continue;
    eligible += 1;
    if (isTurnOffLanguage(t ?? '', language)) offLanguage += 1;
  }
  return { offLanguage, eligible };
}

/**
 * The same rule as SQL, for the read path that aggregates over the whole
 * corpus without loading it into memory.
 *
 * `chr()` rather than a literal character class: the bounds stay readable as
 * code points and cannot be mangled by an editor or a copy-paste that
 * normalises the string.
 */
export function offLanguageSql(contentExpr: string, langExpr: string): string {
  const rows = Object.entries(TARGET_SCRIPT_RANGES)
    .map(([lang, [lo, hi]]) => `('${lang}',${lo},${hi})`)
    .join(',');
  return `EXISTS (
    SELECT 1 FROM (VALUES ${rows}) AS r(lang, lo, hi)
     WHERE r.lang = lower(split_part(${langExpr}, '-', 1))
       AND ${contentExpr} !~ ('[' || chr(r.lo) || '-' || chr(r.hi) || ']'))`;
}

/** Eligibility in SQL: a non-Latin language, and enough letters to have chosen. */
export function languageCheckEligibleSql(
  contentExpr: string,
  langExpr: string,
): string {
  const langs = Object.keys(TARGET_SCRIPT_RANGES)
    .map((l) => `'${l}'`)
    .join(',');
  return `(lower(split_part(${langExpr}, '-', 1)) IN (${langs})
    AND length(regexp_replace(${contentExpr}, '[^[:alpha:]]', '', 'g'))
        >= ${MIN_LETTERS_FOR_LANGUAGE_CHECK})`;
}
