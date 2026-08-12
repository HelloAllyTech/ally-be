import {
  canonicalProvider,
  getLlmModels,
  LLM_MODEL_REGISTRY,
  LlmRuntime,
  PROVIDER_RUNTIME_MATRIX,
  runtimesForProvider,
} from '../llm-model-registry.constants';

describe('provider × runtime matrix', () => {
  /**
   * The serving layer drops any model whose provider has no runtimes, so a
   * provider added to the fallback list without a matrix entry would disappear
   * from every picker with only a log line. Catch it here instead.
   */
  it('covers every provider in the fallback list', () => {
    const uncovered = [
      ...new Set(LLM_MODEL_REGISTRY.map((entry) => entry.provider)),
    ].filter((provider) => runtimesForProvider(provider).length === 0);

    expect(uncovered).toEqual([]);
  });

  it('is case-insensitive, since the DB stores provider as free text', () => {
    expect(runtimesForProvider('OpenAI')).toEqual(
      PROVIDER_RUNTIME_MATRIX.openai,
    );
    expect(runtimesForProvider('ANTHROPIC')).toEqual(
      PROVIDER_RUNTIME_MATRIX.anthropic,
    );
  });

  it('returns nothing for a provider the code cannot run', () => {
    expect(runtimesForProvider('cohere')).toEqual([]);
  });

  // Self-hosted providers were selectable as llm_configs before the catalog
  // replaced that layer; dropping them would be a silent loss of capability.
  // Only the voice agent can reach them — ally-be and ally-ai have no client.
  it.each(['ollama', 'vllm'])(
    'keeps %s available, voice-runtime only',
    (provider) => {
      expect(runtimesForProvider(provider)).toEqual([LlmRuntime.AI_LEARN]);
      expect(runtimesForProvider(provider)).not.toContain(LlmRuntime.ALLY_BE);
      expect(runtimesForProvider(provider)).not.toContain(LlmRuntime.ALLY_AI);
    },
  );

  // 'google' is what every Gemini llm_configs row and language jsonb stores;
  // 'gemini' is what the voice runtime's enum calls it. ai-learn already treats
  // them as one (factory.py: `provider == GEMINI or provider == "google"`), so
  // ally-be must too, or a stored 'google' resolves to no runtime and its
  // models get dropped from every picker.
  it('accepts google as an alias for gemini', () => {
    expect(canonicalProvider('google')).toBe('gemini');
    expect(canonicalProvider('GOOGLE')).toBe('gemini');
    expect(canonicalProvider(' Google ')).toBe('gemini');
    expect(runtimesForProvider('google')).toEqual(
      PROVIDER_RUNTIME_MATRIX.gemini,
    );
  });

  it('leaves a canonical or unknown name untouched', () => {
    expect(canonicalProvider('openai')).toBe('openai');
    expect(canonicalProvider('gemini')).toBe('gemini');
    expect(canonicalProvider('cohere')).toBe('cohere');
    expect(canonicalProvider(undefined)).toBe('');
  });

  // ai-learn's app/llms/factory.py has no Anthropic branch. If that changes,
  // this test should be updated deliberately — not discovered in production.
  it('keeps Anthropic out of the voice runtime', () => {
    // ALLY_AI was added for the WhatsApp knowledge agent (admin-selectable answer model, backed by
    // the raw `anthropic` SDK in ally-ai's app/core/llm/dispatch.py). AI_LEARN deliberately still
    // is not here — that factory has no Anthropic branch, so offering Claude for a voice prompt
    // would let an admin pick a model the agent cannot run.
    expect(PROVIDER_RUNTIME_MATRIX.anthropic).toEqual([
      LlmRuntime.ALLY_AI,
      LlmRuntime.ALLY_BE,
    ]);
    expect(
      getLlmModels(LlmRuntime.AI_LEARN).some((m) => m.provider === 'anthropic'),
    ).toBe(false);
  });

  it('offers OpenAI and Gemini to every runtime', () => {
    for (const runtime of Object.values(LlmRuntime)) {
      const providers = new Set(getLlmModels(runtime).map((m) => m.provider));
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('gemini')).toBe(true);
    }
  });
});
