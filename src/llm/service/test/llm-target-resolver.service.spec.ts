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

  const build = (
    taskRows: Record<string, any> = {},
    promptConfig: Record<string, any> = {},
  ) => {
    const taskConfigRepository = {
      findAllByTaskId: jest.fn(async () => new Map(Object.entries(taskRows))),
    };
    const promptSharedService = {
      getPromptLlmConfig: jest.fn(
        async (code: string) => promptConfig[code] ?? {},
      ),
    };
    const service = new LlmTargetResolverService(
      configService,
      taskConfigRepository as any,
      promptSharedService as any,
    );
    return { service, taskConfigRepository, promptSharedService };
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

    it('serves the tier matching the tier the CALLER asked for', async () => {
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

    it('prefers the task row over the tier', async () => {
      const { service } = build({
        'some-task': { model: 'claude-sonnet-4-6', fallbackEnabled: true },
      });

      const target = await service.resolve(base);

      expect(target).toMatchObject({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        source: LlmTargetSource.TASK,
      });
    });

    it('prefers the prompt row over the task row', async () => {
      const { service } = build(
        { 'some-task': { model: 'gpt-4o', fallbackEnabled: true } },
        { my_prompt: { model: 'gemini-2.5-flash' } },
      );

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
      const { service } = build(
        { 'some-task': { model: 'gpt-4o', fallbackEnabled: true } },
        { my_prompt: { model: 'gemini-2.5-flash' } },
      );

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
      const { service } = build(
        { 'some-task': { model: 'gpt-4o', fallbackEnabled: true } },
        // A prompt row with a temperature but no model: a real state, because
        // the columns are independently nullable.
        { my_prompt: { temperature: 0.4 } },
      );

      const target = await service.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target.source).toBe(LlmTargetSource.TASK);
      expect(target.model).toBe('gpt-4o');
      // The temperature still applies even though the model came from below it.
      expect(target.temperature).toBe(0.4);
    });

    it('only consults the row belonging to the task being resolved', async () => {
      const { service } = build({
        'another-task': { model: 'claude-sonnet-4-6', fallbackEnabled: true },
      });

      const target = await service.resolve(base);

      expect(target.source).toBe(LlmTargetSource.TIER);
    });
  });

  describe('provider resolution', () => {
    it('honours an explicit provider on the winning layer', async () => {
      const { service } = build({
        'some-task': {
          provider: 'openai',
          model: 'some-unlisted-model',
          fallbackEnabled: true,
        },
      });

      const target = await service.resolve(base);

      expect(target.provider).toBe('openai');
    });

    it('infers the provider from the model id when none is set', async () => {
      const { service } = build({
        'some-task': { model: 'claude-haiku-4-5', fallbackEnabled: true },
      });

      expect((await service.resolve(base)).provider).toBe('anthropic');
    });
  });

  describe('fallback flag', () => {
    it('defaults to enabled when the task has no row', async () => {
      const { service } = build();

      expect((await service.resolve(base)).fallbackEnabled).toBe(true);
    });

    it('respects a task that opted out', async () => {
      // Judges opt out: a score from an unpinned model corrupts a series that
      // is only comparable within one (MODEL, PROMPT_VERSION) pair.
      const { service } = build({
        'some-task': { model: 'gemini-2.5-pro', fallbackEnabled: false },
      });

      expect((await service.resolve(base)).fallbackEnabled).toBe(false);
    });
  });

  describe('degradation', () => {
    it('serves the tier default when the config table cannot be read', async () => {
      const { service } = build();
      (service as any).taskConfigRepository = undefined;
      const taskConfigRepository = {
        findAllByTaskId: jest.fn().mockRejectedValue(new Error('db down')),
      };
      const resolver = new LlmTargetResolverService(
        configService,
        taskConfigRepository as any,
        { getPromptLlmConfig: jest.fn(async () => ({})) } as any,
      );

      // A resolver that threw here would take down every LLM call in the
      // process to protect config that is almost always absent.
      const target = await resolver.resolve(base);

      expect(target.model).toBe('gpt-4o-mini');
      expect(target.source).toBe(LlmTargetSource.TIER);
    });

    it('ignores an unreadable prompt row rather than failing the call', async () => {
      const taskConfigRepository = {
        findAllByTaskId: jest.fn(async () => new Map()),
      };
      const resolver = new LlmTargetResolverService(
        configService,
        taskConfigRepository as any,
        {
          getPromptLlmConfig: jest.fn().mockRejectedValue(new Error('nope')),
        } as any,
      );

      const target = await resolver.resolve({
        ...base,
        promptCode: 'my_prompt',
      });

      expect(target.source).toBe(LlmTargetSource.TIER);
    });
  });

  describe('caching', () => {
    it('reads the table once across calls, then again after invalidate', async () => {
      const { service, taskConfigRepository } = build();

      await service.resolve(base);
      await service.resolve(base);
      expect(taskConfigRepository.findAllByTaskId).toHaveBeenCalledTimes(1);

      // An admin switching a task is usually doing it BECAUSE the task is
      // failing, so the edit has to apply without waiting out a TTL.
      service.invalidate();
      await service.resolve(base);
      expect(taskConfigRepository.findAllByTaskId).toHaveBeenCalledTimes(2);
    });
  });
});
