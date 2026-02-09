/**
 * Converts a prompt code string to the standard format: lowercase_with_underscores
 * Examples:
 * - "AI Learn" -> "ai_learn"
 * - "learn prompt" -> "learn_prompt"
 * - "my prompt code" -> "my_prompt_code"
 */
export function standardizePromptCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .replace(/_+/g, '_'); // Replace multiple underscores with single underscore
}
