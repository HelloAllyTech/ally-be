export const PROMPT_VERSION_RETENTION_LIMIT = 5;

/**
 * Prompt code of the system prompt that translates `main_agent`/`branching`
 * prompt templates into Indian languages (seeded by
 * AddAgentTemplateTranslationPrompt). Its `provider`/`model` select the engine.
 */
export const AGENT_TEMPLATE_TRANSLATION_PROMPT_CODE =
  'agent_template_translation';

/** Prompt types whose templates are eligible for auto-translation. */
export const TRANSLATABLE_PROMPT_TYPES = ['main_agent', 'branching'];

/** Total attempts (initial + retries) for one translation before marking failed. */
export const MAX_TRANSLATION_ATTEMPTS = 3;
