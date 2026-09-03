import { BuilderInterviewOrchestratorService } from '../builder-interview-orchestrator.service';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

/**
 * A stubbed Anthropic streaming response. Yields no text deltas — the turn's
 * prose comes from `finalMessage().content`, which is what the orchestrator
 * actually persists.
 */
const fakeStream = (content: any[], stopReason: string) => ({
  [Symbol.asyncIterator]: async function* () {
    // No deltas: token frames are not what these tests are about.
  },
  finalMessage: async () => ({
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
});

describe('BuilderInterviewOrchestratorService — turn autosave', () => {
  let service: BuilderInterviewOrchestratorService;
  let messageRepository: {
    listBySession: jest.Mock;
    appendMessage: jest.Mock;
    checkpointMessage: jest.Mock;
    closeInterruptedMessages: jest.Mock;
  };
  let toolsService: { getToolDefinitions: jest.Mock; execute: jest.Mock };
  let streams: any[];
  // Snapshotted per pass: the orchestrator mutates one `messages` array in
  // place, so the mock's recorded args all point at its final state.
  let requests: any[][];

  const drain = async (): Promise<any[]> => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn(
      'session-1',
      { message: 'Cut the runner cost.' } as any,
      7,
    )) {
      frames.push(frame);
    }
    return frames;
  };

  let sessionRepository: { update: jest.Mock };
  let sessionService: { getSession: jest.Mock; syncReadinessStatus: jest.Mock };
  let summariseCalls: number;

  beforeEach(() => {
    streams = [];
    requests = [];
    let appended = 0;
    messageRepository = {
      listBySession: jest.fn().mockResolvedValue([]),
      appendMessage: jest.fn(async (_sessionId, message) => ({
        id: `msg-${++appended}`,
        seq: appended,
        ...message,
      })),
      checkpointMessage: jest.fn(),
      closeInterruptedMessages: jest.fn().mockResolvedValue(0),
    };
    sessionRepository = { update: jest.fn() };
    sessionService = {
      getSession: jest.fn().mockResolvedValue({ id: 'session-1', title: 'T' }),
      syncReadinessStatus: jest.fn().mockResolvedValue('scoping'),
    };
    toolsService = {
      getToolDefinitions: jest.fn().mockReturnValue([]),
      execute: jest.fn(async () => ({
        modelResult: { ok: true },
        summary: 'PRD updated',
      })),
    };

    service = new BuilderInterviewOrchestratorService(
      {
        anthropic: { apiKey: 'test' },
        builder: { interviewModel: 'claude-opus-5', maxToolIterations: 4 },
      } as any,
      {
        getPromptByCode: jest.fn().mockResolvedValue('Interview them.'),
      } as any,
      sessionService as any,
      {
        getOrCreateDoc: jest
          .fn()
          .mockResolvedValue({ draft: createEmptyPrdDocument() }),
        computeReadiness: jest
          .fn()
          .mockReturnValue({ score: 40, ready: false, blockers: [] }),
      } as any,
      { buildContextBlock: jest.fn().mockResolvedValue('context') } as any,
      toolsService as any,
      messageRepository as any,
      { record: jest.fn() } as any,
      // Worked examples are best-effort context; the turn must not depend on
      // them, so the stub simply supplies none.
      {
        digestsForSession: jest
          .fn()
          .mockResolvedValue({ digests: [], chosen: [] }),
      } as any,
      sessionRepository as any,
    );

    // `create` is the non-streaming call the cheap-model summariser uses;
    // `stream` is the turn itself. Both are needed once a history is long
    // enough to be summarised.
    summariseCalls = 0;
    (service as any).client = {
      messages: {
        stream: jest.fn((params: any) => {
          requests.push(JSON.parse(JSON.stringify(params.messages)));
          return streams.shift();
        }),
        create: jest.fn(async () => {
          summariseCalls += 1;
          return { content: [{ type: 'text', text: 'They want archiving.' }] };
        }),
      },
    };
  });

  it('allocates the assistant row before the model runs, not after', async () => {
    streams = [
      fakeStream([{ type: 'text', text: 'Here is the plan.' }], 'end_turn'),
    ];

    await drain();

    // Two appends, in transcript order, and the assistant row is opened empty
    // and marked as still moving.
    expect(messageRepository.appendMessage).toHaveBeenCalledTimes(2);
    expect(messageRepository.appendMessage.mock.calls[0][1].role).toBe(
      BuilderMessageRole.USER,
    );
    const assistant = messageRepository.appendMessage.mock.calls[1][1];
    expect(assistant.role).toBe(BuilderMessageRole.ASSISTANT);
    expect(assistant.content).toBeNull();
    expect(assistant.metadata.streaming).toBe(true);
  });

  it('checkpoints after each tool, so a restart mid-turn keeps the work already done', async () => {
    streams = [
      fakeStream(
        [
          { type: 'text', text: 'Let me check the workflow.' },
          { type: 'tool_use', id: 'tu-1', name: 'github_read_file', input: {} },
          { type: 'tool_use', id: 'tu-2', name: 'update_prd', input: {} },
        ],
        'tool_use',
      ),
      fakeStream([{ type: 'text', text: 'Ready to build.' }], 'end_turn'),
    ];

    await drain();

    // One for the prose of the first pass, one per tool, one to settle.
    expect(messageRepository.checkpointMessage).toHaveBeenCalledTimes(4);
    expect(messageRepository.checkpointMessage.mock.calls[0][0]).toBe('msg-2');

    // The checkpoint taken after the first tool already carries that tool's
    // call and result — the thing that used to exist only in local arrays.
    const afterFirstTool = messageRepository.checkpointMessage.mock.calls[1][1];
    expect(afterFirstTool.toolCalls).toHaveLength(1);
    expect(afterFirstTool.toolResults).toHaveLength(1);
    expect(afterFirstTool.content).toBe('Let me check the workflow.');
    expect(afterFirstTool.metadata.streaming).toBe(true);
  });

  it('settles the row exactly once, clearing streaming', async () => {
    streams = [fakeStream([{ type: 'text', text: 'Done.' }], 'end_turn')];

    await drain();

    const calls = messageRepository.checkpointMessage.mock.calls;
    const final = calls[calls.length - 1][1];
    expect(final.metadata.streaming).toBe(false);
    expect(final.metadata.stopReason).toBe('end_turn');
    expect(final.content).toBe('Done.');
    expect(
      calls.filter(([, patch]) => patch.metadata?.streaming === false),
    ).toHaveLength(1);
  });

  it('settles the row when the turn dies mid-stream', async () => {
    (service as any).client.messages.stream = jest.fn(() => {
      throw new Error('anthropic exploded');
    });

    const frames = await drain();

    expect(frames.some((frame) => frame.event === 'error')).toBe(true);
    const calls = messageRepository.checkpointMessage.mock.calls;
    const final = calls[calls.length - 1][1];
    expect(final.metadata.streaming).toBe(false);
    expect(final.metadata.errored).toBe(true);
  });

  it('does not fail the turn when a checkpoint cannot be written', async () => {
    // Losing a save point is a smaller harm than killing a working turn.
    messageRepository.checkpointMessage.mockRejectedValue(new Error('db gone'));
    streams = [fakeStream([{ type: 'text', text: 'Done.' }], 'end_turn')];

    const frames = await drain();

    expect(frames.some((frame) => frame.event === 'done')).toBe(true);
    expect(frames.some((frame) => frame.event === 'error')).toBe(false);
  });

  it('discards a truncated tool call and asks the model to split the write', async () => {
    // The failure this guards: a `max_tokens` stop carries a half-written
    // tool_use whose input the SDK reconstructs by partial parse. Running it
    // would apply a fragment of the intended patch; dropping it silently used
    // to end the turn with the PRD unchanged and nothing on screen.
    streams = [
      fakeStream(
        [
          { type: 'text', text: 'Writing up the requirements now.' },
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'update_prd',
            input: { ops: [{ op: 'add', path: '/requirements/-' }] },
          },
        ],
        'max_tokens',
      ),
      fakeStream(
        [{ type: 'tool_use', id: 'tu-2', name: 'update_prd', input: {} }],
        'tool_use',
      ),
      fakeStream([{ type: 'text', text: 'Requirements are in.' }], 'end_turn'),
    ];

    const frames = await drain();

    // The truncated call never ran; the retry's did.
    expect(toolsService.execute).toHaveBeenCalledTimes(1);
    expect(toolsService.execute.mock.calls[0][0]).toBe('update_prd');
    expect(frames.some((frame) => frame.event === 'error')).toBe(false);

    // The retry pass was told why, in the same request that carries the
    // partial prose — without the nudge the model re-sends the same patch.
    const retry = requests[1];
    const nudge = retry[retry.length - 1];
    expect(nudge.role).toBe('user');
    expect(nudge.content).toContain('cut off');
    // A truncated tool_use has no result to pair it with, so it must not be
    // replayed — the API rejects a dangling one.
    const replayed = retry[retry.length - 2];
    expect(replayed.role).toBe('assistant');
    expect(replayed.content).toEqual([
      { type: 'text', text: 'Writing up the requirements now.' },
    ]);
  });

  it('gives up with an actionable error when every retry is truncated too', async () => {
    streams = [
      fakeStream([{ type: 'text', text: 'Writing.' }], 'max_tokens'),
      fakeStream([{ type: 'text', text: 'Writing.' }], 'max_tokens'),
      fakeStream([{ type: 'text', text: 'Writing.' }], 'max_tokens'),
    ];

    const frames = await drain();

    const error = frames.find((frame) => frame.event === 'error');
    expect(error?.data.code).toBe('response_truncated');
    // Three passes: the original plus BUILDER_MAX_TRUNCATION_RETRIES.
    expect((service as any).client.messages.stream).toHaveBeenCalledTimes(3);

    // Persisted, not only streamed — an `error` frame reaches the open tab and
    // nothing else, so a reload would otherwise show the turn as silence.
    const calls = messageRepository.checkpointMessage.mock.calls;
    const final = calls[calls.length - 1][1];
    expect(final.metadata.errored).toBe(true);
    expect(final.metadata.errorMessage).toContain('one section at a time');
  });

  it('flags a turn that came back with nothing in it', async () => {
    streams = [fakeStream([], 'end_turn')];

    const frames = await drain();

    const error = frames.find((frame) => frame.event === 'error');
    expect(error?.data.code).toBe('empty_turn');
    const calls = messageRepository.checkpointMessage.mock.calls;
    expect(calls[calls.length - 1][1].metadata.errored).toBe(true);
  });

  it('closes a row left open by a turn that never came back', async () => {
    messageRepository.closeInterruptedMessages.mockResolvedValue(1);
    streams = [fakeStream([{ type: 'text', text: 'Done.' }], 'end_turn')];

    await drain();

    expect(messageRepository.closeInterruptedMessages).toHaveBeenCalledWith(
      'session-1',
    );
    // Before this turn's own row is opened, so the transcript never shows two.
    expect(
      messageRepository.closeInterruptedMessages.mock.invocationCallOrder[0],
    ).toBeLessThan(messageRepository.appendMessage.mock.invocationCallOrder[0]);
  });

  describe('long interviews', () => {
    // 40 messages is the summarisation threshold; 60 puts the boundary well
    // past it. Each is a complete user/assistant pair so the boundary can land
    // on a user message without splitting a tool_use from its result.
    const longHistory = () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: `m-${i}`,
        seq: i + 1,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`,
        toolCalls: null,
        toolResults: null,
      }));

    it('reuses a stored summary instead of paying for it again every turn', async () => {
      messageRepository.listBySession.mockResolvedValue(longHistory());
      // A summary already covering this boundary.
      sessionService.getSession.mockResolvedValue({
        id: 'session-1',
        title: 'T',
        metadata: {
          interviewSummary: { uptoSeq: 44, text: 'They want archiving.' },
        },
      });
      streams = [fakeStream([{ type: 'text', text: 'Noted.' }], 'end_turn')];

      await drain();

      // The stored digest is reused, so the cheap-model summariser never runs.
      expect(summariseCalls).toBe(0);
      const replayed = requests[0];
      expect(JSON.stringify(replayed)).toContain('They want archiving.');
    });

    it('stores a summary it had to compute, so the next turn does not', async () => {
      messageRepository.listBySession.mockResolvedValue(longHistory());
      sessionService.getSession.mockResolvedValue({
        id: 'session-1',
        title: 'T',
        metadata: {},
      });
      streams = [
        fakeStream([{ type: 'text', text: 'A digest.' }], 'end_turn'),
        fakeStream([{ type: 'text', text: 'Noted.' }], 'end_turn'),
      ];

      await drain();

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({
          metadata: expect.objectContaining({
            interviewSummary: expect.objectContaining({ uptoSeq: 44 }),
          }),
        }),
      );
    });
  });
});
