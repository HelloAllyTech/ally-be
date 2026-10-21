import { CharacterInterviewOrchestratorService } from '../character-interview-orchestrator.service';
import { CharacterInterviewToolsService } from '../character-interview-tools.service';
import { CharacterInterviewMessageRole } from '../../enum/character-interview.enum';

/**
 * The character interview with validated turns on
 * (`validated_agent_turns.characterInterview`): the same retries the existing
 * loop specs pin — truncation, unreadable tool calls, empty passes, an
 * abandoned stream, provider failures — plus what the validated turn adds: the
 * reply arrives only through ask_question / finish_turn, and it cannot say the
 * draft is saved unless save_character_draft succeeded.
 *
 * The real tool belt is used for its definitions; `execute` is scripted.
 */
describe('CharacterInterviewOrchestratorService — validated turns', () => {
  const MAX_ITERATIONS = 8;
  type Pass = { content: any[]; stopReason: string } | Error;

  let passes: Pass[];
  let requests: any[];
  let appendMessage: jest.Mock;
  let toolsExecute: jest.Mock;
  let enabled: jest.Mock;
  let service: CharacterInterviewOrchestratorService;

  const text = (value: string) => ({ type: 'text', text: value });
  const call = (id: string, name: string, input: Record<string, any> = {}) => ({
    type: 'tool_use',
    id,
    name,
    input,
  });
  const pass = (content: any[], stopReason = 'tool_use') => ({
    content,
    stopReason,
  });
  const draft = (id: string) =>
    call(id, 'save_character_draft', { name: 'Asha', age: 34 });

  const savedOutcome = {
    modelResult: { ok: true, note: 'Draft delivered.' },
    summary: 'Character draft ready: Asha',
    events: [{ event: 'character_draft', data: { draft: { name: 'Asha' } } }],
    endTurn: true,
  };

  beforeEach(() => {
    passes = [];
    requests = [];
    let seq = 0;
    appendMessage = jest.fn().mockImplementation(async () => ({ seq: ++seq }));
    enabled = jest.fn().mockResolvedValue(true);
    const realTools = new CharacterInterviewToolsService(
      {} as any,
      {} as any,
      {} as any,
    );
    toolsExecute = jest.fn(async (name: string, input: any) => {
      if (name === 'ask_question' || name === 'finish_turn') {
        return realTools.execute(name, input, {} as any);
      }
      if (name === 'save_character_draft') return savedOutcome;
      return { modelResult: { ok: true, passages: [] }, summary: 'Searched' };
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
        getToolDefinitions: (options: any) =>
          realTools.getToolDefinitions(options),
        execute: toolsExecute,
      } as any,
      { listBySession: jest.fn().mockResolvedValue([]), appendMessage } as any,
      { record: jest.fn() } as any,
      {
        create: jest.fn().mockReturnValue({
          name: 'anthropic',
          async *stream(request: any) {
            requests.push({
              system: request.system,
              tools: (request.tools ?? []).map((t: any) => t.name),
              messages: JSON.parse(JSON.stringify(request.messages)),
            });
            const next = passes.shift();
            if (!next) throw new Error('no more scripted passes');
            if (next instanceof Error) throw next;
            for (const block of next.content) {
              if (block.type === 'text') {
                yield { type: 'text_delta', text: block.text };
              }
            }
            yield {
              type: 'final',
              message: {
                content: next.content,
                stopReason: next.stopReason,
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            };
          },
        }),
      } as any,
      { enabled } as any,
    );
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
  const events = (frames: any[]) => frames.map((frame) => frame.event);
  const tokens = (frames: any[]) =>
    frames.filter((f) => f.event === 'token').map((f) => f.data.delta);
  const assistantRow = () =>
    appendMessage.mock.calls
      .map(([, row]) => row)
      .filter((row) => row.role === CharacterInterviewMessageRole.ASSISTANT)
      .pop();
  const resultFor = (id: string): any => {
    for (const request of requests) {
      for (const message of request.messages) {
        if (!Array.isArray(message.content)) continue;
        const block = message.content.find(
          (b: any) => b.type === 'tool_result' && b.tool_use_id === id,
        );
        if (block) return JSON.parse(block.content);
      }
    }
    return undefined;
  };

  it('reads the switch per turn, offers finish_turn and tells the model how a turn ends', async () => {
    passes = [
      pass([
        call('q1', 'ask_question', {
          message: 'Let us start with who she is.',
          prompt: 'What is her name?',
          kind: 'freeText',
        }),
      ]),
    ];

    const frames = await collect();

    expect(enabled).toHaveBeenCalledWith('characterInterview');
    expect(requests[0].tools).toEqual([
      'ask_question',
      'get_voices',
      'search_corpus',
      'save_character_draft',
      'finish_turn',
    ]);
    expect(requests[0].system).toContain('# How a turn ends');
    expect(tokens(frames)).toEqual(['Let us start with who she is.']);
    expect(events(frames).slice(-3)).toEqual(['question', 'receipt', 'done']);
    expect(assistantRow().content).toBe('Let us start with who she is.');
    expect(assistantRow().metadata).toMatchObject({ loop: 'validated' });
    expect(assistantRow().metadata.questions).toHaveLength(1);
  });

  it('saves the draft, then closes the turn with a checked message', async () => {
    passes = [
      pass([text('Saving.'), draft('d1')]),
      pass([
        call('f1', 'finish_turn', {
          message: "Thanks — Asha's draft is ready for your review.",
        }),
      ]),
    ];

    const frames = await collect();

    expect(requests[1].tools).toEqual(['finish_turn']);
    expect(events(frames).indexOf('character_draft')).toBeLessThan(
      events(frames).indexOf('token'),
    );
    expect(tokens(frames)).toEqual([
      "Thanks — Asha's draft is ready for your review.",
    ]);
    const receipt = frames.find((f) => f.event === 'receipt').data;
    expect(receipt.changed).toEqual(['Character draft saved: Asha']);
    expect(assistantRow().metadata.characterDraft).toEqual({ name: 'Asha' });
    expect(assistantRow().metadata.workingNotes).toEqual(['Saving.']);
  });

  it('ignores a second save the turn no longer offered — the first one stands', async () => {
    // Seen live on gemini-2.5-pro (2026-10-21): after the draft saved, the
    // model sent save_character_draft again. It is refused without running,
    // and must not read as a failed save under a reply that says it saved.
    passes = [
      pass([draft('d1')]),
      pass([draft('d2')]),
      pass([
        call('f1', 'finish_turn', {
          message: "Aisha's draft is ready for your review.",
        }),
      ]),
    ];

    const frames = await collect();

    expect(toolsExecute.mock.calls.map(([name]) => name)).toEqual([
      'save_character_draft',
      'finish_turn',
    ]);
    const receipt = frames.find((f) => f.event === 'receipt').data;
    expect(receipt.failed).toEqual([]);
    expect(receipt.warnings).toEqual([]);
    expect(assistantRow().metadata.rejections).toBeUndefined();
  });

  it('will not say the draft is ready when save_character_draft failed', async () => {
    toolsExecute.mockImplementationOnce(async () => ({
      modelResult: {
        ok: false,
        error: 'validation_failed',
        message: 'The character draft is invalid.',
        errors: ['age must be between 1 and 150'],
      },
      summary: 'Draft rejected: 1 validation error(s)',
    }));
    passes = [
      pass([draft('d1')]),
      pass([
        call('f1', 'finish_turn', {
          message: 'Asha is ready for your review.',
        }),
      ]),
      pass([draft('d2')]),
      pass([
        call('f2', 'finish_turn', {
          message: 'Asha is ready for your review.',
        }),
      ]),
    ];

    const frames = await collect();

    const reasons = resultFor('f1').reasons.join(' ');
    expect(reasons).toContain('nothing since has repaired it');
    expect(reasons).toContain('something changed, but nothing did');
    expect(tokens(frames)).toEqual(['Asha is ready for your review.']);
    const receipt = frames.find((f) => f.event === 'receipt').data;
    expect(receipt.failed).toEqual([
      'Save the character draft (Asha) — The character draft is invalid. age must be between 1 and 150',
    ]);
    expect(receipt.changed).toEqual(['Character draft saved: Asha']);
  });

  it('sends back a question asked in the same step as a corpus search', async () => {
    passes = [
      pass([
        call('s1', 'search_corpus', { query: 'how does burnout present?' }),
        call('q1', 'ask_question', {
          message: 'Burnout often shows as exhaustion.',
          prompt: 'How tired is she?',
          kind: 'freeText',
        }),
      ]),
      pass([
        call('q2', 'ask_question', {
          message: 'The corpus has nothing on this, so I will ask you.',
          prompt: 'How tired is she?',
          kind: 'freeText',
        }),
      ]),
    ];

    const frames = await collect();

    expect(resultFor('q1').reasons.join(' ')).toContain(
      'before their results existed',
    );
    expect(tokens(frames)).toEqual([
      'The corpus has nothing on this, so I will ask you.',
    ]);
    expect(frames.filter((f) => f.event === 'question')).toHaveLength(1);
    const receipt = frames.find((f) => f.event === 'receipt').data;
    expect(receipt.searched).toEqual([
      'Corpus search "how does burnout present?" — 0 passages',
    ]);
  });

  it('shows the admin what happened when the corpus was unreachable, not the note to the model', async () => {
    toolsExecute.mockImplementationOnce(async () => ({
      modelResult: {
        ok: false,
        error:
          'The reference corpus could not be reached. Do not tell the admin it has nothing.',
      },
      summary: 'Corpus search failed (retrieval unavailable)',
    }));
    passes = [
      pass([call('s1', 'search_corpus', { query: 'burnout' })]),
      pass([
        call('q1', 'ask_question', {
          message:
            'I could not reach the reference material, so I will ask you.',
          prompt: 'How tired is she?',
          kind: 'freeText',
        }),
      ]),
    ];

    const frames = await collect();

    expect(frames.find((f) => f.event === 'receipt').data.failed).toEqual([
      'Corpus search "burnout" — the reference corpus could not be reached',
    ]);
  });

  describe('the retries the existing loop specs pin', () => {
    it('discards a truncated draft and asks the model to write a tighter one', async () => {
      passes = [
        pass([text('Writing her profile now.'), draft('d1')], 'max_tokens'),
        pass([draft('d2')]),
        pass([
          call('f1', 'finish_turn', {
            message: 'Asha is saved — review her in the form.',
          }),
        ]),
      ];

      const frames = await collect();

      expect(toolsExecute.mock.calls.map(([name]) => name)).toEqual([
        'save_character_draft',
        'finish_turn',
      ]);
      expect(events(frames)).not.toContain('error');
      const retry = requests[1].messages;
      expect(retry[retry.length - 1].content).toContain('cut off');
      expect(retry[retry.length - 1].content).toContain('shorter');
      expect(retry[retry.length - 2]).toEqual({
        role: 'assistant',
        content: [text('Writing her profile now.')],
      });
    });

    it('gives up with an actionable error when every retry is truncated too', async () => {
      passes = [1, 2, 3].map(() => pass([text('Writing.')], 'max_tokens'));

      const frames = await collect();

      expect(frames.find((f) => f.event === 'error')?.data.code).toBe(
        'response_truncated',
      );
      expect(requests).toHaveLength(3);
      expect(assistantRow().metadata.errored).toBe(true);
      expect(assistantRow().metadata.errorMessage).toContain(
        'no character was created',
      );
    });

    it('retries an unreadable tool call verbatim, then gives up with its own message', async () => {
      passes = [1, 2, 3].map(() => pass([], 'invalid_tool_call'));

      const frames = await collect();

      expect(requests[1].messages).toEqual(requests[0].messages);
      const error = frames.find((f) => f.event === 'error');
      expect(error?.data.code).toBe('invalid_tool_call');
      expect(error?.data.message).toContain('could not read');
      expect(requests).toHaveLength(3);
      expect(assistantRow().metadata.errored).toBe(true);
    });

    it('flags a turn that came back with nothing in it', async () => {
      // Two empty-pass retries, as before; then the two nudges a validated
      // turn gives any pass that did not end through a reply.
      passes = [1, 2, 3, 4, 5].map(() => pass([], 'end_turn'));

      const frames = await collect();

      expect(requests).toHaveLength(5);
      expect(frames.find((f) => f.event === 'error')?.data.code).toBe(
        'empty_turn',
      );
      expect(assistantRow().metadata.errored).toBe(true);
    });

    it('writes the transcript row when the consumer abandons the turn', async () => {
      passes = [
        pass([call('s1', 'search_corpus', { query: 'burnout' })]),
        pass([call('f1', 'finish_turn', { message: 'Unused.' })]),
      ];

      const frames: any[] = [];
      for await (const frame of service.streamTurn(
        'sess-1',
        { message: 'Build her now.' } as any,
        7,
      )) {
        frames.push(frame);
        if (frame.event === 'tool_result') break;
      }

      expect(events(frames)).not.toContain('done');
      const rows = appendMessage.mock.calls.filter(
        ([, row]) => row.role === CharacterInterviewMessageRole.ASSISTANT,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0][1].metadata.errored).toBe(true);
      expect(rows[0][1].metadata.errorMessage).toContain(
        'send your message again',
      );
      expect(rows[0][1].metadata.receipt.searched).toHaveLength(1);
    });

    it('classifies a provider failure the same way, without the payload', async () => {
      const error: any = new Error(
        '400 {"type":"error","error":{"message":"Your credit balance is too low"}}',
      );
      error.status = 400;
      passes = [error];

      const frames = await collect();

      const frame = frames.find((f) => f.event === 'error');
      expect(frame?.data.message).not.toContain('credit balance');
      expect(assistantRow().metadata.errorMessage).not.toContain(
        'credit balance',
      );
      expect(events(frames).slice(-2)).toEqual(['receipt', 'done']);
    });
  });
});
