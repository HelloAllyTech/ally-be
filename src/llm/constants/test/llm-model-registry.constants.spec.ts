import {
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

  // ai-learn's app/llms/factory.py has no Anthropic branch. If that changes,
  // this test should be updated deliberately — not discovered in production.
  it('keeps Anthropic out of the voice runtime', () => {
    expect(PROVIDER_RUNTIME_MATRIX.anthropic).toEqual([LlmRuntime.ALLY_BE]);
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
