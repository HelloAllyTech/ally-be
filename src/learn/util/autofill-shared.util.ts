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
