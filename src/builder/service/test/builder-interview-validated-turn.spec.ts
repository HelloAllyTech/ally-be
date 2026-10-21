import { BuilderInterviewOrchestratorService } from '../builder-interview-orchestrator.service';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

/**
 * Validated turns: a reply reaches the admin only once it is true.
 *
 * Each case is one way session 2bc3a5cf's interview told the admin something
 * the system knew to be false — a question sent beside lookups it had not
 * read, a failure in the same batch, "revised" over an edit that failed — and
 * pins that the loop now holds the reply back, tells the model why, and lets
 * it through once it is fixed (or, past the retries, with the problem on the
 * receipt).
 */
const pass = (content: any[], stopReason = 'tool_use') => ({
  content,
  stopReason,
  usage: { inputTokens: 10, outputTokens: 5 },
});
const use = (id: string, name: string, input: Record<string, any> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const text = (value: string) => ({ type: 'text', text: value });

const TOOL_DEFS = [
  'ask_admin',
  'finish_turn',
  'github_read_file',
  'capability_lookup',
  'update_prd',
  'set_section',
].map((name) => ({ name, description: name, input_schema: {} }));

describe('BuilderInterviewOrchestratorService — validated turns', () => {
  let service: BuilderInterviewOrchestratorService;
  let streams: any[];
  let sentRequests: any[];
  let requests: any[][];
  let checkpoints: any[];
  let history: any[];
  let readiness: {
    score: number;
    ready: boolean;
    blockers: string[];
    sections: any[];
  };
  let toolsService: { getToolDefinitions: jest.Mock; execute: jest.Mock };

  const drain = async (
    dto: Record<string, any> = { message: 'Rate the debrief, on mobile too.' },
  ) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn('session-1', dto as any, 7)) {
      frames.push(frame);
    }
    return frames;
  };
  const lastCheckpoint = () => checkpoints[checkpoints.length - 1];
  const resultFor = (id: string) =>
    (lastCheckpoint().toolResults ?? []).find(
      (row: any) => row.toolUseId === id,
    )?.result;

  beforeEach(() => {
    streams = [];
    sentRequests = [];
    requests = [];
    checkpoints = [];
    history = [];
    readiness = {
      score: 40,
      ready: false,
      blockers: ['Problem is empty.', 'No repos picked yet.'],
      sections: [],
    };

    const provider = {
      name: 'gemini',
      stream: jest.fn(async function* (request: any) {
        sentRequests.push(request);
        requests.push(JSON.parse(JSON.stringify(request.messages)));
        const next = streams.shift();
        if (next instanceof Error) throw next;
        yield { type: 'final', message: next };
      }),
    };
    let appended = 0;
    const messageRepository = {
      listBySession: jest.fn(async () => history),
      appendMessage: jest.fn(async (_sessionId: string, message: any) => ({
        id: `msg-${++appended}`,
        seq: appended,
        createdAt: new Date(),
        ...message,
      })),
      checkpointMessage: jest.fn(async (_id: string, patch: any) => {
        checkpoints.push(JSON.parse(JSON.stringify(patch)));
      }),
      closeInterruptedMessages: jest.fn().mockResolvedValue(0),
    };

    // The tools as the loop sees them: a lookup reads, an edit moves the PRD
    // version unless told to fail, ask_admin hands back a question card.
    toolsService = {
      getToolDefinitions: jest.fn(() => TOOL_DEFS),
      execute: jest.fn(async (name: string, input: any, context: any) => {
        if (input?.fail) {
          return {
            modelResult: {
              ok: false,
              error: 'patch_failed',
              message: 'path not found',
            },
            summary: `${name} failed`,
          };
        }
        if (name === 'ask_admin') {
          return {
            modelResult: { ok: true, questionId: 'q-1' },
            summary: 'Asked',
            events: [
              {
                event: 'question',
                data: { id: 'q-1', prompt: input.prompt, kind: 'freeText' },
              },
            ],
            endTurn: true,
          };
        }
        if (name === 'finish_turn') {
          return {
            modelResult: { ok: true },
            summary: 'Turn finished',
            endTurn: true,
          };
        }
        if (name === 'update_prd' || name === 'set_section') {
          context.doc = {
            ...context.doc,
            versionNumber: context.doc.versionNumber + 1,
            draft: {
              ...context.doc.draft,
              summary: `v${context.doc.versionNumber + 1}`,
            },
          };
          return { modelResult: { ok: true }, summary: 'PRD updated' };
        }
        return {
          modelResult: {
            ok: true,
            content: 'export class SkillExperimentModule {}',
          },
          summary: `Read ${input?.path}`,
        };
      }),
    };

    service = new BuilderInterviewOrchestratorService(
      {
        builder: { interviewModel: 'gemini-2.5-pro', maxToolIterations: 8 },
      } as any,
      {
        getPromptByCode: jest.fn().mockResolvedValue('Interview them.'),
        getPromptLlmConfig: jest.fn().mockResolvedValue({}),
      } as any,
      {
        getSession: jest
          .fn()
          .mockResolvedValue({ id: 'session-1', title: 'T' }),
        syncReadinessStatus: jest.fn().mockResolvedValue('interviewing'),
        getHandoffContext: jest.fn().mockResolvedValue(null),
      } as any,
      {
        getOrCreateDoc: jest.fn().mockResolvedValue({
          id: 'doc-1',
          versionNumber: 3,
          draft: createEmptyPrdDocument(),
        }),
        computeReadiness: jest.fn(() => readiness),
      } as any,
      {
        buildContextBlock: jest.fn().mockResolvedValue('context'),
        platformRules: jest.fn().mockResolvedValue('## Platform rules'),
      } as any,
      toolsService as any,
      messageRepository as any,
      { record: jest.fn() } as any,
      {
        digestsForSession: jest
          .fn()
          .mockResolvedValue({ digests: [], chosen: [] }),
      } as any,
      { update: jest.fn() } as any,
      { create: jest.fn(() => provider) } as any,
      {
        complete: jest.fn(async () => ({ text: 'They want a rating.' })),
      } as any,
      {
        assess: jest.fn(async () => readiness),
        plan: jest.fn(async () => ({ readiness, review: null })),
        runReview: jest.fn(),
      } as any,
      undefined,
      { get: jest.fn().mockResolvedValue({ validatedTurns: true }) } as any,
    );
  });

  it('holds back a question asked beside an unread lookup, then delivers it once read', async () => {
    streams = [
      pass([
        text('I will check the experiment module.'),
        use('read-1', 'github_read_file', {
          repo: 'ally-be',
          path: 'src/skill-experiment/x.ts',
        }),
        use('ask-1', 'ask_admin', {
          prompt: 'Guardrail or weight?',
          kind: 'freeText',
          message: 'Auto-improve exists.',
        }),
      ]),
      pass([
        use('edit-1', 'set_section', { section: 'summary', text: 'Rate it.' }),
        use('ask-2', 'ask_admin', {
          prompt: 'Guardrail or weight?',
          kind: 'freeText',
          message: 'Auto-improve already A/B tests both debrief prompts.',
        }),
      ]),
    ];

    const frames = await drain();

    // Not shown: the first reply was written before the read came back.
    const first = resultFor('ask-1');
    expect(first).toMatchObject({
      ok: false,
      delivered: false,
      error: 'not_delivered',
    });
    expect(first.reasons.join(' ')).toMatch(/same step as 1 lookup/);
    expect(resultFor('ask-2')).toMatchObject({ ok: true, delivered: true });

    // Nothing streamed until the reply was checked; then the reply, then the card.
    const tokens = frames.filter((frame) => frame.event === 'token');
    expect(tokens).toEqual([
      {
        event: 'token',
        data: { delta: 'Auto-improve already A/B tests both debrief prompts.' },
      },
    ]);
    const order = frames.map((frame) => frame.event);
    expect(order.indexOf('token')).toBeLessThan(order.indexOf('question'));
    expect(frames.filter((frame) => frame.event === 'question')).toHaveLength(
      1,
    );
    // The reply tool is not a chip.
    expect(
      frames
        .filter((frame) => frame.event === 'tool_call')
        .map((frame) => frame.data.name),
    ).toEqual(['github_read_file', 'set_section']);

    // The admin saw the reply; the model's other prose is a working note.
    const final = lastCheckpoint();
    expect(final.content).toBe(
      'Auto-improve already A/B tests both debrief prompts.',
    );
    expect(final.metadata.workingNotes).toEqual([
      'I will check the experiment module.',
    ]);
    expect(final.metadata.loop).toBe('validated');
    expect(final.metadata.rejections).toBe(1);
    expect(final.metadata.questions).toHaveLength(1);

    // The receipt: persisted, and the last frame before `done`.
    expect(final.metadata.receipt).toMatchObject({
      read: ['ally-be/src/skill-experiment/x.ts'],
      changed: ['Summary written'],
      prdVersion: { from: 3, to: 4 },
      failed: [],
      warnings: [],
    });
    expect(order.slice(-2)).toEqual(['receipt', 'done']);
  });

  it('holds back a reply whose step held a failed edit, and the claim it made about it', async () => {
    streams = [
      pass([
        use('edit-1', 'update_prd', {
          fail: true,
          ops: [{ op: 'replace', path: '/requirements/3/title' }],
        }),
        use('ask-1', 'ask_admin', {
          prompt: 'Next?',
          kind: 'freeText',
          message: "I've revised the PRD.",
        }),
      ]),
      pass([
        use('edit-2', 'set_section', { section: 'summary', text: 'Rate it.' }),
        use('ask-2', 'ask_admin', {
          prompt: 'Next?',
          kind: 'freeText',
          message: "I've revised the PRD.",
        }),
      ]),
    ];

    await drain();

    const reasons = resultFor('ask-1').reasons.join(' ');
    expect(reasons).toMatch(/A call in this step failed/);
    expect(reasons).toMatch(/path not found/);
    expect(reasons).toMatch(/says the PRD changed, but nothing in it changed/);
    expect(resultFor('ask-2')).toMatchObject({ delivered: true });
    // The failure stays on the record even though a later edit landed.
    expect(lastCheckpoint().metadata.receipt.failed).toEqual([
      'PRD edit at /requirements/3/title — path not found',
    ]);
  });

  it('lets a problem hold a reply back once, then delivers it with the problem on the receipt', async () => {
    const claim = {
      message: "I've updated the PRD.",
      prdUnchangedBecause: 'Nothing to record.',
    };
    streams = [
      pass([use('end-1', 'finish_turn', claim)]),
      pass([use('end-2', 'finish_turn', claim)]),
    ];

    const frames = await drain();

    expect(resultFor('end-1')).toMatchObject({ delivered: false });
    expect(resultFor('end-2')).toMatchObject({ delivered: true });
    expect(frames.find((frame) => frame.event === 'token')?.data.delta).toBe(
      "I've updated the PRD.",
    );
    expect(lastCheckpoint().metadata.receipt.warnings).toEqual([
      'Builder said the PRD changed, but nothing in it changed this turn.',
    ]);
  });

  it('checks a claim that the PRD is ready against readiness', async () => {
    streams = [
      pass([
        use('end-1', 'finish_turn', {
          message: 'The PRD is build-ready.',
          prdUnchangedBecause: 'Nothing new.',
        }),
      ]),
      pass([
        use('end-2', 'finish_turn', {
          message: 'Two blockers are left: the problem and the repos.',
          prdUnchangedBecause: 'Nothing new.',
        }),
      ]),
    ];

    await drain();

    expect(resultFor('end-1').reasons.join(' ')).toMatch(
      /says the PRD is ready, and readiness says it is not: Problem is empty\. \| No repos picked yet\./,
    );
    expect(lastCheckpoint().content).toBe(
      'Two blockers are left: the problem and the repos.',
    );
    expect(lastCheckpoint().metadata.receipt.warnings).toEqual([]);
  });

  it("asks the model to record the admin's own words, or say why they change nothing", async () => {
    streams = [
      pass([use('end-1', 'finish_turn', { message: 'Noted.' })]),
      pass([
        use('end-2', 'finish_turn', {
          message: 'Mobile is already in the plan.',
          prdUnchangedBecause: 'R1 already covers mobile.',
        }),
      ]),
    ];

    await drain();

    expect(resultFor('end-1').reasons.join(' ')).toMatch(
      /The admin's message \("Rate the debrief, on mobile too\."\) has not changed the PRD/,
    );
    expect(lastCheckpoint().metadata.receipt.prdUnchangedBecause).toBe(
      'R1 already covers mobile.',
    );
  });

  it('does not hold an option pick to that rule', async () => {
    streams = [
      pass([use('end-1', 'finish_turn', { message: 'Weight it is.' })]),
    ];

    await drain({
      message: 'Weight',
      questionId: 'q-0',
      answer: { selectedOptionIds: ['weight'] },
    });

    expect(resultFor('end-1')).toMatchObject({ delivered: true });
  });

  it('nudges a reply written as prose, then offers only the turn-ending tools', async () => {
    streams = [
      pass([text('The PRD needs a problem statement.')], 'end_turn'),
      pass([text('Still thinking.')], 'end_turn'),
      pass([
        use('end-1', 'finish_turn', {
          message: 'The PRD needs a problem statement.',
          prdUnchangedBecause: 'Answering a question.',
        }),
      ]),
    ];

    await drain();

    const offered = sentRequests.map((request) =>
      (request.tools ?? []).map((tool: any) => tool.name),
    );
    expect(offered[0]).toHaveLength(TOOL_DEFS.length);
    expect(offered[1]).toHaveLength(TOOL_DEFS.length);
    expect(offered[2]).toEqual(['ask_admin', 'finish_turn']);
    // The model saw its own prose and was told nobody else had.
    expect(requests[1].slice(-2)).toEqual([
      {
        role: 'assistant',
        content: [text('The PRD needs a problem statement.')],
      },
      {
        role: 'user',
        content: expect.stringMatching(/The admin has not seen that/),
      },
    ]);
    expect(lastCheckpoint().content).toBe('The PRD needs a problem statement.');
  });

  it('shows the last notes, with a warning, when even the last step writes no reply', async () => {
    streams = [
      pass([text('One.')], 'end_turn'),
      pass([text('Two.')], 'end_turn'),
      pass([text('Here is where it stands.')], 'end_turn'),
    ];

    const frames = await drain();

    expect(frames.find((frame) => frame.event === 'token')?.data.delta).toBe(
      'Here is where it stands.',
    );
    const final = lastCheckpoint();
    expect(final.content).toBe('Here is where it stands.');
    expect(final.metadata.workingNotes).toEqual(['One.', 'Two.']);
    expect(final.metadata.receipt.warnings).toEqual([
      "Builder didn't end the turn with a reply, so its working notes are shown instead.",
    ]);
    expect(final.metadata.errored).toBe(false);
  });

  it('after two rejections, offers only edits and the ending tools, and delivers what comes', async () => {
    const lookup = (id: string) =>
      use(id, 'capability_lookup', { query: 'rating' });
    const end = (id: string) =>
      use(id, 'finish_turn', {
        message: 'Auto-improve exists.',
        prdUnchangedBecause: 'n/a',
      });
    streams = [
      pass([lookup('l-1'), end('end-1')]),
      pass([lookup('l-2'), end('end-2')]),
      pass([lookup('l-3'), end('end-3')]),
    ];

    await drain();

    expect(sentRequests[2].tools.map((tool: any) => tool.name)).toEqual([
      'ask_admin',
      'finish_turn',
      'update_prd',
      'set_section',
    ]);
    // Asked for anyway: not run, and the reply goes out with that on the receipt.
    expect(resultFor('l-3')).toMatchObject({
      ok: false,
      error: 'not_available',
    });
    expect(resultFor('end-3')).toMatchObject({ delivered: true });
    const receipt = lastCheckpoint().metadata.receipt;
    expect(receipt.warnings).toEqual([
      'Written before Builder saw that a call in the same step failed.',
    ]);
    expect(lastCheckpoint().metadata.rejections).toBe(2);
  });

  it('delivers one question per turn and drops a second asked in the same step', async () => {
    streams = [
      pass([
        use('edit-1', 'set_section', { section: 'summary', text: 'x' }),
        use('ask-1', 'ask_admin', {
          prompt: 'First?',
          kind: 'freeText',
          message: 'Two things.',
        }),
        use('ask-2', 'ask_admin', {
          prompt: 'Second?',
          kind: 'freeText',
          message: 'Two things.',
        }),
      ]),
    ];

    const frames = await drain();

    expect(frames.filter((frame) => frame.event === 'question')).toHaveLength(
      1,
    );
    expect(resultFor('ask-2')).toMatchObject({
      delivered: false,
      error: 'one_reply_per_turn',
    });
    expect(
      lastCheckpoint().metadata.questions.map((q: any) => q.prompt),
    ).toEqual(['First?']);
  });

  it('keeps the receipt of edits that landed before the provider failed', async () => {
    streams = [
      pass([use('edit-1', 'set_section', { section: 'summary', text: 'x' })]),
      new Error('503 Service Unavailable'),
    ];

    const frames = await drain();

    expect(frames.some((frame) => frame.event === 'error')).toBe(true);
    expect(lastCheckpoint().metadata.errored).toBe(true);
    expect(lastCheckpoint().metadata.receipt.changed).toEqual([
      'Summary written',
    ]);
  });

  it('tells the model the turn protocol, and offers the validated belt', async () => {
    streams = [
      pass([
        use('edit-1', 'set_section', { section: 'summary', text: 'x' }),
        use('end-1', 'finish_turn', { message: 'Done.' }),
      ]),
    ];

    await drain();

    expect(sentRequests[0].system[0].text).toContain('# How a turn ends');
    // The interview protocol is off here (its own spec turns it on).
    expect(toolsService.getToolDefinitions).toHaveBeenCalledWith({
      validatedTurns: true,
      situationBrief: false,
      briefDue: false,
    });
    expect(sentRequests[0].system[0].text).not.toContain(
      '# How this interview runs',
    );
    expect(toolsService.execute.mock.calls[0][2]).toMatchObject({
      validatedTurns: true,
    });
  });

  it("keeps earlier turns' failures in the replayed history once it is summarised", async () => {
    // Forty-odd messages, the earliest assistant turn with a failed read.
    history = Array.from({ length: 44 }, (_, index) => {
      const seq = index + 1;
      if (index % 2 === 0) {
        return {
          id: `m${seq}`,
          seq,
          role: BuilderMessageRole.USER,
          content: `Answer ${seq}`,
        };
      }
      return {
        id: `m${seq}`,
        seq,
        role: BuilderMessageRole.ASSISTANT,
        content: `Reply ${seq}`,
        toolCalls:
          seq === 2
            ? [
                {
                  id: 't1',
                  name: 'github_read_file',
                  input: { repo: 'ally-be', path: 'src/gone.ts' },
                },
              ]
            : [],
        toolResults:
          seq === 2
            ? [
                {
                  toolUseId: 't1',
                  name: 'github_read_file',
                  result: { ok: false, error: 'Not Found' },
                },
              ]
            : [],
        metadata: {},
      };
    });
    streams = [
      pass([
        use('edit-1', 'set_section', { section: 'summary', text: 'x' }),
        use('end-1', 'finish_turn', { message: 'Done.' }),
      ]),
    ];

    await drain();

    const summaryTurn = String(requests[0][0].content);
    expect(summaryTurn).toContain('<earlier_conversation_summary>');
    expect(summaryTurn).toContain('<earlier_receipts>');
    expect(summaryTurn).toContain(
      '#2: FAILED: Read ally-be/src/gone.ts — Not Found',
    );
  });
});
