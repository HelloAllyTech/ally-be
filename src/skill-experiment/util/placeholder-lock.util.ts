import { createHash } from 'crypto';

/**
 * Every runtime slot syntax a System Skill can contain, as one pattern:
 *
 *  - `{{ name }}` — ally-be's `renderTemplate`, and a str.format escape in the
 *    Python runtimes. Either way the exact token must survive.
 *  - `{name}`     — str.format placeholders filled by ally-ai / ally-ai-learn
 *                   (including composed sections like `{SUPERVISOR_NOTE_SECTION}`
 *                   and state slots like `{state_x_guidelines}`).
 *  - `<name>`     — `renderTemplate`'s angle-bracket slots.
 *
 * Same three syntaxes `parseVariablesFromPrompt` recognises, so "a variable" means
 * the same thing here as in the System Skills chip list. Double braces are tried
 * first so `{{x}}` is one token, not `{x}` inside braces.
 */
const TOKEN_PATTERN =
  /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}|\{[A-Za-z_][A-Za-z0-9_]*\}|<[A-Za-z_][A-Za-z0-9_]*>/g;

/** The distinct placeholder tokens in a text, exactly as written, sorted. */
export function extractPlaceholderTokens(text: string): string[] {
  return [...new Set(text.match(TOKEN_PATTERN) ?? [])].sort();
}

/**
 * Single `{` / `}` characters that are neither part of a placeholder token nor a
 * `{{` / `}}` escape. In a str.format template any one of these raises at render
 * time — the Python runtimes either crash the call or silently fall back to the
 * raw template — so a skill that has none must never gain one.
 */
export function countLoneBraces(text: string): number {
  const stripped = text.replace(TOKEN_PATTERN, '').replace(/\{\{|\}\}/g, '');
  return (stripped.match(/[{}]/g) ?? []).length;
}

export interface PlaceholderLockResult {
  ok: boolean;
  /** Tokens in the original the candidate dropped. */
  missing: string[];
  /** Tokens in the candidate the original never had. */
  added: string[];
  /** The candidate introduced lone braces into a template that had none. */
  introducedLoneBraces: boolean;
  /** Human-readable reasons, fed back to the designer and shown to the admin. */
  errors: string[];
}

/**
 * The rule that a revised skill may never change its runtime contract: the exact
 * set of placeholder tokens is preserved (nothing dropped, renamed or invented)
 * and no brace syntax that would break str.format is introduced.
 *
 * Checked against the ORIGINAL skill text, not the champion it was revised from —
 * the original is what the call sites were written against.
 */
export function checkPlaceholderLock(
  original: string,
  candidate: string,
): PlaceholderLockResult {
  const originalTokens = new Set(extractPlaceholderTokens(original));
  const candidateTokens = new Set(extractPlaceholderTokens(candidate));
  const missing = [...originalTokens].filter((t) => !candidateTokens.has(t));
  const added = [...candidateTokens].filter((t) => !originalTokens.has(t));
  const introducedLoneBraces =
    countLoneBraces(original) === 0 && countLoneBraces(candidate) > 0;

  const errors: string[] = [];
  if (missing.length) {
    errors.push(`Dropped runtime placeholders: ${missing.join(', ')}`);
  }
  if (added.length) {
    errors.push(
      `Introduced placeholders the runtime never fills: ${added.join(', ')}`,
    );
  }
  if (introducedLoneBraces) {
    errors.push(
      'Introduced a lone "{" or "}". This template is filled with str.format, ' +
        'so literal braces must be written as "{{" and "}}".',
    );
  }
  return {
    ok: errors.length === 0,
    missing,
    added,
    introducedLoneBraces,
    errors,
  };
}

/** sha256 of a skill text, whitespace-trimmed — what "the text changed" means. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}
