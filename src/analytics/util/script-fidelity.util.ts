/**
 * Script fidelity (PRD §6.1): % of AI turns whose target-script rendering is
 * clean — a Unicode-block check that isolates RENDERING/ENCODING failures
 * (mojibake, replacement chars, foreign-script intrusions), not the model's
 * language choice. Objective and automatable; thresholds ≥95 good / 85–95
 * warn / <85 critical are applied at display time.
 *
 * Latin letters are always tolerated alongside the target script because
 * code-switching with English is expected, correct behavior (judged
 * separately by the codeswitch dimension) — this metric must not punish it.
 */

const SCRIPT_RANGES: Record<string, Array<[number, number]>> = {
  latin: [
    [0x0041, 0x005a],
    [0x0061, 0x007a],
    [0x00c0, 0x024f],
  ],
  devanagari: [[0x0900, 0x097f]],
  bengali: [[0x0980, 0x09ff]],
  gurmukhi: [[0x0a00, 0x0a7f]],
  gujarati: [[0x0a80, 0x0aff]],
  odia: [[0x0b00, 0x0b7f]],
  tamil: [[0x0b80, 0x0bff]],
  telugu: [[0x0c00, 0x0c7f]],
  kannada: [[0x0c80, 0x0cff]],
  malayalam: [[0x0d00, 0x0d7f]],
  arabic: [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
  ],
};

/** Fallback script per language-code prefix, used when evalConfig is empty. */
const DEFAULT_LANGUAGE_SCRIPT: Record<string, string> = {
  en: 'latin',
  hi: 'devanagari',
  mr: 'devanagari',
  bn: 'bengali',
  as: 'bengali',
  pa: 'gurmukhi',
  gu: 'gujarati',
  or: 'odia',
  od: 'odia',
  ta: 'tamil',
  te: 'telugu',
  kn: 'kannada',
  ml: 'malayalam',
  ur: 'arabic',
};

export function scriptForLanguage(
  language: string | null | undefined,
  evalConfigScript?: string | null,
): string | null {
  if (evalConfigScript && SCRIPT_RANGES[evalConfigScript])
    return evalConfigScript;
  const prefix = (language ?? '').toLowerCase().split('-')[0];
  return DEFAULT_LANGUAGE_SCRIPT[prefix] ?? null;
}

const inRanges = (cp: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

const isLetter = (ch: string): boolean => /\p{L}/u.test(ch);

/** A single turn is clean when it has no rendering failures and its letters
 *  belong to the target script (or Latin, for code-switching). */
export function isTurnScriptClean(text: string, script: string): boolean {
  const ranges = SCRIPT_RANGES[script];
  if (!ranges) return true;
  let letters = 0;
  let inScript = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Rendering failures: replacement char, or C0/C1 controls beyond whitespace.
    if (cp === 0xfffd) return false;
    if (cp < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t') return false;
    if (!isLetter(ch)) continue;
    letters += 1;
    if (inRanges(cp, ranges) || inRanges(cp, SCRIPT_RANGES.latin))
      inScript += 1;
  }
  if (letters === 0) return true; // punctuation/number-only turns are fine
  return inScript / letters >= 0.98;
}

/** % of turns clean in the target script; null when the script is unknown. */
export function computeScriptFidelityPct(
  texts: string[],
  script: string | null,
): number | null {
  if (!script || !SCRIPT_RANGES[script] || texts.length === 0) return null;
  const clean = texts.filter((t) => isTurnScriptClean(t ?? '', script)).length;
  return Math.round((clean / texts.length) * 10000) / 100;
}
