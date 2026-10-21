import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderLessonCategory } from '../../enum/builder.enum';
import {
  BuilderCorrectionService,
  parseCorrection,
} from '../builder-correction.service';

describe('BuilderCorrectionService', () => {
  describe('parseCorrection', () => {
    it('reads a non-correction', () => {
      expect(parseCorrection('{"isCorrection":false}')).toEqual({
        isCorrection: false,
      });
    });

    /** Session 2bc3a5cf, turn 21: Auto-improve already writes challengers. */
    it('keeps a capability draft only for a missing capability', () => {
      const parsed = parseCorrection(
        JSON.stringify({
          isCorrection: true,
          category: 'missing_capability',
          subject: 'Auto-improve challengers',
          detail:
            'Builder proposed a new challenger job; Auto-improve already writes them.',
          lesson:
            'Debrief prompts are Auto-improve connected skills; reuse it for prompt experiments.',
          capability: {
            name: 'Auto-improve',
            whatItIs: 'Challenger prompt variants judged against a rubric.',
            reuseWhen: 'A feature wants to test prompt versions.',
          },
          doc: { fix: 'ignored for this category' },
          checklistItem: {
            text: 'Adds a new challenger job',
            kind: 'must_not',
          },
        }),
      );

      expect(parsed).toEqual(
        expect.objectContaining({
          isCorrection: true,
          category: 'missing_capability',
          capability: expect.objectContaining({ name: 'Auto-improve' }),
          doc: null,
          checklistItem: {
            text: 'Adds a new challenger job',
            kind: 'must_not',
          },
        }),
      );
    });

    it('files an unknown category as other, and rejects an answer with no verdict', () => {
      expect(
        parseCorrection('{"isCorrection":true,"category":"rudeness"}')
          ?.category,
      ).toBe('other');
      expect(parseCorrection('Yes, that is a correction.')).toBeNull();
    });
  });

  describe('scan', () => {
    const message = (overrides: Record<string, any> = {}) => ({
      id: 'm-2',
      sessionId: '2bc3a5cf-e3a5-4bf4-bafe-ac6b0bc51f87',
      seq: 22,
      content:
        'Auto-improve already writes challengers for the debrief prompts.',
      metadata: null,
      createdAt: '2026-10-20T10:00:00Z',
      sessionTitle: 'Rate the debrief',
      ...overrides,
    });

    const build = (
      candidates: any[],
      classification: Record<string, any> | Error,
    ) => {
      const inserted: any[] = [];
      const queryBuilder = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn(function (this: any, row: any) {
          inserted.push(row);
          return this;
        }),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      const repository = {
        createQueryBuilder: jest.fn(() => queryBuilder),
        find: jest.fn(),
      };
      const dataSource = {
        getRepository: () => repository,
        query: jest.fn(async (sql: string) =>
          sql.includes('NOT EXISTS')
            ? candidates
            : [
                {
                  content: "I've found the skill-experiment module.",
                  metadata: {
                    questions: [
                      { prompt: 'Should we build a challenger job?' },
                    ],
                  },
                },
              ],
        ),
      };
      const complete = jest.fn(async () => {
        if (classification instanceof Error) throw classification;
        return { text: JSON.stringify(classification), model: 'gpt-5-mini' };
      });
      const knowledgeService = { recordLesson: jest.fn() };
      const fixtureService = {
        list: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        createFromSession: jest.fn().mockResolvedValue({ id: 'fixture-1' }),
      };
      const service = new BuilderCorrectionService(
        dataSource as any,
        { complete } as any,
        knowledgeService as any,
        fixtureService as any,
      );
      return { service, inserted, complete, knowledgeService, fixtureService };
    };

    const correction = {
      isCorrection: true,
      category: 'missing_capability',
      subject: 'Auto-improve',
      detail: 'Proposed a new challenger job.',
      lesson: 'Reuse Auto-improve for prompt experiments.',
      checklistItem: {
        text: 'Reuses Auto-improve rather than a new job',
        kind: 'must',
      },
    };

    it('routes a correction: lesson candidate, inactive auto-fixture, recorded row', async () => {
      const { service, inserted, complete, knowledgeService, fixtureService } =
        build([message()], correction);

      const result = await service.scan();

      expect(result).toEqual({ classified: 1, corrections: 1, skipped: 0 });
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'builder-correction-classify',
          task: LlmTask.BUILDER_CORRECTION_CLASSIFY,
        }),
      );
      expect((complete.mock.calls[0] as any)[0].prompt).toContain(
        'Question asked: Should we build a challenger job?',
      );
      expect(knowledgeService.recordLesson).toHaveBeenCalledWith(
        expect.objectContaining({
          category: BuilderLessonCategory.PROCESS,
          lesson: expect.stringContaining('Reuse Auto-improve'),
        }),
      );
      expect(fixtureService.createFromSession).toHaveBeenCalledWith(
        '2bc3a5cf-e3a5-4bf4-bafe-ac6b0bc51f87',
        expect.objectContaining({
          name: 'auto: Rate the debrief (2bc3a5cf)',
          active: false,
          checklist: [
            { text: 'Reuses Auto-improve rather than a new job', kind: 'must' },
          ],
        }),
        0,
      );
      expect(inserted[0]).toEqual(
        expect.objectContaining({
          messageId: 'm-2',
          isCorrection: true,
          category: 'missing_capability',
          routes: expect.objectContaining({
            lessonRecorded: true,
            fixtureId: 'fixture-1',
          }),
        }),
      );
    });

    it('records a card pick or an acknowledgement without a model call', async () => {
      const { service, inserted, complete } = build(
        [
          message({ id: 'm-3', content: 'ok, thanks' }),
          message({
            id: 'm-4',
            content: '[answers question q1] Guardrail [selected ids: g]',
            metadata: { answer: { selectedOptionIds: ['g'] } },
          }),
        ],
        correction,
      );

      const result = await service.scan();

      expect(result.skipped).toBe(2);
      expect(complete).not.toHaveBeenCalled();
      expect(inserted.map((row) => row.isCorrection)).toEqual([false, false]);
    });

    it('leaves a message for the next scan when the classifier fails', async () => {
      const { service, inserted } = build(
        [message()],
        new Error('rate limited'),
      );

      const result = await service.scan();

      expect(result).toEqual({ classified: 0, corrections: 0, skipped: 0 });
      expect(inserted).toHaveLength(0);
    });

    it("appends to the loop's own fixture but leaves a person's alone", async () => {
      const auto = {
        id: 'auto-1',
        name: 'auto: Rate the debrief (2bc3a5cf)',
        kind: 'interview',
        active: false,
        sourceSessionId: '2bc3a5cf-e3a5-4bf4-bafe-ac6b0bc51f87',
        payload: {
          checklist: [{ id: 'C1', text: 'Plans ally-mobile', kind: 'must' }],
        },
      };
      const first = build([message()], correction);
      first.fixtureService.list.mockResolvedValue([auto]);
      await first.service.scan();
      expect(first.fixtureService.update).toHaveBeenCalledWith('auto-1', {
        checklist: [
          { id: 'C1', text: 'Plans ally-mobile', kind: 'must' },
          {
            id: 'C2',
            text: 'Reuses Auto-improve rather than a new job',
            kind: 'must',
          },
        ],
      });

      const second = build([message()], correction);
      second.fixtureService.list.mockResolvedValue([
        { ...auto, id: 'curated-1', name: 'debrief — golden', active: true },
      ]);
      await second.service.scan();
      expect(second.fixtureService.update).not.toHaveBeenCalled();
      expect(second.fixtureService.createFromSession).not.toHaveBeenCalled();
      expect(second.inserted[0].routes.fixtureId).toBe('curated-1');
    });
  });

  it('counts corrections per session, leaving dismissed ones out', async () => {
    const rows = [
      {
        sessionId: 'a',
        isCorrection: true,
        status: 'new',
        category: 'missing_capability',
      },
      {
        sessionId: 'a',
        isCorrection: true,
        status: 'dismissed',
        category: 'other',
      },
      { sessionId: 'b', isCorrection: false, status: 'new' },
      {
        sessionId: 'c',
        isCorrection: true,
        status: 'reviewed',
        category: 'platform_scope',
      },
    ];
    const service = new BuilderCorrectionService(
      {
        getRepository: () => ({ find: jest.fn().mockResolvedValue(rows) }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const { summary, corrections } = await service.list({});

    expect(summary).toEqual({
      sessions: 3,
      correctedSessions: 2,
      corrections: 2,
      perSession: 0.67,
      byCategory: { missing_capability: 1, platform_scope: 1 },
    });
    expect(corrections).toHaveLength(2);
  });
});

describe('checklistLine', () => {
  const { checklistLine } = require('../builder-correction.service');

  it('turns a "must not" sentence tagged must into a must_not line', () => {
    expect(
      checklistLine('The PRD must not redefine win/promotion criteria', 'must'),
    ).toEqual({ text: 'Redefine win/promotion criteria', kind: 'must_not' });
  });

  it('keeps a plain line and its tag', () => {
    expect(
      checklistLine('Reuses Auto-improve for challengers', 'must'),
    ).toEqual({
      text: 'Reuses Auto-improve for challengers',
      kind: 'must',
    });
    expect(checklistLine('A new challenger job', 'must_not').kind).toBe(
      'must_not',
    );
  });
});
