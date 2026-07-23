import { CopilotOrchestratorService } from '../copilot-orchestrator.service';
import { CopilotSseFrame } from '../../type/copilot-sse-event.type';
import { CopilotMessageRole } from '../../enum/copilot-message-role.enum';

/**
 * Orchestrator loop tests with a fully mocked Anthropic client — verifies the
 * tool loop mechanics (iteration cap, endTurn tools, frame ordering,
 * persistence), not the model.
 */
describe('CopilotOrchestratorService', () => {
  const MAX_ITERATIONS = 3;

  let service: CopilotOrchestratorService;
  let streamMock: jest.Mock;
  let appendMessage: jest.Mock;
  let toolsExecute: jest.Mock;
  let usageRecord: jest.Mock;
  let seq: number;

  const makeStream = (blocks: any[], stopReason: string) => ({
    async *[Symbol.asyncIterator]() {
      for (const block of blocks) {
        if (block.type === 'text') {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: block.text },
          };
        }
      }
    },
    finalMessage: async () => ({
      content: blocks,
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });

  const toolUseBlock = (id: string) => ({
    type: 'tool_use',
    id,
    name: 'update_spec',
    input: { ops: [], summary: 'noop' },
  });

  beforeEach(() => {
    seq = 0;
    streamMock = jest.fn();
    appendMessage = jest.fn().mockImplementation(async () => ({ seq: ++seq }));
    toolsExecute = jest.fn().mockResolvedValue({
      modelResult: { ok: true },
      summary: 'applied',
    });
    usageRecord = jest.fn().mockResolvedValue(undefined);

    const configService = {
      anthropic: { apiKey: 'test-key' },
      roleplayStudio: {
        copilotModel: 'claude-test',
        maxToolIterations: MAX_ITERATIONS,
      },
    } as any;
    const promptSharedService = {
      getPromptByCode: jest.fn().mockResolvedValue('SYSTEM {{currentSpec}}'),
    } as any;
    const copilotSessionService = {
      getSession: jest
        .fn()
        .mockResolvedValue({ id: 'sess-1', specId: 'spec-1', createdBy: 7 }),
    } as any;
    const copilotToolsService = {
      getToolDefinitions: jest.fn().mockReturnValue([]),
      execute: toolsExecute,
    } as any;
    const copilotMessageRepository = {
      listBySession: jest.fn().mockResolvedValue([]),
      appendMessage,
    } as any;
    const roleplaySpecService = {
      getSpec: jest.fn().mockResolvedValue({ id: 'spec-1', draftSpec: {} }),
    } as any;
    const llmUsage = { record: usageRecord } as any;
    const testRunService = {
      getReport: jest.fn().mockResolvedValue({
        id: 'report-1',
        specVersionId: 'ver-1',
        testCaseSnapshot: { title: 'Case', type: 'condition' },
        reportMarkdown: '# Test report',
      }),
    } as any;

    service = new CopilotOrchestratorService(
      configService,
      promptSharedService,
      copilotSessionService,
      copilotToolsService,
      copilotMessageRepository,
      roleplaySpecService,
      llmUsage,
      testRunService,
    );
    (service as any).client = { messages: { stream: streamMock } };
  });

  const collect = async (): Promise<CopilotSseFrame[]> => {
    const frames: CopilotSseFrame[] = [];
    for await (const frame of service.streamTurn(
      'sess-1',
      { message: 'hello' },
      7,
    )) {
      frames.push(frame);
    }
    return frames;
  };

  it('streams tokens and finishes with done for a plain text turn', async () => {
    streamMock.mockReturnValue(
      makeStream([{ type: 'text', text: 'Hi trainer!' }], 'end_turn'),
    );

    const frames = await collect();

    expect(frames.map((frame) => frame.event)).toEqual(['token', 'done']);
    expect(frames[0].data.delta).toBe('Hi trainer!');
    expect(streamMock).toHaveBeenCalledTimes(1);

    // user message then assistant message persisted, seq from the repo.
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage.mock.calls[0][1].role).toBe(CopilotMessageRole.USER);
    expect(appendMessage.mock.calls[1][1].role).toBe(
      CopilotMessageRole.ASSISTANT,
    );
    expect(appendMessage.mock.calls[1][1].content).toBe('Hi trainer!');
    expect(frames[1].data.messageSeq).toBe(2);
    expect(usageRecord).toHaveBeenCalledTimes(1);
  });

  it('executes tools then continues until the model stops', async () => {
    streamMock
      .mockReturnValueOnce(makeStream([toolUseBlock('tu-1')], 'tool_use'))
      .mockReturnValueOnce(
        makeStream([{ type: 'text', text: 'All set.' }], 'end_turn'),
      );

    const frames = await collect();

    expect(frames.map((frame) => frame.event)).toEqual([
      'tool_call',
      'tool_result',
      'token',
      'done',
    ]);
    expect(toolsExecute).toHaveBeenCalledWith(
      'update_spec',
      { ops: [], summary: 'noop' },
      expect.objectContaining({ userId: 7 }),
    );
    expect(streamMock).toHaveBeenCalledTimes(2);

    // The second API call must carry the assistant tool_use turn and the
    // tool_result user turn.
    const secondCallMessages = streamMock.mock.calls[1][0].messages;
    const lastTwo = secondCallMessages.slice(-2);
    expect(lastTwo[0].role).toBe('assistant');
    expect(lastTwo[1].role).toBe('user');
    expect(lastTwo[1].content[0].type).toBe('tool_result');
    expect(lastTwo[1].content[0].tool_use_id).toBe('tu-1');
  });

  it('threads sessionId into the tool context and persists question metadata', async () => {
    const question = { id: 'q-1', prompt: 'Which skill?', kind: 'freeText' };
    toolsExecute.mockResolvedValueOnce({
      modelResult: { ok: true },
      summary: 'asked',
      events: [{ event: 'question', data: question }],
      endTurn: true,
    });
    streamMock.mockReturnValue(makeStream([toolUseBlock('tu-1')], 'tool_use'));

    const frames = await collect();

    expect(toolsExecute).toHaveBeenCalledWith(
      'update_spec',
      expect.anything(),
      expect.objectContaining({ sessionId: 'sess-1', userId: 7 }),
    );
    expect(frames.map((frame) => frame.event)).toEqual(
      expect.arrayContaining(['question']),
    );
    // Resume fidelity: the persisted assistant row carries the card payloads.
    const assistantRow = appendMessage.mock.calls[1][1];
    expect(assistantRow.metadata.questions).toEqual([question]);
  });

  it('makes a tool-less wrap-up pass when the tool loop hits the cap', async () => {
    // The model asks for a tool on every round-trip until the budget is spent;
    // the final tool-less pass lets it summarize instead of erroring out.
    let counter = 0;
    streamMock.mockImplementation(() => {
      counter += 1;
      return counter <= MAX_ITERATIONS
        ? makeStream([toolUseBlock(`tu-${counter}`)], 'tool_use')
        : makeStream(
            [{ type: 'text', text: 'Got most of it — reply "continue".' }],
            'end_turn',
          );
    });

    const frames = await collect();
    const events = frames.map((frame) => frame.event);

    // MAX_ITERATIONS tool round-trips + one tool-less wrap-up pass.
    expect(streamMock).toHaveBeenCalledTimes(MAX_ITERATIONS + 1);
    expect(toolsExecute).toHaveBeenCalledTimes(MAX_ITERATIONS);
    // The wrap-up pass is made without tools.
    expect(streamMock.mock.calls[MAX_ITERATIONS][0].tools).toBeUndefined();
    expect(events.filter((event) => event === 'tool_call')).toHaveLength(
      MAX_ITERATIONS,
    );
    // No raw error frame — the model wrapped up gracefully.
    expect(events).not.toContain('error');
    // The wrap-up text is streamed and persisted as the assistant message.
    expect(frames.find((frame) => frame.event === 'token')?.data.delta).toBe(
      'Got most of it — reply "continue".',
    );
    expect(events[events.length - 1]).toBe('done');
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage.mock.calls[1][1].content).toBe(
      'Got most of it — reply "continue".',
    );
    expect(appendMessage.mock.calls[1][1].toolCalls).toHaveLength(
      MAX_ITERATIONS,
    );
  });

  it('ends the turn immediately when a tool requests endTurn (ask_trainer)', async () => {
    streamMock.mockReturnValue(
      makeStream(
        [
          {
            type: 'tool_use',
            id: 'tu-q',
            name: 'ask_trainer',
            input: { prompt: 'Which skill?', kind: 'freeText' },
          },
        ],
        'tool_use',
      ),
    );
    toolsExecute.mockResolvedValue({
      modelResult: { ok: true, questionId: 'q-1' },
      summary: 'Asked: Which skill?',
      events: [
        {
          event: 'question',
          data: { id: 'q-1', prompt: 'Which skill?', kind: 'freeText' },
        },
      ],
      endTurn: true,
    });

    const frames = await collect();

    expect(frames.map((frame) => frame.event)).toEqual([
      'tool_call',
      'question',
      'tool_result',
      'done',
    ]);
    // endTurn means no second model round-trip.
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces stream failures as an error frame and still persists + closes', async () => {
    streamMock.mockImplementation(() => {
      throw new Error('anthropic unreachable');
    });

    const frames = await collect();
    const events = frames.map((frame) => frame.event);

    expect(events).toEqual(['error', 'done']);
    expect(frames[0].data.code).toBe('copilot_error');
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage.mock.calls[1][1].metadata.errored).toBe(true);
  });
});
