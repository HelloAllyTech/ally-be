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

export type LlmProviderName = 'openai' | 'gemini' | 'anthropic';

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
};

/** Runtimes for a provider; empty for a provider the code cannot run at all. */
export const runtimesForProvider = (provider: string): LlmRuntime[] =>
  PROVIDER_RUNTIME_MATRIX[String(provider).toLowerCase() as LlmProviderName] ??
  [];

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
