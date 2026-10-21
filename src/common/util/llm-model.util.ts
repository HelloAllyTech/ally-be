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
 * Claude models known to accept a custom `temperature`.
 *
 * Claude Opus 4.7 and 4.8, Opus 5 and 5.5, Sonnet 5, Fable 5 and 5.1 (and
 * Mythos) reject `temperature` outright with a 400; Sonnet 5.5 and Haiku 5.5
 * reject any non-default value, so omitting it is the only safe request. Since
 * nothing suggests the releases after them will take it back, these patterns
 * name the models that DO accept it: 3.x, Opus and Sonnet 4.0 to 4.6, and
 * Haiku 4.5. An optional trailing date snapshot is allowed where the API
 * issues one (`claude-opus-4-20250514`, `claude-haiku-4-5-20251001`).
 */
const TEMPERATURE_CLAUDE_MODELS: RegExp[] = [
  /^claude-3/,
  /^claude-(opus|sonnet)-4(-[0-6])?(-\d{8})?$/,
  /^claude-haiku-4-5(-\d{8})?$/,
];

/**
 * Whether a Claude model accepts a custom `temperature`. An allowlist, so an
 * unrecognised Claude model — including the next release — answers false:
 * guessing wrong that way costs the caller's tuning, guessing wrong the other
 * way costs the call.
 */
const claudeModelAcceptsTemperature = (name: string): boolean =>
  TEMPERATURE_CLAUDE_MODELS.some((pattern) => pattern.test(name));

/**
 * Whether a model accepts a custom `temperature`. OpenAI reasoning models
 * (o-series, gpt-5 family) only allow the default and 400 on any other value;
 * Gemini 3+ deprecated it (see {@link isGemini3OrLater}); Claude models from
 * Opus 4.7 on reject it (see {@link TEMPERATURE_CLAUDE_MODELS}).
 * Other unknown/empty models default to true.
 */
export const modelSupportsTemperature = (model?: string | null): boolean => {
  if (!model) return true;
  const name = model.trim().toLowerCase();
  if (name.startsWith('claude')) return claudeModelAcceptsTemperature(name);
  return !(
    name.startsWith('o1') ||
    name.startsWith('o3') ||
    name.startsWith('o4') ||
    name.startsWith('gpt-5') ||
    isGemini3OrLater(name)
  );
};

/**
 * Claude models known to accept a forced `tool_choice` (`any` / `tool`).
 *
 * Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject one with a 400
 * ("tool_choice: type 'tool' and 'any' are not supported for this model"),
 * and nothing suggests the releases after them will take it back. So these
 * patterns name the models that DO accept it: 3.x and 4.x, the bare 5 of each
 * line (`claude-opus-5`, not `claude-opus-5-5`), and Haiku 5.5. An optional
 * trailing date snapshot is allowed where the API issues one.
 */
const FORCED_TOOL_CHOICE_MODELS: RegExp[] = [
  /^claude-3/,
  /^claude-(opus|sonnet|haiku)-4(-|$)/,
  /^claude-(opus|sonnet|fable|mythos)-5(-\d{8})?$/,
  /^claude-haiku-5-5(-\d{8})?$/,
];

/**
 * Whether a Claude model accepts a forced `tool_choice`. An allowlist, so an
 * unrecognised model — including the next release — answers false: guessing
 * wrong that way costs a weaker guarantee, guessing wrong the other way costs
 * the call.
 */
export const claudeModelAcceptsForcedToolChoice = (
  model?: string | null,
): boolean => {
  if (!model) return false;
  const name = model.trim().toLowerCase();
  return FORCED_TOOL_CHOICE_MODELS.some((pattern) => pattern.test(name));
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
