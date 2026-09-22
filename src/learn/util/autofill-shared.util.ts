/**
 * Shared helpers for the studio AI text primitives that remain after the
 * generate/regenerate path was removed: field-level Enhance ("Improve") and the
 * Agent Builder Copilot. Both render a Prompt-Management template with runtime
 * variables and clean up the model's raw text.
 */

export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '')
    .replace(/<(\w+)>/g, (match, key) =>
      key in variables ? String(variables[key] ?? '') : match,
    );
}

/**
 * Default instruction used for an "auto-improve" (no specific direction).
 * Substituted into the `{{guidance}}` slot of the enhance prompt when the
 * author leaves the custom box blank.
 */
export const ENHANCE_AUTO_IMPROVE_INSTRUCTION =
  'Improve the overall quality, clarity, coherence and impact of the content ' +
  'while preserving its original meaning, intent and language.';

export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Pull the first JSON object out of a model response.
 *
 * Tries the whole string first, then falls back to the outermost `{ ... }`
 * span, so a JSON answer wrapped in an apology or a stray trailing sentence
 * still parses instead of dropping the whole generation. Returns null when
 * there is no object to be had — callers decide what an unparseable answer
 * means for their field.
 */
export function parseFirstJsonObject(raw: string): any {
  const attempt = (candidate: string): any => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(raw.trim());
  if (direct) return direct;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return attempt(raw.slice(start, end + 1));
}
