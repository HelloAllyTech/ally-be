/**
 * Prompt code for the Agent Builder Copilot meta system prompt. Resolved via
 * PromptSharedService.getPromptByCode — falls back to the flat file
 * `src/prompts/agent_builder_system_prompt.txt` when no DB override exists.
 */
export const AGENT_BUILDER_PROMPT_CODE = 'agent_builder_system_prompt';

/**
 * Max output tokens for agent-builder generation. Higher than the autofill
 * default because a full roleplay-actor system prompt can be long.
 */
export const AGENT_BUILDER_MAX_TOKENS = 8192;

/** Max length (chars) accepted for the author's free-text agent description. */
export const AGENT_BUILDER_DESCRIPTION_MAX_LENGTH = 10000;
