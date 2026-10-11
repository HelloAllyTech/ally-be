/**
 * Helpers for applying prompt-level LLM model/temperature overrides on ally-be's
 * own LLM call sites (coaching chat, tooltip translation, autofill, copilot).
 *
 * The provider/model lists the runtimes can actually run differ per call site;
 * these helpers keep the guards consistent. See
 * prompt-llm-config-standardization-adr.md for the longer-term plan to replace
 * the prefix heuristics with an explicit provider + a shared model registry.
 */

/** True when a model name looks like an OpenAI model. */
export const isOpenAiModel = (model?: string | null): boolean => {
  if (!model) return false;
  const name = model.trim().toLowerCase();
  return (
    name.startsWith('gpt') ||
    name.startsWith('o1') ||
    name.startsWith('o3') ||
    name.startsWith('o4') ||
    name.startsWith('chatgpt') ||
    name.startsWith('text-') ||
    name.startsWith('davinci')
  );
};

/**
 * Whether a prompt-level override resolves to OpenAI. Prefers the explicit
 * `provider` when present, else falls back to inferring from the model name.
 * Used by OpenAI-only call sites (coaching chat) to decide whether to apply a
 * prompt's model override.
 */
export const resolvesToOpenAi = (
  provider?: string | null,
  model?: string | null,
): boolean =>
  provider ? provider.trim().toLowerCase() === 'openai' : isOpenAiModel(model);

/** True when a model name looks like a Gemini model. */
export const isGeminiModel = (model?: string | null): boolean =>
  !!model && model.trim().toLowerCase().startsWith('gemini');

/**
 * Resolve the chat provider + model from a prompt-level override, against the
 * providers the coaching chat can actually run (OpenAI + Gemini). Prefers the
 * explicit `provider`; falls back to inferring from the model name. When the
 * override doesn't resolve to a runnable provider/model, returns the
 * code-default OpenAI provider + model so the chat never breaks.
 */
export const resolveChatProviderModel = (
  promptProvider: string | undefined | null,
  promptModel: string | undefined | null,
  defaultModel: string,
): { providerType: string; model: string } => {
  if (promptModel && resolvesToOpenAi(promptProvider, promptModel)) {
    return { providerType: 'openai', model: promptModel };
  }
  const isGemini = promptProvider
    ? promptProvider.trim().toLowerCase() === 'gemini'
    : isGeminiModel(promptModel);
  if (promptModel && isGemini) {
    return { providerType: 'gemini', model: promptModel };
  }
  return { providerType: 'openai', model: defaultModel };
};

/**
 * Gemini 3 onwards: Google deprecated custom sampling (`temperature`, `top_p`,
 * `top_k`) and `thinking_budget` for this family, and models after Gemini 3
 * reject them with a 400. The `-latest` aliases are included because they
 * move to the newest model without the id changing.
 */
export const isGemini3OrLater = (model?: string | null): boolean => {
  if (!model) return false;
  const name = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');
  if (!name.startsWith('gemini-')) return false;
  if (name.endsWith('-latest')) return true;
  const major = /^gemini-(\d+)/.exec(name)?.[1];
  return major !== undefined && Number(major) >= 3;
};

/**
 * Whether a model accepts a custom `temperature`. OpenAI reasoning models
 * (o-series, gpt-5 family) only allow the default and 400 on any other value;
 * Gemini 3+ deprecated it (see {@link isGemini3OrLater}).
 * Unknown/empty models default to true.
 */
export const modelSupportsTemperature = (model?: string | null): boolean => {
  if (!model) return true;
  const name = model.trim().toLowerCase();
  return !(
    name.startsWith('o1') ||
    name.startsWith('o3') ||
    name.startsWith('o4') ||
    name.startsWith('gpt-5') ||
    isGemini3OrLater(name)
  );
};

/**
 * Resolve the effective temperature for a call site given the precedence
 * sources (later args win): code default → prompt-level → request/simulation.
 * Returns undefined (omit) when the chosen model rejects a custom temperature.
 */
export const resolveTemperature = (
  model: string | undefined,
  codeDefault: number | undefined,
  promptLevel: number | undefined | null,
  override: number | undefined | null,
): number | undefined => {
  let temperature = codeDefault;
  if (typeof promptLevel === 'number') temperature = promptLevel;
  if (typeof override === 'number') temperature = override;
  if (temperature === undefined) return undefined;
  return modelSupportsTemperature(model) ? temperature : undefined;
};
