import { HelplineKeywordMatchType } from '../constants/helpline.constants';

/**
 * Text normalisation for keyword risk screening, with a map back to the
 * original string so a hit can be stored as offsets into the message body
 * (the body itself never leaves the messages table — invariant 5).
 *
 * The rules, and why:
 *  - NFKC: folds full-width and compatibility forms (ＳＵＩＣＩＤＥ → suicide) and
 *    composes Tamil/Kannada two-part vowel signs typed decomposed. NFKC is a
 *    superset of the NFC the contract names.
 *  - lowercase.
 *  - Unicode Marks `\p{M}` are KEPT. Devanagari vowel signs and virama, and
 *    Tamil vowel signs, are Marks, not Letters — a `[^\p{L}\p{N}]` strip turns
 *    "आत्महत्या" into "आत महत य", which matches nothing and silently disables
 *    screening for most of this audience (it happened once, in the WhatsApp
 *    matcher).
 *  - Devanagari nukta (U+093C) and ZWJ/ZWNJ are dropped: "ख़ुदकुशी" and
 *    "खुदकुशी" are both common spellings of one word, and joiners are
 *    rendering hints inside a word, not boundaries.
 *  - every other character (punctuation, symbols, emoji) becomes a word
 *    boundary, and whitespace runs collapse to one space.
 *
 * NFKC never composes across a boundary character, so each word is
 * normalised on its own and mapped back as a unit; inside a word whose length
 * is unchanged (the overwhelmingly common case) the map is exact per
 * character.
 */

const WORD_CHAR = /[\p{L}\p{M}\p{N}‌‍]/u;
const DROPPED = /[़‌‍]/gu;

export interface NormalisedText {
  text: string;
  /** For each UTF-16 index of `text`: the original index where it starts. */
  starts: number[];
  /** For each UTF-16 index of `text`: the original index just past it. */
  ends: number[];
}

const foldWord = (word: string): string =>
  word.normalize('NFKC').toLowerCase().replace(DROPPED, '');

export function normaliseForMatching(original: string): NormalisedText {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | null = null;

  const chars = Array.from(original);
  let index = 0;
  let i = 0;
  while (i < chars.length) {
    if (WORD_CHAR.test(chars[i])) {
      const wordStart = index;
      let word = '';
      while (i < chars.length && WORD_CHAR.test(chars[i])) {
        word += chars[i];
        index += chars[i].length;
        i += 1;
      }
      const wordEnd = index;
      const folded = foldWord(word);
      if (!folded) continue;

      if (pendingSpace && out.length > 0) {
        out.push(' ');
        starts.push(pendingSpace.start);
        ends.push(pendingSpace.end);
      }
      pendingSpace = null;

      const exact = folded.length === word.length;
      for (let k = 0; k < folded.length; k += 1) {
        out.push(folded[k]);
        starts.push(exact ? wordStart + k : wordStart);
        ends.push(exact ? wordStart + k + 1 : wordEnd);
      }
    } else {
      const start = index;
      index += chars[i].length;
      i += 1;
      pendingSpace = pendingSpace
        ? { start: pendingSpace.start, end: index }
        : { start, end: index };
    }
  }

  return { text: out.join(''), starts, ends };
}

/** The normalised form of a rule phrase (no offsets needed). */
export function normalisePhrase(phrase: string): string {
  return normaliseForMatching(phrase).text;
}

export interface PhraseMatch {
  /** Offsets into the ORIGINAL string, end-exclusive. */
  start: number;
  end: number;
}

/**
 * First occurrence of `needle` (already normalised) in `haystack`.
 *
 * WORD requires the match to start and end on a word boundary of the
 * normalised text — a space or either end, since normalisation leaves only
 * letters, marks, digits and single spaces. CONTAINS is a plain substring.
 */
export function findPhrase(
  haystack: NormalisedText,
  needle: string,
  matchType: HelplineKeywordMatchType,
): PhraseMatch | null {
  if (!needle) return null;
  const text = haystack.text;
  let from = 0;
  while (from <= text.length - needle.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) return null;
    const endAt = at + needle.length;
    const boundaryOk =
      matchType === HelplineKeywordMatchType.CONTAINS ||
      ((at === 0 || text[at - 1] === ' ') &&
        (endAt === text.length || text[endAt] === ' '));
    if (boundaryOk) {
      return { start: haystack.starts[at], end: haystack.ends[endAt - 1] };
    }
    from = at + 1;
  }
  return null;
}
