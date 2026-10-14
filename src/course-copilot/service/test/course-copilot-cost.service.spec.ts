import { LlmUsage } from 'src/analytics/entity/llm-usage.entity';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD as EXTRA_LANGUAGE,
  COURSE_COPILOT_JOB_COST_ESTIMATE_USD as JOB,
  COURSE_COPILOT_PLANNER_COST_USD as PLANNER,
} from '../../constants/course-copilot.constants';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../../enum/course-copilot.enum';
import { CourseBlueprint, CourseBrief } from '../../type/course-copilot.type';
import { CourseCopilotCostService } from '../course-copilot-cost.service';
import { item } from '../specialists/test/specialist-test.fixtures';
import { makeSession } from './course-copilot-test.fixtures';

const round2 = (value: number) => Math.round(value * 100) / 100;

describe('CourseCopilotCostService', () => {
  let service: CourseCopilotCostService;
  let config: { courseCopilot: { imageCostUsd: number } };
  let jobRepository: { countByStatus: jest.Mock };
  let usageRows: Record<string, string>[];
  /** Every call made on the usage query builder, in order. */
  let qbCalls: { method: string; args: any[] }[];

  beforeEach(() => {
    config = { courseCopilot: { imageCostUsd: 0.1 } };
    jobRepository = { countByStatus: jest.fn().mockResolvedValue(0) };
    usageRows = [];
    qbCalls = [];
    const chain: any = new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (method === 'getRawMany') return async () => usageRows;
          return (...args: any[]) => {
            qbCalls.push({ method, args });
            return chain;
          };
        },
      },
    );
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity !== LlmUsage) throw new Error('unexpected repository');
        return { createQueryBuilder: () => chain };
      }),
    };
    service = new CourseCopilotCostService(
      dataSource as any,
      config as any,
      jobRepository as any,
    );
  });

  // ── estimate ─────────────────────────────────────────────────────────────

  describe('estimate', () => {
    const blueprint = (
      items: ReturnType<typeof item>[],
      cover: CourseBlueprint['cover'] = { mode: 'upload-later' },
    ): Pick<CourseBlueprint, 'sections' | 'cover'> => ({
      cover,
      sections: [
        { id: 's1', title: 'One', description: '', purpose: '', items },
      ],
    });
    /** Fixed costs every course carries: the planner, the meta polish, the reviewer. */
    const BASE = PLANNER + JOB.course_meta + JOB.course_review;

    it('charges the planner, course meta and reviewer even for an empty course', () => {
      expect(service.estimate(blueprint([]), {})).toEqual({
        usd: round2(BASE),
        minutes: 0,
        items: 0,
        newRoleplays: 0,
        images: 0,
      });
    });

    it('adds each generated item type at its own rate', () => {
      const estimate = service.estimate(
        blueprint([
          item({ id: 'a', type: 'ARTICLE', estimatedMinutes: 6 }),
          item({ id: 'q', type: 'QUIZ', estimatedMinutes: 5 }),
          item({ id: 'j', type: 'JOURNAL', estimatedMinutes: 4 }),
          item({ id: 'n', type: 'ANNOTATED_ARTIFACT', estimatedMinutes: 8 }),
        ]),
        {},
      );
      expect(estimate.usd).toBe(
        round2(
          BASE + JOB.article + JOB.quiz + JOB.journal + JOB.annotated_artifact,
        ),
      );
      expect(estimate).toMatchObject({
        items: 4,
        minutes: 23,
        newRoleplays: 0,
        images: 0,
      });
    });

    it('costs nothing for items that make no model call', () => {
      const estimate = service.estimate(
        blueprint([
          item({ id: 'g', type: 'GAME' }),
          item({ id: 'v', type: 'VIDEO' }),
          item({
            id: 'c',
            type: 'CASE',
            source: { kind: 'library', caseId: 'c' },
          }),
          item({ id: 'c2', type: 'CASE', spec: { memberItemIds: [] } }), // a new case: its roleplays carry the cost
          item({
            id: 'r',
            type: 'ROLEPLAY',
            source: { kind: 'library', scenarioId: 5 },
          }),
        ]),
        {},
      );
      expect(estimate.usd).toBe(round2(BASE));
      expect(estimate.items).toBe(5);
      expect(estimate.newRoleplays).toBe(0); // a library roleplay is not a new one
    });

    it('charges a new roleplay once for one language, and counts it', () => {
      const estimate = service.estimate(
        blueprint([item({ id: 'r', type: 'ROLEPLAY' })]),
        { shape: { languageIds: ['1'] } },
      );
      expect(estimate.usd).toBe(round2(BASE + JOB.roleplay_new));
      expect(estimate.newRoleplays).toBe(1);
    });

    it('adds the per-language cost for each spoken language past the first, from the item', () => {
      const estimate = service.estimate(
        blueprint([
          item({
            id: 'r',
            type: 'ROLEPLAY',
            spec: { languageIds: ['1', '2', '3'] },
          }),
        ]),
        { shape: { languageIds: ['1'] } },
      );
      expect(estimate.usd).toBe(
        round2(BASE + JOB.roleplay_new + 2 * EXTRA_LANGUAGE),
      );
    });

    it('falls back to the brief languages when the item names none', () => {
      const brief: CourseBrief = { shape: { languageIds: ['1', '2'] } };
      const estimate = service.estimate(
        blueprint([item({ id: 'r', type: 'ROLEPLAY' })]),
        brief,
      );
      expect(estimate.usd).toBe(
        round2(BASE + JOB.roleplay_new + EXTRA_LANGUAGE),
      );
    });

    it('never charges less than one language, whatever the lists say', () => {
      const estimate = service.estimate(
        blueprint([
          item({ id: 'r', type: 'ROLEPLAY', spec: { languageIds: [] } }),
        ]),
        { shape: { languageIds: [] } },
      );
      expect(estimate.usd).toBe(round2(BASE + JOB.roleplay_new));
    });

    it('does not charge language extras for a library roleplay', () => {
      const estimate = service.estimate(
        blueprint([
          item({
            id: 'r',
            type: 'ROLEPLAY',
            source: { kind: 'library', scenarioId: 5 },
            spec: { languageIds: ['1', '2', '3'] },
          }),
        ]),
        {},
      );
      expect(estimate.usd).toBe(round2(BASE));
    });

    describe('images', () => {
      it('counts one for a generated cover, priced at the configured rate', () => {
        const estimate = service.estimate(
          blueprint([], { mode: 'generate' }),
          {},
        );
        expect(estimate.images).toBe(1);
        expect(estimate.usd).toBe(round2(BASE + 0.1));
      });

      it.each(['library', 'upload-later'] as const)(
        'counts none for a %s cover',
        (mode) => {
          expect(service.estimate(blueprint([], { mode }), {}).images).toBe(0);
        },
      );

      it('counts an article image only for articles flagged withImage', () => {
        const estimate = service.estimate(
          blueprint([
            item({ id: 'a1', type: 'ARTICLE', spec: { withImage: true } }),
            item({ id: 'a2', type: 'ARTICLE' }),
            item({ id: 'q', type: 'QUIZ', spec: { withImage: true } }), // not an article
          ]),
          {},
        );
        expect(estimate.images).toBe(1);
      });

      it('counts one per article when the brief asks for one-per-article, without double counting flagged ones', () => {
        const estimate = service.estimate(
          blueprint([
            item({ id: 'a1', type: 'ARTICLE', spec: { withImage: true } }),
            item({ id: 'a2', type: 'ARTICLE' }),
            item({ id: 'q', type: 'QUIZ' }),
          ]),
          { look: { articleImages: 'one-per-article' } },
        );
        expect(estimate.images).toBe(2);
      });

      it.each(['none', 'cover-only'] as const)(
        'counts no article images for %s',
        (articleImages) => {
          const estimate = service.estimate(
            blueprint([item({ id: 'a', type: 'ARTICLE' })]),
            { look: { articleImages } },
          );
          expect(estimate.images).toBe(0);
        },
      );

      it('prices every image at the flat rate from config', () => {
        config.courseCopilot.imageCostUsd = 0.25;
        const estimate = service.estimate(
          blueprint([item({ id: 'a', type: 'ARTICLE' })], { mode: 'generate' }),
          { look: { articleImages: 'one-per-article' } },
        );
        expect(estimate.images).toBe(2);
        expect(estimate.usd).toBe(round2(BASE + JOB.article + 2 * 0.25));
      });
    });

    it('adds up a realistic course and rounds to cents', () => {
      const estimate = service.estimate(
        blueprint(
          [
            item({ id: 'a', type: 'ARTICLE', estimatedMinutes: 6 }),
            item({ id: 'r1', type: 'ROLEPLAY', estimatedMinutes: 12 }),
            item({
              id: 'r2',
              type: 'ROLEPLAY',
              estimatedMinutes: 12,
              spec: { languageIds: ['1', '2'] },
            }),
            item({ id: 'q', type: 'QUIZ', estimatedMinutes: 5 }),
          ],
          { mode: 'generate' },
        ),
        {
          shape: { languageIds: ['1'] },
          look: { articleImages: 'one-per-article' },
        },
      );
      const expected = round2(
        BASE +
          JOB.article +
          2 * JOB.roleplay_new +
          EXTRA_LANGUAGE +
          JOB.quiz +
          2 * 0.1,
      );
      expect(estimate).toEqual({
        usd: expected,
        minutes: 35,
        items: 4,
        newRoleplays: 2,
        images: 2,
      });
      expect(Number.isInteger(estimate.usd * 100)).toBe(true); // no float dust
    });

    it('treats missing or non-numeric minutes as zero, and a missing list of sections as empty', () => {
      const estimate = service.estimate(
        blueprint([
          item({
            id: 'a',
            type: 'ARTICLE',
            estimatedMinutes: undefined as any,
          }),
          item({ id: 'b', type: 'ARTICLE', estimatedMinutes: 'soon' as any }),
          item({ id: 'c', type: 'ARTICLE', estimatedMinutes: '7' as any }),
        ]),
        {},
      );
      expect(estimate.minutes).toBe(7);
      expect(
        service.estimate({ cover: { mode: 'upload-later' } } as any, {}).items,
      ).toBe(0);
    });
  });

  describe('jobEstimate', () => {
    it('returns the static rate for a kind', () => {
      expect(service.jobEstimate(CourseCopilotJobKind.QUIZ)).toBe(JOB.quiz);
      expect(service.jobEstimate(CourseCopilotJobKind.GAME)).toBe(0);
    });

    it('adds the per-language cost to a new roleplay only', () => {
      expect(service.jobEstimate(CourseCopilotJobKind.ROLEPLAY_NEW, 3)).toBe(
        JOB.roleplay_new + 2 * EXTRA_LANGUAGE,
      );
      expect(service.jobEstimate(CourseCopilotJobKind.ROLEPLAY_NEW, 0)).toBe(
        JOB.roleplay_new,
      );
      expect(service.jobEstimate(CourseCopilotJobKind.ARTICLE, 3)).toBe(
        JOB.article,
      );
    });
  });

  // ── spent ────────────────────────────────────────────────────────────────

  describe('spent', () => {
    const session = makeSession({
      createdAt: new Date('2026-10-14T10:00:00Z'),
    });
    const row = (overrides: Record<string, string>) => ({
      model: 'claude-sonnet-5', // $3 in / $15 out per million
      task: LlmTask.COURSE_COPILOT_ARTICLE,
      unit: 'tokens',
      prompt: '0',
      completion: '0',
      cached: '0',
      cacheCreation: '0',
      calls: '1',
      ...overrides,
    });

    it('is zero when nothing was recorded', async () => {
      expect(await service.spent(session)).toBe(0);
    });

    it('prices token usage by model, input and output separately', async () => {
      usageRows = [
        row({ prompt: '1000000', completion: '100000', calls: '3' }),
      ];
      // 1M in × $3 + 0.1M out × $15
      expect(await service.spent(session)).toBe(4.5);
    });

    it('sums rows across models and tasks', async () => {
      usageRows = [
        row({ prompt: '1000000' }), // $3
        row({
          model: 'claude-haiku-4-5',
          task: LlmTask.COURSE_COPILOT_QUIZ,
          completion: '1000000',
        }), // $5
      ];
      expect(await service.spent(session)).toBe(8);
    });

    it('prices prompt-cache reads and writes off the input rate', async () => {
      usageRows = [row({ cached: '1000000', cacheCreation: '1000000' })];
      // reads at 0.1× input ($0.30) + writes at 1.25× input ($3.75)
      expect(await service.spent(session)).toBe(4.05);
    });

    it('counts images at the flat rate per call, ignoring tokens', async () => {
      usageRows = [
        row({
          task: LlmTask.COURSE_COPILOT_IMAGE,
          model: 'gpt-image-1',
          calls: '4',
          prompt: '999999',
        }),
      ];
      expect(await service.spent(session)).toBe(0.4);
    });

    it('counts any row in the images unit at the flat rate', async () => {
      usageRows = [
        row({ unit: 'images', calls: '2', model: 'some-image-model' }),
      ];
      expect(await service.spent(session)).toBe(0.2);
    });

    it('uses the configured flat image rate', async () => {
      config.courseCopilot.imageCostUsd = 0.25;
      usageRows = [row({ task: LlmTask.COURSE_COPILOT_IMAGE, calls: '3' })];
      expect(await service.spent(session)).toBe(0.75);
    });

    it('adds images and tokens together and rounds to cents', async () => {
      usageRows = [
        row({ prompt: '1234567', completion: '7654' }), // 3.703701 + 0.11481
        row({ task: LlmTask.COURSE_COPILOT_IMAGE, calls: '1' }), // 0.10
      ];
      const spent = await service.spent(session);
      expect(spent).toBe(3.92);
      expect(Number.isInteger(spent * 100)).toBe(true);
    });

    it('counts a model with no pricing row as free rather than failing', async () => {
      usageRows = [row({ model: 'brand-new-model-9', prompt: '5000000' })];
      expect(await service.spent(session)).toBe(0);
    });

    it('tolerates empty numeric columns', async () => {
      usageRows = [
        row({ prompt: '', completion: '', cached: '', cacheCreation: '' }),
      ];
      expect(await service.spent(session)).toBe(0);
    });

    describe('the usage query', () => {
      const argsOf = (method: string) =>
        qbCalls.filter((call) => call.method === method).map((c) => c.args);

      it("looks only at this session's rows, by the id the specialists tag their usage with", async () => {
        await service.spent(session);
        const where = qbCalls.find(
          (call) =>
            call.method === 'andWhere' &&
            String(call.args[0]).includes('courseCopilotSessionId'),
        )!;
        expect(where.args[1]).toEqual({ sessionId: 'session-1' });
      });

      it('covers every Course Copilot task plus the Agent Builder rows its roleplay chain runs on', async () => {
        await service.spent(session);
        const tasks: string[] = qbCalls.find((call) => call.method === 'where')!
          .args[1].tasks;
        expect(tasks).toEqual(
          expect.arrayContaining([
            LlmTask.COURSE_COPILOT_INTERVIEW,
            LlmTask.COURSE_COPILOT_ARTICLE,
            LlmTask.COURSE_COPILOT_IMAGE,
            LlmTask.COURSE_COPILOT_REVIEW,
            LlmTask.AUTOFILL_AGENT_FIELD,
          ]),
        );
        expect(tasks.filter((t) => !t.startsWith('course_copilot_'))).toEqual([
          LlmTask.AUTOFILL_AGENT_FIELD,
        ]);
      });

      it('allows a minute of clock skew before the session began', async () => {
        await service.spent(session);
        const since: Date = argsOf('andWhere').find(
          (args) => args[1]?.since,
        )![1].since;
        expect(since.toISOString()).toBe('2026-10-14T09:59:00.000Z');
      });

      it('groups by model, task and unit', async () => {
        await service.spent(session);
        expect(argsOf('groupBy')).toEqual([['lu.model']]);
        expect(argsOf('addGroupBy')).toEqual([['lu.task'], ['lu.unit']]);
      });
    });
  });

  // ── budget ───────────────────────────────────────────────────────────────

  describe('budget', () => {
    const withSpend = (spent: number, held = 0) => {
      jest.spyOn(service, 'spent').mockResolvedValue(spent);
      jobRepository.countByStatus.mockResolvedValue(held);
    };

    it('reports ceiling, spend and what remains', async () => {
      withSpend(4.5);
      expect(await service.budget(makeSession({ budgetUsd: '15.00' }))).toEqual(
        {
          ceilingUsd: 15,
          spentUsd: 4.5,
          remainingUsd: 10.5,
          held: false,
        },
      );
    });

    it('treats a ceiling of 0 as uncapped: no remaining figure', async () => {
      withSpend(999);
      expect(await service.budget(makeSession({ budgetUsd: '0.00' }))).toEqual({
        ceilingUsd: 0,
        spentUsd: 999,
        remainingUsd: null,
        held: false,
      });
    });

    it('never reports a negative remainder when the ceiling has been passed', async () => {
      withSpend(18.25);
      const view = await service.budget(makeSession({ budgetUsd: '15' }));
      expect(view.remainingUsd).toBe(0);
      expect(view.spentUsd).toBe(18.25);
    });

    it('rounds the remainder to cents', async () => {
      withSpend(0.1 + 0.2);
      expect(
        (await service.budget(makeSession({ budgetUsd: '1.00' }))).remainingUsd,
      ).toBe(0.7);
    });

    it('says held when jobs are waiting on a budget raise, and asks about held jobs only', async () => {
      withSpend(15, 3);
      const view = await service.budget(makeSession({ budgetUsd: '15.00' }));
      expect(view.held).toBe(true);
      expect(jobRepository.countByStatus).toHaveBeenCalledWith('session-1', [
        CourseCopilotJobStatus.HELD,
      ]);
    });
  });
});
