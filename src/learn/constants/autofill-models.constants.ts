/**
 * Preferred chat models for autofill. Display order.
 * Only models in this list that are returned by the OpenAI API are shown.
 * If a model is deprecated, remove it from this list.
 */
export const PREFERRED_AUTOFILL_MODELS = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
] as const;

/**
 * Anthropic models available for autofill. Hardcoded since Anthropic has no list-models endpoint.
 * Order determines display priority.
 */
export const PREFERRED_ANTHROPIC_AUTOFILL_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;
