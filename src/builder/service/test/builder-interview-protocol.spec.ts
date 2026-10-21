import { BuilderInterviewOrchestratorService } from '../builder-interview-orchestrator.service';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

/**
 * The interview protocol (W4, builder_settings.situationBrief): a discovery
 * sweep before the first reply, a situation brief as that reply, the admin's
 * line-by-line answer, and the question gate after it.
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

const PLAN = {
  queries: [
    { tool: 'capability_lookup', query: 'auto improve' },
    { tool: 'capability_lookup', query: 'debrief' },
    { tool: 'docs_search', query: 'skill experiments' },
    { tool: 'github_search_code', query: 'DebriefTab' },
    { tool: 'ai_tasks_lookup', query: 'debrief' },
  ],
};

const BRIEF = {
  message:
    'You want learners to rate the debrief. This is what already exists.',
  exists: [
    { text: 'Auto-improve already tests debrief prompts', cites: ['E1'] },
  ],
  proposals: [
    {
      part: 'challenger loop',
      approach: 'reuse',
      text: 'Reuse Auto-improve',
      cites: ['E1'],
    },
    {
      part: 'rating',
      approach: 'new',
      text: 'A thumbs rating under the debrief',
    },
  ],
  repos: [
    { repo: 'ally-web', why: 'the web debrief' },
    { repo: 'ally-mobile', why: 'the mobile DebriefTab' },
  ],
};

describe('BuilderInterviewOrchestratorService — the interview protocol', () => {
  let service: BuilderInterviewOrchestratorService;
  let streams: any[];
  let sentRequests: any[];
  let checkpoints: any[];
  let appended: any[];
  let history: any[];
  let settings: Record<string, any>;
  let toolsService: { getToolDefinitions: jest.Mock; execute: jest.Mock };
  let complete: jest.Mock;

  const drain = async (
    dto: Record<string, any> = { message: 'Let learners rate the debrief.' },
  ) => {
    const frames: any[] = [];
    for await (const frame of service.streamTurn('session-1', dto as any, 7)) {
      frames.push(frame);
    }
    return frames;
  };
  const last = () => checkpoints[checkpoints.length - 1];
  const resultFor = (id: string) =>
    (last().toolResults ?? []).find((row: any) => row.toolUseId === id)?.result;
  const offered = (index: number) =>
    (sentRequests[index].tools ?? []).map((tool: any) => tool.name);

  beforeEach(() => {
    streams = [];
    sentRequests = [];
    checkpoints = [];
    appended = [];
    history = [];
    settings = { validatedTurns: true, situationBrief: true };

    const provider = {
      name: 'gemini',
      stream: jest.fn(async function* (request: any) {
        sentRequests.push(JSON.parse(JSON.stringify(request)));
        const next = streams.shift();
        if (!next) throw new Error('no more scripted passes');
        yield { type: 'final', message: next };
      }),
    };
    let seq = 0;
    const messageRepository = {
      listBySession: jest.fn(async () => history),
      appendMessage: jest.fn(async (_sessionId: string, message: any) => {
        const row = {
          id: `msg-${++seq}`,
          seq,
          createdAt: new Date(),
          ...message,
        };
        appended.push(row);
        return row;
      }),
      checkpointMessage: jest.fn(async (_id: string, patch: any) => {
        checkpoints.push(JSON.parse(JSON.stringify(patch)));
      }),
      closeInterruptedMessages: jest.fn().mockResolvedValue(0),
    };

    // The real belt is not needed: names are enough for the loop, and the
    // tools service's own spec covers the schemas.
    toolsService = {
      getToolDefinitions: jest.fn((options: any) => {
        const names = [
          'finish_turn',
          'capability_lookup',
          'github_read_file',
          'set_section',
        ];
        if (options.situationBrief && options.briefDue) {
          names.push('submit_situation_brief');
        } else {
          names.push('ask_admin');
        }
        return names.map((name) => ({
          name,
          description: name,
          input_schema: {},
        }));
      }),
      execute: jest.fn(async (name: string, input: any, context: any) => {
        switch (name) {
          case 'capability_lookup':
            return {
              modelResult: {
                ok: true,
                results:
                  input.query === 'auto improve'
                    ? [
                        {
                          kind: 'capability',
                          repo: 'ally-be',
                          name: 'Auto-improve',
                          path: 'ally-be:src/skill-experiment',
                        },
                      ]
                    : [],
              },
              summary: `Platform map: "${input.query}"`,
            };
          case 'docs_search':
          case 'github_search_code':
            return {
              modelResult: {
                ok: true,
                results: [
                  { repo: 'ally-be', path: 'docs/skill-experiments.md' },
                ],
              },
              summary: 'Docs',
            };
          case 'ai_tasks_lookup':
            return {
              modelResult: { ok: true, results: [] },
              summary: 'AI tasks',
            };
          case 'ask_admin':
            return {
              modelResult: { ok: true },
              summary: 'Asked',
              events: [
                {
                  event: 'question',
                  data: { id: 'q-1', prompt: input.prompt, kind: 'freeText' },
                },
              ],
              endTurn: true,
            };
          case 'set_section':
            context.doc = {
              ...context.doc,
              versionNumber: context.doc.versionNumber + 1,
            };
            return { modelResult: { ok: true }, summary: 'PRD updated' };
          default:
            return {
              modelResult: { ok: true, delivered: true },
              summary: name,
              endTurn: true,
            };
        }
      }),
    };

    complete = jest.fn(async () => ({ text: JSON.stringify(PLAN) }));

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
          .mockResolvedValue({ id: 'session-1', title: 'Debrief rating' }),
        syncReadinessStatus: jest.fn().mockResolvedValue('interviewing'),
        getHandoffContext: jest.fn().mockResolvedValue(null),
      } as any,
      {
        getOrCreateDoc: jest.fn().mockResolvedValue({
          id: 'doc-1',
          versionNumber: 3,
          draft: createEmptyPrdDocument(),
        }),
        computeReadiness: jest.fn(() => ({
          score: 10,
          ready: false,
          blockers: [],
          sections: [],
        })),
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
      { complete } as any,
      {
        assess: jest.fn(async () => ({
          score: 10,
          ready: false,
          blockers: [],
          sections: [],
        })),
        plan: jest.fn(async () => ({
          readiness: { score: 10, ready: false, blockers: [], sections: [] },
          review: null,
        })),
      } as any,
      undefined,
      { get: jest.fn(async () => settings) } as any,
    );
  });

  describe('the opening turn', () => {
    it('sweeps before the first pass, shows the progress, and offers no question', async () => {
      streams = [pass([use('b-1', 'submit_situation_brief', BRIEF)])];

      const frames = await drain();

      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'builder-discovery-plan' }),
      );
      // Every planned lookup ran through the interview's own tools — the
      // catalog ones at once, the GitHub-backed ones two at a time.
      expect(
        toolsService.execute.mock.calls
          .slice(0, 5)
          .map(([name]) => name)
          .sort(),
      ).toEqual([
        'ai_tasks_lookup',
        'capability_lookup',
        'capability_lookup',
        'docs_search',
        'github_search_code',
      ]);
      const events = frames.map((frame) => frame.event);
      expect(events.slice(0, 5)).toEqual(Array(5).fill('tool_call'));
      expect(offered(0)).toContain('submit_situation_brief');
      expect(offered(0)).not.toContain('ask_admin');
      // What the sweep found is on the opening turn's message, by ref.
      const opening = sentRequests[0].messages.at(-1).content;
      expect(opening).toContain('<discovery>');
      expect(opening).toContain(
        'E1 capability_lookup "auto improve" — capability Auto-improve',
      );
      expect(sentRequests[0].system[0].text).toContain(
        '# How this interview runs',
      );
    });

    it('shows the brief as a card after its message, and keeps it and the sweep on the row', async () => {
      streams = [pass([use('b-1', 'submit_situation_brief', BRIEF)])];

      const frames = await drain();

      const events = frames.map((frame) => frame.event);
      expect(events.indexOf('situation_brief')).toBeGreaterThan(
        events.indexOf('token'),
      );
      const brief = frames.find(
        (frame) => frame.event === 'situation_brief',
      ).data;
      expect(brief.lines.map((line: any) => line.id)).toEqual([
        'X1',
        'P1',
        'P2',
        'R1',
        'R2',
      ]);
      expect(brief.lines[0].cites[0].label).toContain('Auto-improve');
      expect(last().content).toBe(BRIEF.message);
      expect(last().metadata.situationBrief.id).toBe(brief.id);
      expect(last().metadata.discovery.items).toHaveLength(5);
      // The brief turn needs no PRD edit: it is answered before it is written.
      expect(last().metadata.rejections).toBeUndefined();
      // The receipt lists the sweep's searches.
      const receipt = frames.find((frame) => frame.event === 'receipt').data;
      expect(receipt.searched.length).toBeGreaterThanOrEqual(4);
    });

    it('sends back a brief that claims what no lookup found, then shows the fixed one', async () => {
      streams = [
        pass([
          use('b-1', 'submit_situation_brief', {
            ...BRIEF,
            exists: [
              ...BRIEF.exists,
              { text: 'A ratings table already exists', cites: ['E2'] },
            ],
          }),
        ]),
        pass([use('b-2', 'submit_situation_brief', BRIEF)]),
      ];

      const frames = await drain();

      expect(resultFor('b-1')).toMatchObject({ delivered: false });
      expect(resultFor('b-1').reasons.join(' ')).toContain('match no lookup');
      expect(
        frames.filter((frame) => frame.event === 'situation_brief'),
      ).toHaveLength(1);
    });

    it('will not let a question come before the brief', async () => {
      streams = [
        pass([
          use('a-1', 'ask_admin', { message: 'Hi', prompt: 'Web or mobile?' }),
        ]),
        pass([use('b-1', 'submit_situation_brief', BRIEF)]),
      ];

      const frames = await drain();

      expect(resultFor('a-1').reasons.join(' ')).toContain('opening turn');
      expect(frames.filter((frame) => frame.event === 'question')).toHaveLength(
        0,
      );
      expect(frames.some((frame) => frame.event === 'situation_brief')).toBe(
        true,
      );
    });

    it('runs no sweep for an interview that started before the protocol', async () => {
      history = [
        {
          id: 'u1',
          seq: 1,
          role: BuilderMessageRole.USER,
          content: 'Rate the debrief',
        },
        {
          id: 'a1',
          seq: 2,
          role: BuilderMessageRole.ASSISTANT,
          content: 'Which surface?',
          metadata: { questions: [{ id: 'q-0', prompt: 'Which surface?' }] },
        },
      ];
      streams = [
        pass([
          use('a-1', 'ask_admin', {
            message: 'Noted.',
            prompt: 'Should mobile ship in the same release?',
            questionType: 'scope',
            basis: 'what you said',
            whyNotResearch: 'a release decision',
            prdUnchangedBecause: 'they answered a scope question',
          }),
        ]),
      ];

      await drain({ message: 'Web first.' });

      expect(complete).not.toHaveBeenCalled();
      expect(offered(0)).toContain('ask_admin');
      expect(offered(0)).not.toContain('submit_situation_brief');
    });

    it('does nothing different with the protocol switched off', async () => {
      settings = { validatedTurns: true, situationBrief: false };
      streams = [
        pass([
          use('a-1', 'ask_admin', {
            message: 'Hi',
            prompt: 'Web or mobile?',
            prdUnchangedBecause: 'opening',
          }),
        ]),
      ];

      const frames = await drain();

      expect(complete).not.toHaveBeenCalled();
      expect(frames.some((frame) => frame.event === 'question')).toBe(true);
      expect(sentRequests[0].system[0].text).not.toContain(
        '# How this interview runs',
      );
    });
  });

  describe('after the brief', () => {
    let brief: any;

    beforeEach(async () => {
      streams = [pass([use('b-1', 'submit_situation_brief', BRIEF)])];
      await drain();
      brief = last().metadata.situationBrief;
      history = [
        appended[0],
        {
          ...appended[1],
          content: last().content,
          metadata: last().metadata,
          toolCalls: last().toolCalls,
          toolResults: last().toolResults,
        },
      ];
      checkpoints = [];
      sentRequests = [];
      complete.mockClear();
    });

    it("renders the admin's verdicts as their message, and holds the reply to applying them", async () => {
      streams = [
        pass([
          use('f-1', 'finish_turn', {
            message: 'Got it.',
            prdUnchangedBecause: '',
          }),
        ]),
        pass([
          use('s-1', 'set_section', {
            section: 'existingBehaviour',
            text: 'Auto-improve…',
          }),
          use('a-1', 'ask_admin', {
            message: 'Written.',
            prompt: 'Should ratings block a challenger, or only weigh in?',
            questionType: 'behaviour',
            basis: 'P1',
            whyNotResearch: 'both work; their call',
          }),
        ]),
      ];

      await drain({
        message: 'Confirmed, with one correction',
        briefResponse: {
          briefId: brief.id,
          lines: [
            { id: 'X1', verdict: 'confirm' },
            {
              id: 'P2',
              verdict: 'correct',
              correction: 'Extend the existing session rating instead',
            },
          ],
        },
      });

      expect(complete).not.toHaveBeenCalled(); // no second sweep
      const userRow = appended.find(
        (row) => row.role === 'user' && row.metadata?.briefResponse,
      );
      expect(userRow.content).toContain('Corrected P2');
      expect(userRow.content).toContain(
        'Extend the existing session rating instead',
      );
      const live = sentRequests[0].messages.at(-1).content;
      expect(live).toContain('<situation_brief>');
      expect(live).toContain(
        '[CORRECTED: Extend the existing session rating instead]',
      );
      // The first reply changed nothing the admin said: sent back.
      expect(resultFor('f-1').reasons.join(' ')).toContain(
        'has not changed the PRD',
      );
      // The opening message's discovery is replayed where the model first read it.
      expect(sentRequests[0].messages[0].content).toContain('<discovery>');
    });

    it('gates every question: a type, a basis, and why research cannot settle it', async () => {
      streams = [
        pass([
          use('a-1', 'ask_admin', {
            message: 'One thing.',
            prompt: 'Which surface first?',
            prdUnchangedBecause: 'asking',
          }),
        ]),
        pass([
          use('a-2', 'ask_admin', {
            message: 'One thing.',
            prompt: 'Which surface first?',
            questionType: 'priority',
            basis: 'R1, R2',
            whyNotResearch: 'a release decision',
            prdUnchangedBecause: 'asking',
          }),
        ]),
      ];

      const frames = await drain({ message: 'What next?' });

      expect(resultFor('a-1').reasons.join(' ')).toContain('names its type');
      expect(frames.filter((frame) => frame.event === 'question')).toHaveLength(
        1,
      );
      expect(toolsService.execute).toHaveBeenLastCalledWith(
        'ask_admin',
        expect.objectContaining({ questionType: 'priority' }),
        expect.objectContaining({ questionGate: true }),
      );
    });

    it('sends back a question about how the code works', async () => {
      streams = [
        pass([
          use('a-1', 'ask_admin', {
            message: 'Quick check.',
            prompt: 'Where is the session rating stored today?',
            questionType: 'scope',
            basis: 'X1',
            whyNotResearch: 'unsure',
            prdUnchangedBecause: 'asking',
          }),
        ]),
        pass([
          use('f-1', 'finish_turn', {
            message: 'I looked it up instead.',
            prdUnchangedBecause: 'no decision needed',
          }),
        ]),
      ];

      await drain({ message: 'Go on.' });

      expect(resultFor('a-1').reasons.join(' ')).toContain('look');
    });
  });
});
