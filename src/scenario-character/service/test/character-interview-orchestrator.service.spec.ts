import { CharacterInterviewOrchestratorService } from '../character-interview-orchestrator.service';
import { CharacterInterviewMessageRole } from '../../enum/character-interview.enum';

/**
 * Turn-loop tests with a fully mocked Anthropic client. These cover what the
 * loop does with a response it cannot use — the model running out of output
 * room mid-`save_character_draft` — not the model itself.
 */
describe('CharacterInterviewOrchestratorService — truncated turns', () => {
  const MAX_ITERATIONS = 8;

  let service: CharacterInterviewOrchestratorService;
  let streamMock: jest.Mock;
  let appendMessage: jest.Mock;
  let toolsExecute: jest.Mock;
  let seq: number;
  // Snapshotted per pass: the orchestrator mutates one `messages` array in
  // place, so jest's recorded call args all point at its final state.
  let requests: any[][];

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

  const draftBlock = (id: string) => ({
    type: 'tool_use',
    id,
    name: 'save_character_draft',
    input: { name: 'Asha', age: 34 },
  });

  const collect = async (): Promise<any[]> => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn(
      'sess-1',
      { message: 'Build her now.' } as any,
      7,
    )) {
      frames.push(frame);
    }
    return frames;
  };

  beforeEach(() => {
    seq = 0;
    requests = [];
    streamMock = jest.fn();
    appendMessage = jest.fn().mockImplementation(async () => ({ seq: ++seq }));
    toolsExecute = jest.fn().mockResolvedValue({
      modelResult: { ok: true },
      summary: 'saved',
    });

    service = new CharacterInterviewOrchestratorService(
      {
        anthropic: { apiKey: 'test-key' },
        characterInterview: {
          model: 'claude-test',
          maxToolIterations: MAX_ITERATIONS,
        },
      } as any,
      { getPromptByCode: jest.fn().mockResolvedValue('SYSTEM') } as any,
      {
        getSession: jest
          .fn()
          .mockResolvedValue({ id: 'sess-1', status: 'in_progress' }),
      } as any,
      {
        getToolDefinitions: jest.fn().mockReturnValue([]),
        execute: toolsExecute,
      } as any,
      { listBySession: jest.fn().mockResolvedValue([]), appendMessage } as any,
      { record: jest.fn() } as any,
    );

    (service as any).client = {
      messages: {
        stream: (params: any) => {
          requests.push(JSON.parse(JSON.stringify(params.messages)));
          return streamMock(params);
        },
      },
    };
  });

  it('discards a truncated draft and asks the model to write a tighter one', async () => {
    // A `max_tokens` stop carries a half-written tool_use whose input the SDK
    // reconstructs by partial parse. Saving it would create a fragment of a
    // character; dropping it silently used to end a twenty-turn interview with
    // the agent announcing a draft that never existed.
    streamMock
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'text', text: 'Writing her profile now.' },
            draftBlock('tu-1'),
          ],
          'max_tokens',
        ),
      )
      .mockReturnValueOnce(makeStream([draftBlock('tu-2')], 'tool_use'))
      .mockReturnValueOnce(
        makeStream([{ type: 'text', text: 'Asha is ready.' }], 'end_turn'),
      );

    const frames = await collect();

    // The truncated call never ran; the retry's did.
    expect(toolsExecute).toHaveBeenCalledTimes(1);
    expect(toolsExecute.mock.calls[0][0]).toBe('save_character_draft');
    expect(frames.map((frame) => frame.event)).not.toContain('error');

    // The retry pass was told why. `save_character_draft` cannot be split, so
    // the instruction is to write less of it rather than to send it in parts.
    const retry = requests[1];
    const nudge = retry[retry.length - 1];
    expect(nudge.role).toBe('user');
    expect(nudge.content).toContain('cut off');
    expect(nudge.content).toContain('shorter');
    // A truncated tool_use has no result to pair it with, so only the
    // completed text is replayed — the API rejects a dangling one.
    const replayed = retry[retry.length - 2];
    expect(replayed.role).toBe('assistant');
    expect(replayed.content).toEqual([
      { type: 'text', text: 'Writing her profile now.' },
    ]);
  });

  it('gives up with an actionable error when every retry is truncated too', async () => {
    streamMock.mockReturnValue(
      makeStream([{ type: 'text', text: 'Writing.' }], 'max_tokens'),
    );

    const frames = await collect();

    const error = frames.find((frame) => frame.event === 'error');
    expect(error?.data.code).toBe('response_truncated');
    // Bounded by the retry cap, well short of the 8-iteration budget — a
    // truncation that keeps repeating is not fixed by spending the rest of it.
    expect(streamMock).toHaveBeenCalledTimes(3);

    // Persisted, not only streamed — an `error` frame reaches the open tab and
    // nothing else, so a reload would otherwise show the turn as silence.
    const assistantRow = appendMessage.mock.calls[1][1];
    expect(assistantRow.role).toBe(CharacterInterviewMessageRole.ASSISTANT);
    expect(assistantRow.metadata.errored).toBe(true);
    expect(assistantRow.metadata.errorMessage).toContain(
      'no character was created',
    );
  });

  it('flags a turn that came back with nothing in it', async () => {
    streamMock.mockReturnValue(makeStream([], 'end_turn'));

    const frames = await collect();

    expect(frames.find((frame) => frame.event === 'error')?.data.code).toBe(
      'empty_turn',
    );
    expect(appendMessage.mock.calls[1][1].metadata.errored).toBe(true);
  });
});
