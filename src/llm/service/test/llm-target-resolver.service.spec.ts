import { LlmModelTier } from '../../constants/llm-tier.constants';
import {
  LlmTargetResolverService,
  LlmTargetSource,
} from '../llm-target-resolver.service';

/**
 * The resolution chain is the whole point of the change, so these tests pin the
 * ORDER rather than any single layer: a chain that silently prefers the wrong
 * rung looks identical to a working one until the model on someone's bill is
 * not the model they chose.
 */
describe('LlmTargetResolverService', () => {
  const tiers = { fast: 'gpt-4o-mini', reasoning: 'gpt-5-mini' };
  const configService = { llmTiers: tiers } as any;

  const build = (promptConfig: Record<string, any> = {}) => {
    const promptSharedService = {
      getPromptLlmConfig: jest.fn(
        async (code: string) => promptConfig[code] ?? {},
      ),
    };
    const service = new LlmTargetResolverService(
      configService,
      promptSharedService as any,
    );
    return { service, promptSharedService };
  };

  const base = { taskId: 'some-task', tier: LlmModelTier.FAST };

  describe('order of precedence', () => {
    it('falls back to the tier when nothing selects a model', async () => {
      const { service } = build();

      const target = await service.resolve(base);

      expect(target).toMatchObject({
        model: 'gpt-4o-mini',
        provider: 'openai',
        source: LlmTargetSource.TIER,
      });
    });

    it('serves the tier the registry row asked for', async () => {
      const { service } = build();

      const target = await service.resolve({
        ...base,
        tier: LlmModelTier.REASONING,
      });

      expect(target.model).toBe('gpt-5-mini');
      // The two tiers must not collapse into one: interim-reply and
      // predictive-filler are cheap deliberately, and a resolver that served
      // the reasoning model to everything would retier the live voice path
      // without anyone changing a setting.
      expect(target.model).not.toBe(tiers.fast);
    });

    it('prefers the prompt row over the tier', async () => {
      const { service } = build({ my_prompt: { model: 'gemini-2.5-flash' } });

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target).toMatchObject({
        model: 'gemini-2.5-flash',
        provider: 'gemini',
        source: LlmTargetSource.PROMPT,
      });
    });

    it('prefers an explicit call argument over every configured layer', async () => {
      const { service } = build({ my_prompt: { model: 'gemini-2.5-flash' } });

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
        model: 'gpt-4o-mini',
      });

      // An AI Lab run names the model it is deliberately testing; re-resolving
      // it through config would make the feature test something else.
      expect(target.source).toBe(LlmTargetSource.REQUEST);
      expect(target.model).toBe('gpt-4o-mini');
    });

    it('ignores a layer that sets no model, rather than treating it as a choice', async () => {
      // A prompt row with a temperature but no model: a real state, because
      // `prompts.model` and `prompts.temperature` are independently nullable.
      const { service } = build({ my_prompt: { temperature: 0.4 } });

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target.source).toBe(LlmTargetSource.TIER);
      expect(target.model).toBe('gpt-4o-mini');
      // The temperature still applies even though the model came from below it.
      expect(target.temperature).toBe(0.4);
    });
  });

  describe('provider resolution', () => {
    it('honours an explicit provider on the winning layer', async () => {
      const { service } = build({
        my_prompt: { provider: 'openai', model: 'some-unlisted-model' },
      });

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target.provider).toBe('openai');
    });

    it('infers the provider from the model id when none is set', async () => {
      const { service } = build({ my_prompt: { model: 'claude-haiku-4-5' } });

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
      });
      expect(target.provider).toBe('anthropic');
    });
  });

  describe('fallback flag', () => {
    it('defaults to enabled', async () => {
      const { service } = build();

      expect((await service.resolve(base)).fallbackEnabled).toBe(true);
    });

    it('respects a registry row that pins its model', async () => {
      // Judges pin: a score from an unpinned model corrupts a series that is
      // only comparable within one (MODEL, PROMPT_VERSION) pair.
      const { service } = build();

      const target = await service.resolve({ ...base, neverFallback: true });
      expect(target.fallbackEnabled).toBe(false);
    });
  });

  describe('degradation', () => {
    it('ignores an unreadable prompt row rather than failing the call', async () => {
      const resolver = new LlmTargetResolverService(configService, {
        getPromptLlmConfig: jest.fn().mockRejectedValue(new Error('nope')),
      } as any);

      // The tier default is a correct answer, just not the tuned one — far
      // better than taking the call down over a config read.
      const target = await resolver.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target.source).toBe(LlmTargetSource.TIER);
      expect(target.model).toBe('gpt-4o-mini');
    });
  });
});
