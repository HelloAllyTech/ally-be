import {
  AgentToolOutcome,
  createValidatedTurnState,
  ValidatedTurnAgent,
  ValidatedTurnState,
} from '../agent-turn.types';
import { joinCallsToResults } from '../agent-turn-receipt.util';
import { flushHeldFrames, runValidatedTurn } from '../validated-turn.runner';

/**
 * The shared validated-turn runner, against a fake agent with one lookup
 * (`search`), one edit (`edit`), a tool that asks for the turn to end
 * (`confirm_publish`) and the two ending tools. Each case scripts the model's
 * passes and reads what reached the person.
 */
describe('runValidatedTurn', () => {
  type Pass = { content: any[]; stopReason: string };

  let passes: Pass[];
  let requests: any[];
  let state: { changed: boolean };
  let execute: jest.Mock;

  const text = (value: string) => ({ type: 'text', text: value });
  const call = (id: string, name: string, input: Record<string, any> = {}) => ({
    type: 'tool_use',
    id,
    name,
    input,
  });
  const pass = (content: any[], stopReason = 'tool_use'): Pass => ({
    content,
    stopReason,
  });

  const tool = (name: string) => ({
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
  });
  const BELT = ['search', 'edit', 'confirm_publish', 'ask_user', 'finish_turn'];

  const outcomes: Record<string, (input: any) => AgentToolOutcome> = {
    search: () => ({
      modelResult: { ok: true, hits: [1, 2] },
      summary: 'Searched',
    }),
    edit: () => {
      state.changed = true;
      return { modelResult: { ok: true }, summary: 'Edited' };
    },
    confirm_publish: () => ({
      modelResult: { ok: true, awaitingConfirmation: true },
      summary: 'Asked to confirm',
      events: [
        { event: 'question', data: { id: 'q-confirm', prompt: 'Publish?' } },
      ],
      endTurn: true,
    }),
    ask_user: (input) => ({
      modelResult: { ok: true },
      summary: 'Asked',
      events: [
        { event: 'question', data: { id: 'q-ask', prompt: input.prompt } },
      ],
      endTurn: true,
    }),
    finish_turn: () => ({
      modelResult: { ok: true },
      summary: 'Finished',
      endTurn: true,
    }),
  };

  const makeAgent = (
    overrides: Partial<ValidatedTurnAgent> = {},
  ): ValidatedTurnAgent => ({
    agentName: 'Test agent',
    userNoun: 'trainer',
    logTag: '[TEST]',
    provider: {
      name: 'fake',
      async *stream(request: any) {
        requests.push({
          tools: (request.tools ?? []).map((t: any) => t.name),
          messages: JSON.parse(JSON.stringify(request.messages)),
        });
        const next = passes.shift();
        if (!next) throw new Error('no more scripted passes');
        for (const block of next.content) {
          if (block.type === 'text')
            yield { type: 'text_delta', text: block.text };
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
    } as any,
    model: 'fake-model',
    system: 'SYSTEM',
    messages: [{ role: 'user', content: 'Change the title' }],
    tools: () => BELT.map(tool),
    maxIterations: 8,
    maxTokens: 1000,
    maxRetries: 2,
    closingTool: 'finish_turn',
    askingTool: 'ask_user',
    isEdit: (name) => name === 'edit' || name === 'confirm_publish',
    isResearch: (name) => name === 'search',
    userWordsToApply: null,
    unchangedField: 'unchangedBecause',
    stateMoved: () => state.changed,
    claimsChange: (message) => /\bI'?ve (changed|updated)\b/i.test(message),
    execute: (name, input) => execute(name, input),
    describeAttempt: (name) => name,
    recordUsage: jest.fn(),
    checkpoint: jest.fn().mockResolvedValue(undefined),
    truncationNudge: 'You were cut off; write less.',
    errors: {
      truncated: { code: 'response_truncated', message: 'Too long.' },
      invalidToolCall: { code: 'invalid_tool_call', message: 'Unreadable.' },
    },
    ...overrides,
  });

  const run = async (
    agent: ValidatedTurnAgent = makeAgent(),
  ): Promise<{ frames: any[]; turn: ValidatedTurnState }> => {
    const turn = createValidatedTurnState();
    const frames: any[] = [];
    for await (const frame of runValidatedTurn(agent, turn)) frames.push(frame);
    return { frames, turn };
  };

  const tokens = (frames: any[]) =>
    frames.filter((frame) => frame.event === 'token').map((f) => f.data.delta);

  /** The result the model got back for a call, by tool_use id. */
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

  beforeEach(() => {
    passes = [];
    requests = [];
    state = { changed: false };
    execute = jest.fn((name: string, input: any) => {
      const outcome = outcomes[name];
      if (!outcome) throw new Error(`unknown tool ${name}`);
      return Promise.resolve(outcome(input));
    });
  });

  it('shows only the closing message, as one token frame, once the turn has edited', async () => {
    passes = [
      pass([text('thinking out loud'), call('e1', 'edit')]),
      pass([call('f1', 'finish_turn', { message: "I've changed the title." })]),
    ];

    const { frames, turn } = await run();

    expect(tokens(frames)).toEqual(["I've changed the title."]);
    expect(turn.reply).toBe("I've changed the title.");
    expect(turn.workingNotes).toEqual(['thinking out loud']);
    expect(turn.delivered).toBe(true);
    // The ending call is not announced as a chip; the edit is.
    const chips = frames
      .filter((f) => f.event === 'tool_call')
      .map((f) => f.data.name);
    expect(chips).toEqual(['edit']);
  });

  it('sends back a reply written in the same step as a lookup, then delivers it once read', async () => {
    passes = [
      pass([
        call('s1', 'search', { query: 'roleplays' }),
        call('f1', 'finish_turn', {
          message: 'Nothing matched.',
          unchangedBecause: 'they asked a question',
        }),
      ]),
      pass([
        call('f2', 'finish_turn', {
          message: 'Two roleplays match.',
          unchangedBecause: 'they asked a question',
        }),
      ]),
    ];

    const { frames, turn } = await run();

    const rejection = resultFor('f1');
    expect(rejection).toMatchObject({ ok: false, delivered: false });
    expect(rejection.reasons.join(' ')).toContain(
      'before their results existed',
    );
    expect(tokens(frames)).toEqual(['Two roleplays match.']);
    expect(turn.rejections).toBe(1);
    expect(turn.warnings).toEqual([]);
  });

  it('sends back a reply whose step held a failed call', async () => {
    execute.mockImplementationOnce(() =>
      Promise.resolve({
        modelResult: { ok: false, error: 'patch_failed', message: 'bad path' },
        summary: 'Edit rejected',
      }),
    );
    passes = [
      pass([
        call('e1', 'edit'),
        call('f1', 'finish_turn', { message: "I've changed the title." }),
      ]),
      pass([call('e2', 'edit')]),
      pass([call('f2', 'finish_turn', { message: "I've changed the title." })]),
    ];

    const { frames } = await run();

    expect(resultFor('f1').reasons.join(' ')).toContain('bad path');
    expect(tokens(frames)).toEqual(["I've changed the title."]);
  });

  it('holds a reply over an earlier edit that failed and was never repaired', async () => {
    execute.mockImplementationOnce(() =>
      Promise.resolve({
        modelResult: { ok: false, error: 'patch_failed', message: 'bad path' },
        summary: 'Edit rejected',
      }),
    );
    passes = [
      pass([call('e1', 'edit')]),
      pass([
        call('f1', 'finish_turn', {
          message: 'Done.',
          unchangedBecause: 'nothing to record',
        }),
      ]),
      pass([
        call('f2', 'finish_turn', {
          message: 'The title edit did not land.',
          unchangedBecause: 'nothing to record',
        }),
      ]),
    ];

    const { frames } = await run();

    expect(resultFor('f1').reasons.join(' ')).toContain(
      'nothing since has repaired it',
    );
    // Raised once; the second attempt goes out with it as a warning.
    expect(tokens(frames)).toEqual(['The title edit did not land.']);
  });

  it('checks a claimed change against the state, and after two rejections delivers with warnings', async () => {
    passes = [
      pass([call('f1', 'finish_turn', { message: "I've updated the brief." })]),
      pass([call('f2', 'finish_turn', { message: "I've changed the brief." })]),
      pass([call('f3', 'finish_turn', { message: "I've updated it, truly." })]),
    ];

    const { frames, turn } = await run(
      makeAgent({
        claimsChange: (message) => /\bI'?ve (changed|updated)\b/i.test(message),
        // Each pass words the claim differently but it is the same problem —
        // a key raised once only warns the second time.
      }),
    );

    expect(resultFor('f1').error).toBe('not_delivered');
    // f2 repeats the same problem (claims_change), which no longer blocks.
    expect(tokens(frames)).toEqual(["I've changed the brief."]);
    expect(turn.warnings).toEqual([
      'Test agent said something changed, but nothing did this turn.',
    ]);
  });

  it('after two rejections offers only editing and ending, then delivers whatever comes', async () => {
    let attempt = 0;
    passes = [
      pass([call('f1', 'finish_turn', { message: '' })]),
      pass([call('a1', 'ask_user', { message: 'Which?', prompt: '' })]),
      pass([call('f3', 'finish_turn', { message: '' })]),
    ];
    const agent = makeAgent({
      // A different problem each time, so each one blocks once.
      extraProblems: async () => [
        { key: `extra:${attempt++}`, toModel: 'no', toUser: 'still wrong' },
      ],
    });

    const { turn } = await run(agent);

    expect(turn.rejections).toBe(2);
    expect(requests[2].tools).toEqual([
      'edit',
      'confirm_publish',
      'ask_user',
      'finish_turn',
    ]);
    expect(turn.delivered).toBe(true);
    expect(turn.warnings).toContain('still wrong');
  });

  it("holds a reply over the person's words that changed nothing, unless it says why", async () => {
    passes = [
      pass([call('f1', 'finish_turn', { message: 'Noted.' })]),
      pass([
        call('e1', 'edit'),
        call('f2', 'finish_turn', { message: 'Added to the notes.' }),
      ]),
    ];

    const { frames } = await run(
      makeAgent({ userWordsToApply: 'The audience is volunteers' }),
    );

    expect(resultFor('f1').reasons.join(' ')).toContain(
      'has not changed anything',
    );
    expect(tokens(frames)).toEqual(['Added to the notes.']);
  });

  it('records why nothing changed when the reply says so', async () => {
    passes = [
      pass([
        call('f1', 'finish_turn', {
          message: 'Publishing needs a cover.',
          unchangedBecause: 'they asked how publishing works',
        }),
      ]),
    ];

    const { turn } = await run(
      makeAgent({ userWordsToApply: 'How does publishing work?' }),
    );

    expect(turn.rejections).toBe(0);
    expect(turn.unchangedBecause).toBe('they asked how publishing works');
  });

  it('holds a confirmation a tool raised until the closing reply, and offers only the closing tool', async () => {
    passes = [
      pass([call('p1', 'confirm_publish')]),
      // Tries to ask a second question: not offered, sent back once.
      pass([call('a1', 'ask_user', { message: 'Also?', prompt: 'Also?' })]),
      pass([
        call('f1', 'finish_turn', {
          message: 'Ready to publish — confirm below.',
        }),
      ]),
    ];

    const { frames, turn } = await run();

    expect(requests[1].tools).toEqual(['finish_turn']);
    expect(resultFor('p1').turnEnds).toContain('finish_turn');
    expect(resultFor('a1').reasons.join(' ')).toContain('already being asked');
    const events = frames.map((frame) => frame.event);
    // The card arrives after the message, not when the tool ran.
    expect(events.indexOf('question')).toBeGreaterThan(events.indexOf('token'));
    expect(turn.questions).toEqual([{ id: 'q-confirm', prompt: 'Publish?' }]);
    expect(execute).not.toHaveBeenCalledWith('ask_user', expect.anything());
  });

  it('does not hold a refused call against the reply: it never ran', async () => {
    // Seen live on gemini-2.5-pro: the draft saved, then the model tried to
    // save again in the next pass. That call was not offered and never ran;
    // the saved draft stands, so there is no failed edit to repair.
    passes = [
      pass([call('p1', 'confirm_publish')]),
      pass([call('e1', 'edit')]),
      pass([call('f1', 'finish_turn', { message: 'Confirm below.' })]),
    ];

    const { turn } = await run();

    expect(resultFor('e1')).toMatchObject({
      error: 'not_available',
      notRun: true,
    });
    expect(turn.rejections).toBe(0);
    expect(turn.warnings).toEqual([]);
    expect(execute).not.toHaveBeenCalledWith('edit', expect.anything());
  });

  it('joins calls to results by occurrence when a provider repeats an id across passes', async () => {
    // Gemini's ids were unique only within one response: the same tool in two
    // passes got the same id, and a join by id alone read the later result for both.
    execute.mockImplementationOnce(() =>
      Promise.resolve({ modelResult: { ok: true }, summary: 'Edited' }),
    );
    execute.mockImplementationOnce(() =>
      Promise.resolve({
        modelResult: { ok: false, error: 'patch_failed', message: 'bad path' },
        summary: 'Edit rejected',
      }),
    );
    passes = [
      pass([call('same', 'edit')]),
      pass([call('same', 'edit')]),
      pass([
        call('f1', 'finish_turn', {
          message: 'The second change did not land.',
        }),
      ]),
      pass([
        call('f2', 'finish_turn', {
          message: 'The second change did not land.',
        }),
      ]),
    ];
    state.changed = true;

    const { turn } = await run();

    // The last edit failed and nothing repaired it: held once, then delivered.
    expect(turn.rejections).toBe(1);
    // Each call reads its own result; by id alone both would read the failure.
    const edits = joinCallsToResults(turn.toolCalls, turn.toolResults).filter(
      (joined) => joined.name === 'edit',
    );
    expect(edits.map((joined) => joined.result?.ok)).toEqual([true, false]);
  });

  it('nudges a prose-only pass twice, then delivers its notes with a warning', async () => {
    passes = [
      pass([text('Here is my answer.')], 'end_turn'),
      pass([text('Here is my answer again.')], 'end_turn'),
      pass([text('Final answer.')], 'end_turn'),
    ];

    const { frames, turn } = await run();

    expect(requests[0].tools).toHaveLength(BELT.length);
    expect(requests[2].tools).toEqual(['ask_user', 'finish_turn']);
    expect(tokens(frames)).toEqual(['Final answer.']);
    expect(turn.warnings).toEqual([
      "Test agent didn't end the turn with a reply, so its working notes are shown instead.",
    ]);
  });

  it('drops a second ending call in the same step', async () => {
    passes = [
      pass([
        call('a1', 'ask_user', { message: 'One?', prompt: 'One?' }),
        call('a2', 'ask_user', { message: 'Two?', prompt: 'Two?' }),
      ]),
    ];

    const { frames, turn } = await run();

    expect(frames.filter((f) => f.event === 'question')).toHaveLength(1);
    expect(
      turn.toolResults.find((r) => r.toolUseId === 'a2')?.result.error,
    ).toBe('one_reply_per_turn');
  });

  describe('the retries every agent loop needs', () => {
    it('drops a truncated pass and asks for it again, smaller', async () => {
      passes = [
        pass([text('Writing'), call('e1', 'edit')], 'max_tokens'),
        pass([call('e2', 'edit')]),
        pass([call('f1', 'finish_turn', { message: "I've changed it." })]),
      ];

      const { frames } = await run();

      expect(execute).toHaveBeenCalledTimes(2); // e2 and the closing call
      const retry = requests[1].messages;
      expect(retry[retry.length - 1]).toEqual({
        role: 'user',
        content: 'You were cut off; write less.',
      });
      expect(retry[retry.length - 2]).toEqual({
        role: 'assistant',
        content: [text('Writing')],
      });
      expect(frames.map((f) => f.event)).not.toContain('error');
    });

    it('gives up after the truncation retries', async () => {
      passes = [1, 2, 3].map(() => pass([text('x')], 'max_tokens'));

      const { frames, turn } = await run();

      expect(requests).toHaveLength(3);
      expect(frames.find((f) => f.event === 'error')?.data.code).toBe(
        'response_truncated',
      );
      expect(turn.errored).toBe(true);
    });

    it('retries an unreadable tool call verbatim, then gives up with its own error', async () => {
      passes = [1, 2, 3].map(() => pass([], 'invalid_tool_call'));

      const { frames, turn } = await run();

      expect(requests).toHaveLength(3);
      expect(requests[1].messages).toEqual(requests[0].messages);
      expect(frames.find((f) => f.event === 'error')?.data.code).toBe(
        'invalid_tool_call',
      );
      expect(turn.errorCode).toBe('invalid_tool_call');
    });

    it('retries an empty pass before treating it as prose', async () => {
      passes = [
        pass([], 'end_turn'),
        pass([call('f1', 'finish_turn', { message: 'Hello.' })]),
      ];

      const { frames, turn } = await run();

      expect(turn.emptyPasses).toBe(1);
      expect(tokens(frames)).toEqual(['Hello.']);
    });
  });

  it('flushes held frames for a turn that ended without a reply', () => {
    const turn = createValidatedTurnState();
    turn.held.push({ event: 'question', data: { id: 'q1' } });

    const frames = [...flushHeldFrames(turn)];

    expect(frames).toEqual([{ event: 'question', data: { id: 'q1' } }]);
    expect(turn.questions).toEqual([{ id: 'q1' }]);
    expect(turn.held).toEqual([]);
  });
});
