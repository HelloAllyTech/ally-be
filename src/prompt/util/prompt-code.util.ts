/**
 * Builds promptCode from folder path. Matches PromptsSyncService convention:
 * subdir/filename.txt -> subdir_filename
 *
 * Use when fetching prompts via getPromptByCode(). Keeps code in sync with
 * src/prompts/ — add a file, use toPromptCode(subdir, filename), no central enum.
 *
 * @example
 * toPromptCode('openai_translation', 'session_event') // 'openai_translation_session_event'
 * toPromptCode('openai_simulation', 'character_profile_text') // 'openai_simulation_character_profile_text'
 */
export function toPromptCode(subdir: string, filename: string): string {
  return `${subdir}_${filename}`;
}

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
