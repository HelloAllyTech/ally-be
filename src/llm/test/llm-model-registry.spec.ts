import {
  LLM_MODEL_REGISTRY,
  LlmRuntime,
  getLlmModels,
} from '../constants/llm-model-registry.constants';

describe('LLM model registry', () => {
  it('every entry has the required shape', () => {
    for (const m of LLM_MODEL_REGISTRY) {
      expect(m.provider).toMatch(/^(openai|gemini|anthropic)$/);
      expect(m.model).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(Array.isArray(m.runtimes)).toBe(true);
      expect(m.runtimes.length).toBeGreaterThan(0);
      expect(typeof m.supportsTemperature).toBe('boolean');
    }
  });

  it('derives supportsTemperature from the shared rule', () => {
    const byId = (id: string) => LLM_MODEL_REGISTRY.find((m) => m.model === id);
    expect(byId('gpt-4o')?.supportsTemperature).toBe(true);
    expect(byId('gemini-2.5-pro')?.supportsTemperature).toBe(true);
    expect(byId('gpt-5')?.supportsTemperature).toBe(false);
    expect(byId('gpt-5-mini')?.supportsTemperature).toBe(false);
  });

  describe('getLlmModels(runtime)', () => {
    it('ai-learn includes OpenAI + Gemini', () => {
      const models = getLlmModels(LlmRuntime.AI_LEARN).map((m) => m.model);
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gemini-2.5-pro');
    });

    it('ally-ai runs OpenAI + Gemini + Anthropic', () => {
      // Anthropic gained ALLY_AI for the WhatsApp knowledge agent, whose answer model is
      // admin-selectable per prompt. Before that, selecting Claude for an ally-ai prompt silently
      // fell back to the default provider because the picker filtered it out. ally-ai grew the raw
      // `anthropic` SDK (app/core/llm/dispatch.py) in the same change.
      const providers = new Set(
        getLlmModels(LlmRuntime.ALLY_AI).map((m) => m.provider),
      );
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('gemini')).toBe(true);
      expect(providers.has('anthropic')).toBe(true);
    });

    it('ally-be runs OpenAI + Gemini + Anthropic', () => {
      const providers = new Set(
        getLlmModels(LlmRuntime.ALLY_BE).map((m) => m.provider),
      );
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('gemini')).toBe(true);
      expect(providers.has('anthropic')).toBe(true);
    });

    it('anthropic models are offered for ally-be and ally-ai, never the voice runtime', () => {
      // The exclusion that still matters: ally-ai-learn's factory has no Anthropic branch, so
      // offering Claude there would let an admin pick a model the voice agent cannot run.
      const claude = LLM_MODEL_REGISTRY.find((m) => m.provider === 'anthropic');
      expect(claude?.runtimes).toEqual([
        LlmRuntime.ALLY_AI,
        LlmRuntime.ALLY_BE,
      ]);
      expect(claude?.runtimes).not.toContain(LlmRuntime.AI_LEARN);
    });

    it('no filter returns the full registry', () => {
      expect(getLlmModels()).toHaveLength(LLM_MODEL_REGISTRY.length);
    });
  });
});
