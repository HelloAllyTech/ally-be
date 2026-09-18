import { CharacterInterviewOrchestratorService } from '../character-interview-orchestrator.service';

/**
 * Which model runs an interview turn, and what the loop does when nothing can.
 *
 * The turn loop itself is provider-agnostic (see
 * character-interview-orchestrator.service.spec.ts); this covers the step
 * before it, where a provider and model are chosen from the interviewer
 * prompt's own LLM settings or the environment config behind them.
 */
describe('CharacterInterviewOrchestratorService — model resolution', () => {
  const build = ({
    promptConfig = {},
    envModel = 'claude-sonnet-4-6',
    envProvider = undefined as string | undefined,
    create = jest.fn(),
  }: {
    promptConfig?: Record<string, unknown>;
    envModel?: string;
    envProvider?: string;
    create?: jest.Mock;
  }) => {
    const record = jest.fn();
    const appendMessage = jest
      .fn()
      .mockImplementation(async () => ({ seq: 1 }));

    // Only when the caller hasn't supplied its own (e.g. a throwing factory).
    if (!create.getMockImplementation()) {
      create.mockImplementation(() => ({
        name: 'stub',
        // A minimal successful turn: one line of prose, nothing to execute.
        stream: async function* () {
          yield { type: 'text_delta', text: 'Hello.' };
          yield {
            type: 'final',
            message: {
              content: [{ type: 'text', text: 'Hello.' }],
              stopReason: 'end_turn',
              usage: { inputTokens: 3, outputTokens: 2 },
            },
          };
        },
      }));
    }

    const service = new CharacterInterviewOrchestratorService(
      {
        characterInterview: {
          model: envModel,
          provider: envProvider,
          maxToolIterations: 8,
        },
      } as any,
      {
        getPromptByCode: jest.fn().mockResolvedValue('SYSTEM'),
        getPromptLlmConfig: jest.fn().mockResolvedValue(promptConfig),
      } as any,
      {
        getSession: jest
          .fn()
          .mockResolvedValue({ id: 'sess-1', status: 'in_progress' }),
      } as any,
      {
        getToolDefinitions: jest.fn().mockReturnValue([]),
        execute: jest.fn(),
      } as any,
      { listBySession: jest.fn().mockResolvedValue([]), appendMessage } as any,
      { record } as any,
      { create } as any,
    );

    return { service, create, record, appendMessage };
  };

  const collect = async (service: CharacterInterviewOrchestratorService) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn(
      'sess-1',
      { message: 'Go on.' } as any,
      7,
    )) {
      frames.push(frame);
    }
    return frames;
  };

  it('runs the provider and model set on the interviewer prompt', async () => {
    const { service, create, record, appendMessage } = build({
      promptConfig: { provider: 'openai', model: 'gpt-5' },
    });

    await collect(service);

    expect(create).toHaveBeenCalledWith('openai', 'gpt-5');
    // Usage has to be attributed to whoever actually ran, or the LLM spend
    // report shows OpenAI turns billed against Anthropic.
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-5' }),
    );
    expect(appendMessage.mock.calls[1][1].metadata).toEqual(
      expect.objectContaining({ provider: 'openai', model: 'gpt-5' }),
    );
  });

  it('infers the provider from the model when the prompt names only a model', async () => {
    const { service, create } = build({
      promptConfig: { model: 'gemini-2.5-pro' },
    });

    await collect(service);

    expect(create).toHaveBeenCalledWith('gemini', 'gemini-2.5-pro');
  });

  it('accepts "google" as the prompt-row spelling of Gemini', async () => {
    // Every stored Gemini row spells it that way.
    const { service, create } = build({
      promptConfig: { provider: 'google', model: 'gemini-2.5-flash' },
    });

    await collect(service);

    expect(create).toHaveBeenCalledWith('gemini', 'gemini-2.5-flash');
  });

  it('falls back to environment config when the prompt sets no model', async () => {
    const { service, create } = build({ promptConfig: {} });

    await collect(service);

    expect(create).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
  });

  it('ignores a prompt row that names a provider with no model', async () => {
    // Half a setting: the environment's model may belong to a different
    // provider entirely, so the two cannot be combined.
    const { service, create } = build({
      promptConfig: { provider: 'openai' },
      envModel: 'claude-sonnet-4-6',
    });

    await collect(service);

    expect(create).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
  });

  it('honours CHARACTER_INTERVIEW_PROVIDER for a model id nothing claims', async () => {
    const { service, create } = build({
      envModel: 'my-finetune-01',
      envProvider: 'openai',
    });

    await collect(service);

    expect(create).toHaveBeenCalledWith('openai', 'my-finetune-01');
  });

  it('explains a misconfigured model without touching the transcript', async () => {
    // Environment-wide misconfiguration fails every turn identically, so
    // persisting a message and an errored reply per attempt would stack
    // duplicate rows into the interview instead of leaving it resumable.
    const create = jest.fn().mockImplementation(() => {
      throw new Error('openai is not configured on this environment');
    });
    const { service, appendMessage } = build({
      promptConfig: { provider: 'openai', model: 'gpt-5' },
      create,
    });

    const frames = await collect(service);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('error');
    expect(frames[0].data.code).toBe('interview_misconfigured');
    expect(frames[0].data.message).toContain('not configured');
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it('errors rather than guessing when no provider can be resolved', async () => {
    const { service } = build({ envModel: 'llama-3-70b' });

    const frames = await collect(service);

    expect(frames[0].data.code).toBe('interview_misconfigured');
    expect(frames[0].data.message).toContain('CHARACTER_INTERVIEW_PROVIDER');
  });
});
