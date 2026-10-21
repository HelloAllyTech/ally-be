import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmModelTier } from 'src/llm/constants/llm-tier.constants';
import { LlmTargetSource } from 'src/llm/service/llm-target-resolver.service';
import { LlmCompletionService } from '../llm-completion.service';

/**
 * The fallback is why this service exists.
 *
 * The incident it answers: a present-but-invalid Anthropic key. Every
 * "is this provider configured" check passes because the key is there, and then
 * every call 401s — so ten features died at once and no config change could
 * move them. These tests pin what happens on that exact failure, and equally
 * what must NOT happen: a silent substitution on a task whose output gets
 * stored and trended.
 */
describe('LlmCompletionService', () => {
  const streamOf = (
    text: string,
    usage = { inputTokens: 7, outputTokens: 3 },
    stopReason = 'end_turn',
  ) =>
    async function* () {
      yield { type: 'text_delta', text };
      yield {
        type: 'final',
        message: {
          content: [{ type: 'text', text }],
          stopReason,
          usage,
        },
      };
    };

  const build = (opts: {
    target?: Partial<Record<string, any>>;
    /** Provider name -> behaviour. Throwing simulates a dead credential. */
    providers?: Record<
      string,
      { fail?: any; text?: string; stopReason?: string }
    >;
    openaiConfigured?: boolean;
  }) => {
    const target = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: undefined,
      source: LlmTargetSource.PROMPT,
      fallbackEnabled: true,
      tierModel: 'gpt-4o-mini',
      ...(opts.target ?? {}),
    };

    const streamCalls: any[] = [];
    const factory = {
      create: jest.fn((provider: string, model: string) => ({
        name: provider,
        stream: (request: any) => {
          streamCalls.push({ provider, model, request });
          const behaviour = opts.providers?.[provider] ?? {};
          if (behaviour.fail) throw behaviour.fail;
          return streamOf(
            behaviour.text ?? 'ok',
            undefined,
            behaviour.stopReason ?? 'end_turn',
          )();
        },
      })),
      isConfigured: jest.fn(
        (provider: string) =>
          provider !== 'openai' || (opts.openaiConfigured ?? true),
      ),
    };
    const llmUsage = { record: jest.fn() };
    const resolver = { resolve: jest.fn(async () => target) };

    const service = new LlmCompletionService(
      resolver as any,
      factory as any,
      llmUsage as any,
    );
    return { service, factory, llmUsage, streamCalls, target };
  };

  const request = {
    taskId: 'track-quiz-grading',
    task: LlmTask.TRACK_QUIZ_GRADING,
    tier: LlmModelTier.REASONING,
    prompt: 'grade this',
    maxTokens: 512,
  };

  describe('the happy path', () => {
    it('returns the assembled text and reports what actually ran', async () => {
      const { service } = build({ providers: { anthropic: { text: ' hi ' } } });

      const result = await service.complete(request);

      expect(result).toMatchObject({
        text: 'hi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        source: LlmTargetSource.PROMPT,
      });
      expect(result.fellBackFrom).toBeUndefined();
    });

    it('records usage against the task, tagged with the resolved source', async () => {
      const { service, llmUsage } = build({});

      await service.complete(request);

      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          task: 'track_quiz_grading',
          promptTokens: 7,
          completionTokens: 3,
          metadata: expect.objectContaining({
            aiTaskId: 'track-quiz-grading',
            modelSource: LlmTargetSource.PROMPT,
          }),
        }),
      );
    });

    it('records under `unknown` rather than dropping the row for an unlabelled call', async () => {
      const { service, llmUsage } = build({});

      await service.complete({ ...request, task: null });

      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'unknown' }),
      );
    });

    it('reports why the model stopped', async () => {
      const { service } = build({});

      expect((await service.complete(request)).stopReason).toBe('end_turn');
    });

    it('surfaces a token-cap cut instead of returning the stub as a clean answer', async () => {
      const { service } = build({
        providers: {
          anthropic: {
            text: '{"sessionSummary":"The caller',
            stopReason: 'max_tokens',
          },
        },
      });

      const result = await service.complete(request);

      // Before this was returned, a capped JSON reply parsed as `{}` downstream
      // and read as "nothing to extract". On gpt-5 models reasoning tokens
      // count against maxTokens, so the cut can land well inside a budget that
      // looked generous for the visible output.
      expect(result.stopReason).toBe('max_tokens');
      expect(result.text).toBe('{"sessionSummary":"The caller');
    });

    it('passes the deadline to the provider instead of racing it', async () => {
      const { service, streamCalls } = build({});

      await service.complete({ ...request, timeoutMs: 4321 });

      // Racing would leave the HTTP request running and its tokens billable.
      expect(streamCalls[0].request.timeoutMs).toBe(4321);
    });
  });

  describe('fallback on a dead credential', () => {
    const authError = Object.assign(new Error('invalid x-api-key'), {
      status: 401,
    });

    it('retries on the OpenAI tier model and reports the substitution', async () => {
      const { service } = build({
        providers: {
          anthropic: { fail: authError },
          openai: { text: 'saved' },
        },
      });

      const result = await service.complete(request);

      expect(result.text).toBe('saved');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      // Reported, never swallowed: a caller storing this output has to be able
      // to record which model produced it.
      expect(result.fellBackFrom).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        reason: 'invalid x-api-key',
      });
    });

    it('records the usage row against the model that actually served it', async () => {
      const { service, llmUsage } = build({
        providers: { anthropic: { fail: authError }, openai: {} },
      });

      await service.complete(request);

      expect(llmUsage.record).toHaveBeenCalledTimes(1);
      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', model: 'gpt-4o-mini' }),
      );
    });

    it.each([
      ['403 revoked', 403],
      ['404 retired model', 404],
      ['429 rate limited', 429],
      ['500 provider error', 500],
      ['503 unavailable', 503],
    ])('falls back on %s', async (_label, status) => {
      const { service } = build({
        providers: {
          anthropic: { fail: Object.assign(new Error('nope'), { status }) },
          openai: { text: 'saved' },
        },
      });

      expect((await service.complete(request)).provider).toBe('openai');
    });

    it('falls back on a connection failure that carries no status', async () => {
      const { service } = build({
        providers: {
          anthropic: { fail: new Error('socket hang up') },
          openai: { text: 'saved' },
        },
      });

      // The request never reached a model, so nothing about it was rejected.
      expect((await service.complete(request)).provider).toBe('openai');
    });

    it('drops a temperature tuned for the model that failed', async () => {
      const { service, streamCalls } = build({
        target: { temperature: 0.9 },
        providers: { anthropic: { fail: authError }, openai: {} },
      });

      await service.complete(request);

      expect(streamCalls[0].request.temperature).toBe(0.9);
      expect(streamCalls[1].request.temperature).toBeUndefined();
    });
  });

  describe('reading the registry row, not just the resolved target', () => {
    /**
     * The gap both real bugs slipped through: every test above mocks the
     * resolver, so they prove the service HONOURS `fallbackEnabled` without
     * proving anything about where that value comes from. It came from
     * nowhere — `neverFallback` sat on the registry row, was read by the AI
     * Tasks screen, and was never passed into the resolver. So the AI Lab run
     * and the LLM preview, the two calls whose entire purpose is testing one
     * named model, fell back silently: a preview returned ok:true for
     * `gpt-4o-mini-does-not-exist` having quietly answered from gpt-4o-mini.
     */
    const capturingService = () => {
      const resolved: any[] = [];
      const resolver = {
        resolve: jest.fn(async (opts: any) => {
          resolved.push(opts);
          return {
            provider: 'openai',
            model: 'gpt-4o-mini',
            source: LlmTargetSource.TIER,
            fallbackEnabled: !opts.neverFallback,
            tierModel: 'gpt-4o-mini',
          };
        }),
      };
      const factory = {
        create: jest.fn(() => ({
          name: 'openai',
          stream: () => streamOf('ok')(),
        })),
        isConfigured: jest.fn(() => true),
      };
      const service = new LlmCompletionService(
        resolver as any,
        factory as any,
        { record: jest.fn() } as any,
      );
      return { service, resolved };
    };

    it.each(['ai-lab-run', 'llm-preview'])(
      'carries neverFallback from the %s row into resolution',
      async (taskId) => {
        const { service, resolved } = capturingService();

        await service.complete({ ...request, taskId, task: null });

        expect(resolved[0].neverFallback).toBe(true);
      },
    );

    it('leaves neverFallback off for a task that allows degrading', async () => {
      const { service, resolved } = capturingService();

      await service.complete({ ...request, taskId: 'track-quiz-grading' });

      expect(resolved[0].neverFallback).toBe(false);
    });

    it('takes the tier from the row rather than the caller', async () => {
      const { service, resolved } = capturingService();

      // mobile-release-whats-new is the FAST tier; the request above says
      // REASONING, and a caller cannot override the row.
      await service.complete({
        ...request,
        taskId: 'mobile-release-whats-new',
      });

      expect(resolved[0].tier).toBe('fast');
    });

    it('runs voice-note extraction on the reasoning tier', async () => {
      const { service, resolved } = capturingService();

      // The FAST model kept 48% of a 25-minute dictation's facts; the
      // reasoning tier keeps 93% on the same prompt. If this flips back to
      // `fast`, long scribe notes lose half of what the counsellor said.
      await service.complete({ ...request, taskId: 'voice-note-extract' });

      expect(resolved[0].tier).toBe('reasoning');
    });
  });

  describe('when it must NOT fall back', () => {
    it('rethrows a 400 — the request was rejected, not the provider', async () => {
      const badRequest = Object.assign(new Error('bad shape'), { status: 400 });
      const { service, factory } = build({
        providers: { anthropic: { fail: badRequest }, openai: {} },
      });

      await expect(service.complete(request)).rejects.toThrow('bad shape');
      // Retrying a malformed request elsewhere just fails twice, slower.
      expect(factory.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows for a task the registry pins', async () => {
      const { service } = build({
        target: { fallbackEnabled: false },
        providers: {
          anthropic: {
            fail: Object.assign(new Error('down'), { status: 500 }),
          },
          openai: {},
        },
      });

      // A judge score from an unpinned model corrupts a trended series, so
      // failing loudly is the correct outcome.
      await expect(service.complete(request)).rejects.toThrow('down');
    });

    it('rethrows when the tier default is the thing that just failed', async () => {
      const { service, factory } = build({
        target: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          tierModel: 'gpt-4o-mini',
        },
        providers: {
          openai: { fail: Object.assign(new Error('down'), { status: 500 }) },
        },
      });

      await expect(service.complete(request)).rejects.toThrow('down');
      expect(factory.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows when OpenAI holds no key here', async () => {
      const { service } = build({
        openaiConfigured: false,
        providers: {
          anthropic: {
            fail: Object.assign(new Error('down'), { status: 401 }),
          },
        },
      });

      // Retrying would fail for a second, more confusing reason.
      await expect(service.complete(request)).rejects.toThrow('down');
    });
  });

  describe('request shaping', () => {
    it('sends an explicit message list unchanged', async () => {
      const { service, streamCalls } = build({});
      const messages = [
        { role: 'user' as const, content: 'one' },
        { role: 'assistant' as const, content: 'two' },
        { role: 'user' as const, content: 'three' },
      ];

      await service.complete({ ...request, prompt: undefined, messages });

      expect(streamCalls[0].request.messages).toEqual(messages);
    });

    it('wraps a bare prompt as a single user turn', async () => {
      const { service, streamCalls } = build({});

      await service.complete({ ...request, system: 'be terse' });

      expect(streamCalls[0].request.system).toBe('be terse');
      expect(streamCalls[0].request.messages).toEqual([
        { role: 'user', content: 'grade this' },
      ]);
    });
  });
});
