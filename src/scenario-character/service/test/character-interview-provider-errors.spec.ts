import { CharacterInterviewOrchestratorService } from '../character-interview-orchestrator.service';

/**
 * What the admin is shown when the provider call itself fails.
 *
 * The turn loop used to relay `error.message` straight through to the SSE
 * stream and into the persisted transcript, which put a raw SDK payload — and
 * with it the platform's billing state — on a customer admin's screen, on
 * every reload of that interview. These cover the frame and the persisted row
 * together, because the second is what made the first permanent.
 */
describe('CharacterInterviewOrchestratorService — provider failures', () => {
  /** The exact Anthropic payload that surfaced in the admin console. */
  const creditBalanceError = () => {
    const body = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Anthropic API. ' +
          'Please go to Plans & Billing to upgrade or purchase credits.',
      },
    };
    const error: any = new Error(`400 ${JSON.stringify(body)}`);
    error.status = 400;
    error.error = body;
    return error;
  };

  const build = (throwOnStream: () => Error) => {
    const appendMessage = jest
      .fn()
      .mockImplementation(async () => ({ seq: 1 }));
    const errorLog = jest.fn();

    const service = new CharacterInterviewOrchestratorService(
      {
        characterInterview: {
          model: 'claude-sonnet-4-6',
          provider: undefined,
          maxToolIterations: 8,
        },
      } as any,
      {
        getPromptByCode: jest.fn().mockResolvedValue('SYSTEM'),
        getPromptLlmConfig: jest.fn().mockResolvedValue({}),
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
      { record: jest.fn() } as any,
      {
        create: jest.fn().mockReturnValue({
          name: 'anthropic',

          stream: async function* () {
            throw throwOnStream();
          },
        }),
      } as any,
    );

    // The service holds a singleton logger; swap only what the assertions read.
    (service as any).logger = {
      error: errorLog,
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    return { service, appendMessage, errorLog };
  };

  const collect = async (service: CharacterInterviewOrchestratorService) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn(
      'sess-1',
      { message: "Let's begin." } as any,
      7,
    )) {
      frames.push(frame);
    }
    return frames;
  };

  it('never puts the provider payload on the stream', async () => {
    const { service } = build(creditBalanceError);

    const frames = await collect(service);
    const error = frames.find((frame) => frame.event === 'error');

    expect(error).toBeDefined();
    expect(error.data.message).not.toContain('credit balance');
    expect(error.data.message).not.toContain('Anthropic');
    expect(error.data.message).not.toContain('invalid_request_error');
    expect(error.data.message).not.toContain('400');
  });

  it('tells the admin what happened and who can fix it', async () => {
    const { service } = build(creditBalanceError);

    const frames = await collect(service);
    const error = frames.find((frame) => frame.event === 'error');

    expect(error.data.code).toBe('provider_quota_exhausted');
    // State preserved, and a resolution path that is not "try again" — this
    // one cannot be retried into working.
    expect(error.data.message).toContain('Your answers are all still here');
    expect(error.data.message).toContain('administrator');
  });

  it('persists the safe copy, so a reload does not re-render the payload', async () => {
    const { service, appendMessage } = build(creditBalanceError);

    await collect(service);

    // [0] is the admin's own message; [1] is the errored assistant row.
    const assistantRow = appendMessage.mock.calls[1][1];
    expect(assistantRow.metadata.errored).toBe(true);
    expect(assistantRow.metadata.errorMessage).not.toContain('credit balance');
    expect(assistantRow.metadata.errorMessage).toContain(
      'Your answers are all still here',
    );
  });

  it('keeps the provider payload in the log', async () => {
    const { service, errorLog } = build(creditBalanceError);

    await collect(service);

    const logged = errorLog.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).toContain('credit balance is too low');
    expect(logged).toContain('quota');
    expect(logged).toContain('claude-sonnet-4-6');
  });

  it('offers a retry for a transient failure instead of an escalation', async () => {
    const { service } = build(() => {
      const error: any = new Error('529 Overloaded');
      error.status = 529;
      error.error = { type: 'overloaded_error' };
      return error;
    });

    const frames = await collect(service);
    const error = frames.find((frame) => frame.event === 'error');

    expect(error.data.code).toBe('provider_unavailable');
    expect(error.data.message).toContain('send your message again');
  });
});
