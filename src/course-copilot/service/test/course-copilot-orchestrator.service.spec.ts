import { CourseCopilotSessionStatus as Status } from '../../enum/course-copilot.enum';
import { CourseCopilotBriefService } from '../course-copilot-brief.service';
import { CourseCopilotOrchestratorService } from '../course-copilot-orchestrator.service';
import { CourseCopilotToolsService } from '../course-copilot-tools.service';
import { makeSession } from './course-copilot-test.fixtures';

/**
 * Course Copilot's turn, both loops, with a scripted provider and the real
 * tool belt over mocked stores. The switch is `validated_agent_turns`
 * (global_settings); off runs the loop the copilot had before.
 */
describe('CourseCopilotOrchestratorService', () => {
  type Pass = { content: any[]; stopReason: string };

  let passes: Pass[];
  let requests: any[];
  let session: ReturnType<typeof makeSession>;
  let checkpoints: any[];
  let enabled: jest.Mock;
  let blueprintService: { propose: jest.Mock; applyPatch: jest.Mock };
  let editTools: { execute: jest.Mock };
  let service: CourseCopilotOrchestratorService;

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

  const build = (withSettings = true) => {
    const briefService = new CourseCopilotBriefService();
    const sessionRepository = {
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async () => session),
    };
    const tools = new CourseCopilotToolsService(
      sessionRepository as any,
      briefService,
      blueprintService as any,
      {
        listCompetencies: jest.fn().mockResolvedValue([]),
        getBehaviours: jest.fn().mockResolvedValue({}),
        listLanguages: jest.fn().mockResolvedValue([]),
        listTriggerWarnings: jest.fn().mockResolvedValue([]),
        listCoverImages: jest.fn().mockResolvedValue([]),
        search: jest
          .fn()
          .mockResolvedValue([{ id: 's-1', title: 'Listening basics' }]),
      } as any,
      { search: jest.fn(), getChunks: jest.fn() } as any,
      editTools as any,
    );
    let seq = 0;
    service = new CourseCopilotOrchestratorService(
      {
        courseCopilot: {
          model: 'claude-test',
          provider: 'anthropic',
          maxToolIterations: 8,
        },
      } as any,
      {
        getPromptLlmConfig: jest.fn().mockResolvedValue({}),
        getPromptByCode: jest.fn().mockResolvedValue('SYSTEM'),
      } as any,
      {
        getOwned: jest.fn(async () => session),
        patchMetadata: jest.fn().mockResolvedValue(undefined),
      } as any,
      sessionRepository as any,
      {
        closeInterruptedMessages: jest.fn().mockResolvedValue(0),
        listBySession: jest.fn().mockResolvedValue([]),
        appendMessage: jest.fn(async () => ({ id: `m-${++seq}`, seq })),
        checkpointMessage: jest.fn(async (_id, row) => {
          checkpoints.push(JSON.parse(JSON.stringify(row)));
        }),
      } as any,
      { listBySession: jest.fn().mockResolvedValue([]) } as any,
      briefService,
      {
        listCompetencies: jest.fn().mockResolvedValue([]),
        listLanguages: jest.fn().mockResolvedValue([]),
        recentRoleplays: jest.fn().mockResolvedValue([]),
        listTriggerWarnings: jest.fn().mockResolvedValue([]),
        gameCatalogue: jest.fn().mockReturnValue([]),
      } as any,
      {} as any,
      { spent: jest.fn().mockResolvedValue(0) } as any,
      tools,
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
      {} as any,
      withSettings ? ({ enabled } as any) : undefined,
    );
  };

  const turn = async (dto: Record<string, any>) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn('session-1', dto as any, 7)) {
      frames.push(frame);
    }
    return frames;
  };
  const events = (frames: any[]) => frames.map((frame) => frame.event);
  const tokens = (frames: any[]) =>
    frames.filter((f) => f.event === 'token').map((f) => f.data.delta);
  const lastRow = () => checkpoints[checkpoints.length - 1];

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
    checkpoints = [];
    session = makeSession({
      status: Status.INTERVIEWING,
      trackId: null,
      brief: {},
      blueprintVersion: 0,
    });
    enabled = jest.fn().mockResolvedValue(true);
    blueprintService = { propose: jest.fn(), applyPatch: jest.fn() };
    editTools = { execute: jest.fn() };
    build();
  });

  describe('with validated turns off', () => {
    beforeEach(() => enabled.mockResolvedValue(false));

    it('runs the previous loop: prose streams as written and ask_trainer ends the turn', async () => {
      passes = [
        pass([
          text('Who is it for?'),
          call('q1', 'ask_trainer', {
            prompt: 'Who are the learners?',
            kind: 'freeText',
          }),
        ]),
      ];

      const frames = await turn({ message: 'A course on listening' });

      expect(enabled).toHaveBeenCalledWith('courseCopilot');
      expect(requests[0].tools).not.toContain('finish_turn');
      expect(requests[0].system[0].text).not.toContain('# How a turn ends');
      expect(tokens(frames)).toEqual(['Who is it for?']);
      expect(events(frames)).toEqual([
        'token',
        'tool_call',
        'question',
        'tool_result',
        'receipt',
        'done',
      ]);
      expect(lastRow().metadata).toMatchObject({
        loop: 'legacy',
        streaming: false,
      });
      expect(lastRow().content).toBe('Who is it for?');
    });

    it('runs the previous loop when no settings service is wired (a fixture)', async () => {
      build(false);
      passes = [pass([text('Hello.')], 'end_turn')];

      const frames = await turn({ message: 'hi' });

      expect(tokens(frames)).toEqual(['Hello.']);
      expect(lastRow().metadata.loop).toBe('legacy');
    });
  });

  describe('with validated turns on', () => {
    it('records the brief, then shows one checked reply with a receipt', async () => {
      passes = [
        pass([
          text('Let me record that.'),
          call('b1', 'update_brief', {
            ops: [{ op: 'add', path: '/audience/who', value: 'Volunteers' }],
          }),
        ]),
        pass([
          call('q1', 'ask_trainer', {
            message: "I've noted that the course is for volunteers.",
            prompt: 'How long should it take?',
            kind: 'freeText',
          }),
        ]),
      ];

      const frames = await turn({ message: 'It is for volunteers' });

      expect(requests[0].tools).toEqual(
        expect.arrayContaining(['ask_trainer', 'finish_turn', 'update_brief']),
      );
      expect(requests[0].system[0].text).toContain('# How a turn ends');
      // Nothing streamed before the reply was checked; then the reply, then the card.
      expect(tokens(frames)).toEqual([
        "I've noted that the course is for volunteers.",
      ]);
      const order = events(frames);
      expect(order.indexOf('token')).toBeLessThan(order.indexOf('question'));
      expect(order.slice(-2)).toEqual(['receipt', 'done']);

      const receipt = frames.find((f) => f.event === 'receipt').data;
      expect(receipt.changed).toEqual(['Brief: audience']);
      const row = lastRow();
      expect(row.content).toBe("I've noted that the course is for volunteers.");
      expect(row.metadata).toMatchObject({
        loop: 'validated',
        workingNotes: ['Let me record that.'],
        receipt: { changed: ['Brief: audience'] },
      });
      expect(row.metadata.questions).toHaveLength(1);
    });

    it("sends back a reply over the trainer's words that changed nothing", async () => {
      passes = [
        pass([call('f1', 'finish_turn', { message: 'Got it — volunteers.' })]),
        pass([
          call('b1', 'update_brief', {
            ops: [
              { op: 'add', path: '/notes/-', value: 'Audience: volunteers' },
            ],
          }),
          call('f2', 'finish_turn', {
            message: "I've added that to the notes.",
          }),
        ]),
      ];

      const frames = await turn({ message: 'It is for volunteers' });

      expect(resultFor('f1')).toMatchObject({ delivered: false });
      expect(resultFor('f1').reasons.join(' ')).toContain(
        'has not changed anything',
      );
      expect(tokens(frames)).toEqual(["I've added that to the notes."]);
      expect(lastRow().metadata.rejections).toBe(1);
    });

    it('accepts a reply that says why the message changed nothing', async () => {
      passes = [
        pass([
          call('f1', 'finish_turn', {
            message:
              'Publishing needs a cover, a description and an item per section.',
            unchangedBecause: 'they asked how publishing works',
          }),
        ]),
      ];

      const frames = await turn({ message: 'How does publishing work?' });

      const receipt = frames.find((f) => f.event === 'receipt').data;
      expect(receipt.unchangedBecause).toBe('they asked how publishing works');
      expect(lastRow().metadata.rejections).toBeUndefined();
    });

    it('sends back a claim that the brief is ready while it is not', async () => {
      passes = [
        pass([
          call('f1', 'finish_turn', {
            message: 'The brief is ready — shall I plan the course?',
            unchangedBecause: 'they asked for a status',
          }),
        ]),
        pass([
          call('f2', 'finish_turn', {
            message: 'The brief still needs the audience and a time budget.',
            unchangedBecause: 'they asked for a status',
          }),
        ]),
      ];

      const frames = await turn({ message: 'Where are we?' });

      expect(resultFor('f1').reasons.join(' ')).toContain('still needed');
      expect(tokens(frames)).toEqual([
        'The brief still needs the audience and a time budget.',
      ]);
    });

    it('puts the blueprint up for review and ends with a checked closing message', async () => {
      session.brief = {
        seed: 'Listening',
        audience: { who: 'Volunteers' },
        outcomes: { terminal: 'Listen well' },
        competencyIds: ['c-1'],
        assessment: { kind: 'roleplay' },
        shape: { durationMinutes: 30, languageIds: ['1'] },
      } as any;
      blueprintService.propose.mockResolvedValue({
        version: 1,
        blueprint: { sections: [{ title: 'One', items: [] }] },
        estimate: { items: 0 },
        problems: [],
      });
      passes = [
        pass([call('p1', 'propose_blueprint', {})]),
        pass([
          call('f1', 'finish_turn', {
            message: 'One practice-heavy section — review it in the panel.',
          }),
        ]),
      ];

      const frames = await turn({ message: 'Build it' });

      // The blueprint reaches the pane when it is made; the turn's end is the reply.
      expect(events(frames).indexOf('blueprint')).toBeLessThan(
        events(frames).indexOf('token'),
      );
      expect(requests[1].tools).toEqual(['finish_turn']);
      expect(resultFor('p1').turnEnds).toContain('finish_turn');
      const receipt = frames.find((f) => f.event === 'receipt').data;
      expect(receipt.changed).toEqual(['Blueprint drafted (v1)']);
    });

    it('holds a confirmation an edit tool raised until the reply above it', async () => {
      session = makeSession({ status: Status.EDITING, trackId: 'track-1' });
      editTools.execute.mockResolvedValue({
        modelResult: {
          ok: true,
          awaitingConfirmation: true,
          questionId: 'q-c',
        },
        summary: 'Asked to confirm: Publish the course?',
        events: [
          {
            event: 'question',
            data: {
              id: 'q-c',
              prompt: 'Publish the course?',
              kind: 'singleSelect',
            },
          },
        ],
        endTurn: true,
      });
      passes = [
        pass([call('p1', 'publish_course', {})]),
        pass([
          call('f1', 'finish_turn', {
            message: 'It is ready to publish — confirm below.',
            unchangedBecause: 'publishing waits for their confirmation',
          }),
        ]),
      ];

      const frames = await turn({ message: 'Publish it' });

      const order = events(frames);
      expect(order.indexOf('question')).toBeGreaterThan(order.indexOf('token'));
      expect(lastRow().metadata.questions).toEqual([
        expect.objectContaining({ id: 'q-c' }),
      ]);
    });

    it('still shows a held confirmation when the turn fails before replying', async () => {
      session = makeSession({ status: Status.EDITING, trackId: 'track-1' });
      editTools.execute.mockResolvedValue({
        modelResult: { ok: true, awaitingConfirmation: true },
        summary: 'Asked to confirm',
        events: [
          { event: 'question', data: { id: 'q-c', prompt: 'Publish?' } },
        ],
        endTurn: true,
      });
      passes = [
        pass([call('p1', 'publish_course', {})]),
        pass([], 'invalid_tool_call'),
        pass([], 'invalid_tool_call'),
        pass([], 'invalid_tool_call'),
      ];

      const frames = await turn({ message: 'Publish it' });

      expect(frames.find((f) => f.event === 'error')?.data.code).toBe(
        'invalid_tool_call',
      );
      expect(events(frames)).toContain('question');
      expect(lastRow().metadata.questions).toEqual([
        expect.objectContaining({ id: 'q-c' }),
      ]);
    });

    it('keeps the truncation retry: a cut-off pass is dropped and redone smaller', async () => {
      passes = [
        pass(
          [text('Writing'), call('b1', 'update_brief', { ops: [] })],
          'max_tokens',
        ),
        pass([
          call('b2', 'update_brief', {
            ops: [{ op: 'add', path: '/seed', value: 'Listening' }],
          }),
        ]),
        pass([
          call('f1', 'finish_turn', { message: "I've recorded the purpose." }),
        ]),
      ];

      const frames = await turn({ message: 'A course on listening' });

      const retry = requests[1].messages;
      expect(retry[retry.length - 1].content).toContain('cut off');
      expect(events(frames)).not.toContain('error');
      expect(tokens(frames)).toEqual(["I've recorded the purpose."]);
    });

    it('says so when a turn did work but never replied', async () => {
      passes = [
        pass([
          call('s1', 'search_library', {
            kind: 'roleplay',
            query: 'listening',
          }),
        ]),
        ...[1, 2, 3].map(() => pass([], 'invalid_tool_call')),
      ];

      const frames = await turn({ message: 'Anything on listening?' });

      const codes = frames
        .filter((f) => f.event === 'error')
        .map((f) => f.data.code);
      expect(codes).toEqual(['invalid_tool_call']);
      const receipt = frames.find((f) => f.event === 'receipt').data;
      expect(receipt.searched).toEqual([
        'Library search "listening" (roleplay) — 1 match',
      ]);
    });
  });
});
