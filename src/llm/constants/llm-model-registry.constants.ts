import { modelSupportsTemperature } from 'src/common/util/llm-model.util';

/**
 * The LLM models the platform offers.
 *
 * As of the `llm_models` catalog table this array is no longer the live source:
 * it seeds that table, and `LlmModelService` falls back to it when the table is
 * empty or unreadable. The fallback is the point — without it, one bad migration
 * would empty every model picker in the product at once.
 *
 * Exposed via GET /api/v1/llm/models. See prompt-llm-config-standardization-adr.md.
 */

export type LlmProviderName =
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'ollama'
  | 'vllm';

/** Runtimes that execute LLM calls. A model is only usable on a prompt whose
 *  consuming runtime appears in the model's `runtimes`. */
export enum LlmRuntime {
  AI_LEARN = 'ai-learn',
  ALLY_AI = 'ally-ai',
  ALLY_BE = 'ally-be',
}

export interface LlmModelInfo {
  provider: LlmProviderName;
  /** Model id passed to the provider (e.g. 'gpt-4o', 'gemini-2.5-pro'). */
  model: string;
  /** Human-readable label for the picker. */
  label: string;
  /** Whether the model accepts a custom temperature (false for reasoning models). */
  supportsTemperature: boolean;
  /** Runtimes that can actually instantiate/run this model today. */
  runtimes: LlmRuntime[];
}

/**
 * Which runtimes can execute each provider.
 *
 * This is the one part of a model's description that is a fact about *deployed
 * code* rather than data: Gemini runs in all three runtimes (ai-learn's general
 * LLM path, ally-ai text-gen via langchain-google-genai, ally-be's coaching chat
 * via @google/genai), while Anthropic remains ally-be-only because ai-learn's
 * `app/llms/factory.py` has no Anthropic branch.
 *
 * It hangs off the PROVIDER, not the model — every OpenAI model runs wherever
 * the OpenAI client is wired — which is why the model catalog can live in the
 * database while this stays in code. Adding a model is data; adding a provider
 * is a code change. See prompt-llm-config-standardization-adr.md.
 */
export const PROVIDER_RUNTIME_MATRIX: Record<LlmProviderName, LlmRuntime[]> = {
  openai: [LlmRuntime.AI_LEARN, LlmRuntime.ALLY_AI, LlmRuntime.ALLY_BE],
  gemini: [LlmRuntime.AI_LEARN, LlmRuntime.ALLY_AI, LlmRuntime.ALLY_BE],
  anthropic: [LlmRuntime.ALLY_BE],
  // Self-hosted runtimes. Only the voice agent can reach them —
  // ally-ai-learn's factory has OLLAMA and VLLM branches pointing at
  // OLLAMA_BASE_URL / the vLLM endpoint, which live alongside that worker.
  // ally-be and ally-ai have no client for either, and nothing outside the
  // voice runtime's network can call them, which is also why the LLM preview
  // reports them as un-testable from here rather than failing obscurely.
  ollama: [LlmRuntime.AI_LEARN],
  vllm: [LlmRuntime.AI_LEARN],
};

/**
 * Alternative spellings accepted for a provider, mapped to the canonical name.
 *
 * `gemini` is canonical because that is what the voice runtime's `LLMProvider`
 * enum calls it (ally-ai-learn `app/core/constants.py`). `google` exists only in
 * ally-be's `LLM_CONFIG_SCHEMA` and the admin dropdown, and is what every
 * Gemini `llm_configs` row and language jsonb currently stores.
 *
 * The runtime already treats the two as one — `factory.py` has an explicit
 * `provider == LLMProvider.GEMINI or provider == "google"` branch — so this
 * mirrors a decision already made rather than inventing one.
 *
 * Codified as an alias rather than migrated away. Rewriting stored `google` to
 * `gemini` would be the same hazard as the voice-provider casing migration that
 * had to be reverted: ally-be deploys before the clients, so between the two
 * there would be a window where the admin dropdown (which offers `google`)
 * cannot match the stored value, and saving silently rewrites the field.
 */
const PROVIDER_ALIASES: Record<string, LlmProviderName> = {
  google: 'gemini',
};

/** Canonical provider name for any accepted spelling; '' when unrecognised. */
export const canonicalProvider = (provider?: string | null): string => {
  const name = String(provider ?? '')
    .trim()
    .toLowerCase();
  return PROVIDER_ALIASES[name] ?? name;
};

/** Runtimes for a provider; empty for a provider the code cannot run at all. */
export const runtimesForProvider = (provider: string): LlmRuntime[] =>
  PROVIDER_RUNTIME_MATRIX[canonicalProvider(provider) as LlmProviderName] ?? [];

const OPENAI_RUNTIMES = PROVIDER_RUNTIME_MATRIX.openai;
const GEMINI_RUNTIMES = PROVIDER_RUNTIME_MATRIX.gemini;
const ANTHROPIC_RUNTIMES = PROVIDER_RUNTIME_MATRIX.anthropic;

const entry = (
  provider: LlmProviderName,
  model: string,
  label: string,
  runtimes: LlmRuntime[],
): LlmModelInfo => ({
  provider,
  model,
  label,
  // Single rule for temperature support, shared with the runtime guards.
  supportsTemperature: modelSupportsTemperature(model),
  runtimes,
});

export const LLM_MODEL_REGISTRY: LlmModelInfo[] = [
  entry('openai', 'gpt-4.1', 'GPT-4.1', OPENAI_RUNTIMES),
  entry('openai', 'gpt-4.1-mini', 'GPT-4.1 mini', OPENAI_RUNTIMES),
  entry('openai', 'gpt-4o', 'GPT-4o', OPENAI_RUNTIMES),
  entry('openai', 'gpt-4o-mini', 'GPT-4o mini', OPENAI_RUNTIMES),
  // gpt-5 family is offered but supportsTemperature=false (reasoning models),
  // so the picker can disable the temperature control rather than hide them.
  entry('openai', 'gpt-5', 'GPT-5', OPENAI_RUNTIMES),
  entry('openai', 'gpt-5-mini', 'GPT-5 mini', OPENAI_RUNTIMES),
  entry('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', GEMINI_RUNTIMES),
  entry('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', GEMINI_RUNTIMES),
  entry(
    'anthropic',
    'claude-sonnet-4-6',
    'Claude Sonnet 4.6',
    ANTHROPIC_RUNTIMES,
  ),
  entry(
    'anthropic',
    'claude-haiku-4-5',
    'Claude Haiku 4.5',
    ANTHROPIC_RUNTIMES,
  ),
  entry('anthropic', 'claude-opus-4-7', 'Claude Opus 4.7', ANTHROPIC_RUNTIMES),
];

/** Registry filtered to models a given runtime can run (all when omitted). */
export const getLlmModels = (runtime?: LlmRuntime): LlmModelInfo[] =>
  runtime
    ? LLM_MODEL_REGISTRY.filter((m) => m.runtimes.includes(runtime))
    : LLM_MODEL_REGISTRY;
