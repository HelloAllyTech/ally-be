/**
 * Guard that a translated prompt template preserved the tokens that must never
 * be translated:
 *
 * - **Placeholders** — single-brace `{name}` tokens that `SafeFormatter` fills
 *   at render time (`{name}`, `{language_label}`, `{next_instruction}`, …). A
 *   dropped or renamed placeholder silently breaks rendering, so this is the
 *   hard gate. The pattern matches `parse-variables.util.ts` (first char must be
 *   a letter/underscore), so literal JSON braces like `{"k": 1}` are ignored.
 * - **Audio tags** — bracketed TTS tokens such as `[laughs]`, `[sigh]`. Matched
 *   conservatively (lowercase-initial) so capitalized `[Section]` headings or
 *   markdown links aren't treated as tags.
 *
 * Comparison is count-aware (multiset): the same token appearing N times in the
 * source must appear N times in the output.
 */

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const AUDIO_TAG_RE = /\[([a-z][a-z0-9 _-]*)\]/g;

export interface TokenDiff {
  /** Tokens present in source but missing (or under-represented) in output. */
  missing: string[];
  /** Tokens present in output but absent (or over-represented) in source. */
  added: string[];
}

export interface TokenGuardResult {
  /** True when both placeholders and audio tags match as multisets. */
  ok: boolean;
  placeholders: TokenDiff;
  audioTags: TokenDiff;
}

/** Extract placeholder tokens (with surrounding braces), in order, with duplicates. */
export function extractPlaceholders(text: string): string[] {
  return matchAllTokens(text, PLACEHOLDER_RE);
}

/** Extract audio-tag tokens (with surrounding brackets), in order, with duplicates. */
export function extractAudioTags(text: string): string[] {
  return matchAllTokens(text, AUDIO_TAG_RE);
}

function matchAllTokens(text: string, re: RegExp): string[] {
  if (!text || typeof text !== 'string') return [];
  const tokens: string[] = [];
  for (const m of text.matchAll(re)) tokens.push(m[0]);
  return tokens;
}

function toCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Multiset difference: how `output` deviates from `source`. */
function diffMultiset(source: string[], output: string[]): TokenDiff {
  const src = toCounts(source);
  const out = toCounts(output);
  const missing: string[] = [];
  const added: string[] = [];

  for (const [token, srcCount] of src) {
    const deficit = srcCount - (out.get(token) ?? 0);
    for (let i = 0; i < deficit; i++) missing.push(token);
  }
  for (const [token, outCount] of out) {
    const surplus = outCount - (src.get(token) ?? 0);
    for (let i = 0; i < surplus; i++) added.push(token);
  }

  return { missing: missing.sort(), added: added.sort() };
}

/**
 * Validate that `output` preserved every placeholder and audio-tag token from
 * `source`. `ok` is true only when both multisets match exactly. Reordering
 * tokens is fine (multiset, not sequence); dropping, adding, or renaming is not.
 */
export function validateTranslationTokens(
  source: string,
  output: string,
): TokenGuardResult {
  const placeholders = diffMultiset(
    extractPlaceholders(source),
    extractPlaceholders(output),
  );
  const audioTags = diffMultiset(
    extractAudioTags(source),
    extractAudioTags(output),
  );

  const ok =
    placeholders.missing.length === 0 &&
    placeholders.added.length === 0 &&
    audioTags.missing.length === 0 &&
    audioTags.added.length === 0;

  return { ok, placeholders, audioTags };
}
