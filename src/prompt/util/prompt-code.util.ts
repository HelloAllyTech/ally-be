/**
 * Converts a prompt code string to the standard format: lowercase_with_underscores
 * Examples:
 * - "AI Learn" -> "ally_ai_learn"
 * - "learn prompt" -> "ally_learn_prompt"
 * - "my prompt code" -> "ally_my_prompt_code"
 */
export function standardizePromptCode(code: string): string {
  return (
    'ally_' +
    code
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .replace(/_+/g, '_') // Replace multiple underscores with single underscore
  );
}
