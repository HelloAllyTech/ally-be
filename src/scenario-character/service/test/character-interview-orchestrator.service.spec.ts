import { CharacterInterviewOrchestratorService } from '../character-interview-orchestrator.service';
import { CharacterInterviewMessageRole } from '../../enum/character-interview.enum';

/**
 * Turn-loop tests with a fully mocked provider adapter. These cover what the
 * loop does with a response it cannot use — the model running out of output
 * room mid-`save_character_draft` — not the model itself.
 *
 * The loop is provider-agnostic, so these drive the neutral stream protocol
 * (`text_delta`s then one `final`) rather than any SDK's own event shape.
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
          yield { type: 'text_delta', text: block.text };
        }
      }
      yield {
        type: 'final',
        message: {
          content: blocks,
          stopReason,
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      };
    },
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
        execute: toolsExecute,
      } as any,
      { listBySession: jest.fn().mockResolvedValue([]), appendMessage } as any,
      { record: jest.fn() } as any,
      {
        create: jest.fn().mockReturnValue({
          name: 'anthropic',
          stream: (request: any) => {
            requests.push(JSON.parse(JSON.stringify(request.messages)));
            return streamMock(request);
          },
        }),
      } as any,
    );
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

  it('flags a truncated wrap-up pass instead of persisting it as a success', async () => {
    // The model keeps calling save_character_draft until the iteration cap is
    // hit, triggering a tool-less wrap-up pass. If that wrap-up pass is itself
    // cut off, there is no retry budget left for it — it must not be saved as
    // a complete, successful reply.
    let counter = 0;
    streamMock.mockImplementation(() => {
      counter += 1;
      return counter <= MAX_ITERATIONS
        ? makeStream([draftBlock(`tu-${counter}`)], 'tool_use')
        : makeStream(
            [{ type: 'text', text: 'Asha is mostly done, but cut o' }],
            'max_tokens',
          );
    });

    const frames = await collect();
    const events = frames.map((frame) => frame.event);

    expect(streamMock).toHaveBeenCalledTimes(MAX_ITERATIONS + 1);
    const error = frames.find((frame) => frame.event === 'error');
    expect(error?.data.code).toBe('response_truncated');
    expect(events[events.length - 1]).toBe('done');

    const assistantRow = appendMessage.mock.calls[1][1];
    expect(assistantRow.metadata.errored).toBe(true);
    expect(assistantRow.metadata.errorMessage).toContain(
      'no character was created',
    );
  });

  it('retries an unreadable tool call rather than losing the turn', async () => {
    // Gemini returns MALFORMED_FUNCTION_CALL intermittently against a schema
    // this size. The candidate is empty, so treating it as a normal turn ends
    // a twenty-question interview with "nothing was asked".
    streamMock
      .mockReturnValueOnce(makeStream([], 'invalid_tool_call'))
      .mockReturnValueOnce(makeStream([draftBlock('tu-1')], 'tool_use'))
      .mockReturnValueOnce(
        makeStream([{ type: 'text', text: 'Asha is ready.' }], 'end_turn'),
      );

    const frames = await collect();

    expect(frames.map((frame) => frame.event)).not.toContain('error');
    expect(toolsExecute).toHaveBeenCalledTimes(1);
    // Retried verbatim: there is nothing partial to replay and nothing to tell
    // the model, which cannot see the malformed call either.
    expect(requests[1]).toEqual(requests[0]);
  });

  it('gives up on an unreadable tool call with its own message', async () => {
    streamMock.mockReturnValue(makeStream([], 'invalid_tool_call'));

    const frames = await collect();

    const error = frames.find((frame) => frame.event === 'error');
    expect(error?.data.code).toBe('invalid_tool_call');
    // Not reported as an empty turn — the two are indistinguishable from the
    // response alone but need different advice.
    expect(error?.data.message).toContain('could not read');
    expect(streamMock).toHaveBeenCalledTimes(3);
    expect(appendMessage.mock.calls[1][1].metadata.errored).toBe(true);
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
