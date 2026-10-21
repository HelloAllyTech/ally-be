import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmTargetResolverService } from 'src/llm/service/llm-target-resolver.service';
import { BUILDER_AI_TASKS } from 'src/builder/constants/builder.constants';
import {
  BUG_HUNTER_CLASSIFY_MISS_TASK_ID,
  BUG_HUNTER_CLASSIFY_REPO_TASK_ID,
  BUG_HUNTER_DECIDE_TASK_ID,
  BUG_HUNTER_REVIEW_STUDY_TASK_ID,
} from 'src/bug-hunter/constants/bug-hunter.constants';
import { LlmCompletionService } from '../llm-completion.service';

/**
 * Every call that names its own model on a registry row with no tier, through
 * the REAL resolver.
 *
 * These rows are config-selected on purpose: the call site reads a model from
 * config (or a constant), so the registry gives them no tier, and the registry
 * forbids a tier beside a `configPath`. The resolver then demanded a tier
 * anyway and threw on every one of these calls — 363 times in production in
 * the week to 2026-10-21. Every spec of every caller stubbed the completion
 * service or the resolver, so none of them could see it. This one stubs only
 * the provider at the bottom.
 */
describe('LlmCompletionService — calls that name a model on an untiered row', () => {
  const build = (fail = false) => {
    const created: { provider: string; model: string }[] = [];
    const factory = {
      create: jest.fn((provider: string, model: string) => {
        created.push({ provider, model });
        return {
          name: provider,
          stream: async function* () {
            if (fail)
              throw Object.assign(new Error('upstream 503'), { status: 503 });
            yield {
              type: 'final',
              message: {
                content: [{ type: 'text', text: '{"ok":true}' }],
                stopReason: 'end_turn',
                usage: { inputTokens: 10, outputTokens: 5 },
              },
            };
          },
        };
      }),
      isConfigured: jest.fn(() => true),
    };
    const resolver = new LlmTargetResolverService(
      { llmTiers: { fast: 'gpt-4o-mini', reasoning: 'gpt-5-mini' } } as any,
      { getPromptLlmConfig: jest.fn(async () => ({})) } as any,
    );
    const service = new LlmCompletionService(
      resolver,
      factory as any,
      { record: jest.fn() } as any,
    );
    return { service, created };
  };

  it.each([
    BUILDER_AI_TASKS.INTERVIEW_SUMMARY,
    BUILDER_AI_TASKS.EPIC_DECOMPOSITION,
    BUILDER_AI_TASKS.LESSON_CURATION,
    BUILDER_AI_TASKS.OUTCOME_CATEGORISE,
    BUILDER_AI_TASKS.CONTEXT_SELECTION,
    BUG_HUNTER_CLASSIFY_REPO_TASK_ID,
    BUG_HUNTER_CLASSIFY_MISS_TASK_ID,
    BUG_HUNTER_REVIEW_STUDY_TASK_ID,
    BUG_HUNTER_DECIDE_TASK_ID,
  ])('%s runs on the model its call names', async (taskId) => {
    const { service, created } = build();

    const result = await service.complete({
      taskId,
      task: LlmTask.BUILDER_CONTEXT_SELECTION,
      model: 'gemini-2.5-flash',
      prompt: 'hello',
      maxTokens: 100,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(created).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-flash' },
    ]);
  });

  it('surfaces a failure as itself — there is no other model to try', async () => {
    const { service, created } = build(true);

    await expect(
      service.complete({
        taskId: BUG_HUNTER_DECIDE_TASK_ID,
        task: LlmTask.BUG_HUNTER,
        model: 'gemini-2.5-flash',
        prompt: 'hello',
        maxTokens: 100,
      }),
    ).rejects.toThrow('upstream 503');
    expect(created).toHaveLength(1);
  });
});
