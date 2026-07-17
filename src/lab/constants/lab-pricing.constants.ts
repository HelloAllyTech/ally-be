/**
 * Per-model pricing used to estimate the USD cost of an AI Lab run. The LLM
 * model registry does not carry pricing, so it lives here. Prices are USD per
 * 1M tokens (input / output) and are approximate — they exist for relative
 * comparison across runs, not billing. Update as provider pricing changes.
 */
export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens. */
  outputPer1M: number;
}

const PRICING: Record<string, ModelPrice> = {
  // Anthropic (ally-be runtime)
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10 },
};

/**
 * Estimate the USD cost of a run from its token usage. Returns null when the
 * model has no known price (so the caller stores null rather than a wrong 0).
 */
export const estimateCostUsd = (
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number | null => {
  const price = PRICING[modelId];
  if (!price) return null;
  const cost =
    (promptTokens / 1_000_000) * price.inputPer1M +
    (completionTokens / 1_000_000) * price.outputPer1M;
  // Round to 6 dp to match the numeric(12,6) column.
  return Math.round(cost * 1_000_000) / 1_000_000;
};
