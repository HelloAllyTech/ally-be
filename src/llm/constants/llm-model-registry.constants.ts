import { modelSupportsTemperature } from 'src/common/util/llm-model.util';

/**
 * Single source of truth for the LLM models the platform offers, replacing the
 * previously-drifting per-app/per-service lists. Exposed via GET /api/v1/llm/models
 * and consumed by the web clients (and, over time, validated against by the
 * runtimes). See prompt-llm-config-standardization-adr.md.
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

// Runtime support sets. Gemini now runs in all three runtimes: ai-learn's
// general LLM path, ally-ai text-gen (langchain-google-genai), and ally-be's
// coaching chat (@google/genai). Anthropic remains ally-be-only (autofill /
// copilot). See prompt-llm-config-standardization-adr.md.
const OPENAI_RUNTIMES = [
  LlmRuntime.AI_LEARN,
  LlmRuntime.ALLY_AI,
  LlmRuntime.ALLY_BE,
];
const GEMINI_RUNTIMES = [
  LlmRuntime.AI_LEARN,
  LlmRuntime.ALLY_AI,
  LlmRuntime.ALLY_BE,
];
const ANTHROPIC_RUNTIMES = [LlmRuntime.ALLY_BE];

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
  entry('gemini', 'gemini-2.0-flash', 'Gemini 2.0 Flash', GEMINI_RUNTIMES),
  entry('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6', ANTHROPIC_RUNTIMES),
  entry('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', ANTHROPIC_RUNTIMES),
  entry('anthropic', 'claude-opus-4-7', 'Claude Opus 4.7', ANTHROPIC_RUNTIMES),
];

/** Registry filtered to models a given runtime can run (all when omitted). */
export const getLlmModels = (runtime?: LlmRuntime): LlmModelInfo[] =>
  runtime
    ? LLM_MODEL_REGISTRY.filter((m) => m.runtimes.includes(runtime))
    : LLM_MODEL_REGISTRY;
