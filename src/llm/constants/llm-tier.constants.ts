/**
 * Platform model tiers — the last layer before the hardcoded floor.
 *
 * Why this exists at all: every one-shot LLM caller in ally-be used to read
 * `configService.anthropic.autofillModel` and build its own
 * `new Anthropic(...)`. The model and the SDK were one decision, taken
 * separately in ten services, so "run this task somewhere else" was a code
 * change rather than a config change — and `ANTHROPIC_AUTOFILL_MODEL` was
 * serving as a platform-wide default under a vendor's name. When the Anthropic
 * key expired, all ten failed at once with no way to move them.
 *
 * So a caller declares what the call NEEDS — a cheap fast turn, or one worth
 * reasoning tokens — and the tier says which model currently serves that need.
 * The tier belongs at the call site, next to `maxTokens`: "this call needs
 * reasoning" is a property of the call, not a row someone edits. Which model a
 * tier resolves to is config, so retiering the platform is two env vars and no
 * call site learns a vendor's name.
 *
 * This is deliberately NOT a task -> model map. Which tier a task uses is on
 * its AI-task-registry row, and a per-prompt override lives on the prompt row;
 * a map here would be a third place to look and the first to go stale.
 */
export enum LlmModelTier {
  /**
   * Latency-sensitive or mechanical work: a short transform, a classification,
   * a rewrite. Cost and time-to-first-token dominate correctness headroom.
   */
  FAST = 'fast',
  /**
   * Work where a wrong answer is expensive and the caller can afford to wait:
   * grading against a rubric, folding memory, triaging an analytics window.
   */
  REASONING = 'reasoning',
}

/**
 * Compiled-in floor per tier, used when no env var and no config row supplies
 * a model.
 *
 * OpenAI on both tiers deliberately, and not as a vendor preference: it is the
 * one provider every runtime in this platform already holds a working key for,
 * which is the only property that makes a fallback worth having. A floor that
 * points at a provider whose credentials can lapse is not a floor.
 */
export const LLM_TIER_FLOOR: Record<LlmModelTier, string> = {
  [LlmModelTier.FAST]: 'gpt-4o-mini',
  [LlmModelTier.REASONING]: 'gpt-5-mini',
};

/** Env var supplying each tier's model, overriding the floor above. */
export const LLM_TIER_ENV_VAR: Record<LlmModelTier, string> = {
  [LlmModelTier.FAST]: 'LLM_FAST_MODEL',
  [LlmModelTier.REASONING]: 'LLM_REASONING_MODEL',
};
