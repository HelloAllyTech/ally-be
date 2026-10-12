import { SkillExperimentEngineService } from '../skill-experiment-engine.service';
import {
  SkillExperimentEventType,
  SkillExperimentPauseReason,
  SkillExperimentStatus,
  SkillObservationStatus,
  SkillVariantStatus,
} from '../../enum/skill-experiment.enum';
import { contentHash } from '../../util/placeholder-lock.util';
import { VariantStats } from '../skill-experiment-state.service';

const ORIGINAL_TEXT = 'Grade {{answer}} against {{guidance}}.';
const RUBRIC = [{ key: 'fair', name: 'Fair', description: 'Fair', weight: 1 }];

/**
 * In-memory stand-in for SkillExperimentStateService and its repositories —
 * enough of each to drive the engine's state machine without a database.
 */
function harness(options: {
  status?: SkillExperimentStatus;
  stats?: Record<string, VariantStats>;
  withChallenger?: boolean;
  experiment?: Record<string, unknown>;
  skillText?: string;
}) {
  const experiment: any = {
    id: 'exp-1',
    promptId: 'prompt-1',
    promptCode: 'track_quiz_open_ended_grading_user',
    status: options.status ?? SkillExperimentStatus.TESTING,
    run: 1,
    rubric: RUBRIC,
    targetScore: 85,
    minSamplesPerVariant: 30,
    challengerTrafficPercent: 30,
    maxVariants: 8,
    maxConsecutiveLosses: 3,
    minImprovement: 2,
    baseContentHash: contentHash(ORIGINAL_TEXT),
    outputShape: null,
    championVariantId: 'v-0',
    challengerVariantId: options.withChallenger ? 'v-1' : null,
    variantsDrafted: options.withChallenger ? 1 : 0,
    consecutiveLosses: 0,
    designFailures: 0,
    judgeModel: null,
    designerModel: null,
    ...options.experiment,
  };
  const variants: any[] = [
    {
      id: 'v-0',
      experimentId: 'exp-1',
      run: 1,
      ordinal: 0,
      label: 'Original',
      isOriginal: true,
      content: ORIGINAL_TEXT,
      status: SkillVariantStatus.CHAMPION,
    },
  ];
  if (options.withChallenger) {
    variants.push({
      id: 'v-1',
      experimentId: 'exp-1',
      run: 1,
      ordinal: 1,
      label: 'V1',
      isOriginal: false,
      content: 'Grade {{answer}} carefully against {{guidance}}.',
      status: SkillVariantStatus.CHALLENGER,
    });
  }
  const events: Array<{ type: SkillExperimentEventType; message: string }> = [];
  const pauses: SkillExperimentPauseReason[] = [];
  const observationUpdates: Array<{ id: string; patch: any }> = [];

  const state: any = {
    experiments: {
      find: jest.fn(async () => [experiment]),
      findOneByOrFail: jest.fn(async () => ({ ...experiment })),
      findOneBy: jest.fn(async () => ({ ...experiment })),
      update: jest.fn(async (_id: string, patch: any) =>
        Object.assign(experiment, patch),
      ),
    },
    variants: {
      find: jest.fn(async (query: any) =>
        query?.where?.status
          ? variants.filter(
              (v) => v.status !== SkillVariantStatus.CHAMPION && !v.isOriginal,
            )
          : variants.map((v) => ({ ...v })),
      ),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => {
        const saved = { id: `v-${variants.length}`, ...v };
        variants.push(saved);
        return saved;
      }),
      update: jest.fn(async (id: string, patch: any) =>
        Object.assign(variants.find((v) => v.id === id) ?? {}, patch),
      ),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({
          max: Math.max(...variants.map((v) => v.ordinal)),
        })),
      })),
    },
    observations: {
      find: jest.fn(async () => []),
      update: jest.fn(async (id: string, patch: any) =>
        observationUpdates.push({ id, patch }),
      ),
    },
    currentSkillText: jest.fn(async () => options.skillText ?? ORIGINAL_TEXT),
    refreshStats: jest.fn(
      async () => new Map(Object.entries(options.stats ?? {})),
    ),
    guardedUpdate: jest.fn(async (_e: any, from: string[], patch: any) => {
      if (!from.includes(experiment.status)) return false;
      Object.assign(experiment, patch);
      return true;
    }),
    logEvent: jest.fn(async (_id: string, type: any, message: string) => {
      events.push({ type, message });
    }),
    pause: jest.fn(async (_e: any, reason: SkillExperimentPauseReason) => {
      pauses.push(reason);
      experiment.status = SkillExperimentStatus.PAUSED;
      experiment.pausedReason = reason;
      return true;
    }),
    retireVariant: jest.fn(async (id: string, reason: string) =>
      Object.assign(variants.find((v) => v.id === id) ?? {}, {
        status: SkillVariantStatus.RETIRED,
        statusReason: reason,
      }),
    ),
    beginRun: jest.fn(async () => true),
  };

  const judge = { judge: jest.fn() };
  const designer = {
    draft: jest.fn(async () => ({
      ok: true,
      content: 'Grade {{answer}} strictly against {{guidance}}.',
      changeSummary: 'Asked for strictness.',
      hypothesis: 'Fairer scores.',
      model: 'model-x',
    })),
  };
  const router = { invalidate: jest.fn() };
  const prompts = {
    findOneBy: jest.fn(async () => ({ name: 'Quiz grader', description: '' })),
  };

  const engine = new SkillExperimentEngineService(
    {} as any,
    state,
    judge as any,
    designer as any,
    router as any,
    prompts as any,
  );
  return {
    engine,
    experiment,
    variants,
    events,
    pauses,
    state,
    judge,
    designer,
    router,
    observationUpdates,
  };
}

const run = (h: ReturnType<typeof harness>) =>
  h.engine.process('exp-1', () => false);

const arm = (n: number, mean: number, sd = 5, formatFailures = 0) => ({
  n,
  mean,
  sd,
  formatFailures,
});

describe('SkillExperimentEngineService', () => {
  describe('baseline', () => {
    it('keeps collecting until the original has the minimum sample', async () => {
      const h = harness({
        status: SkillExperimentStatus.BASELINE,
        stats: { 'v-0': arm(29, 60) },
      });
      await run(h);
      expect(h.experiment.status).toBe(SkillExperimentStatus.BASELINE);
      expect(h.designer.draft).not.toHaveBeenCalled();
    });

    it('moves to testing and launches the first challenger once the baseline is ready', async () => {
      const h = harness({
        status: SkillExperimentStatus.BASELINE,
        stats: { 'v-0': arm(30, 60) },
      });
      await run(h);
      expect(h.experiment.status).toBe(SkillExperimentStatus.TESTING);
      expect(h.experiment.challengerVariantId).toBeTruthy();
      expect(h.experiment.variantsDrafted).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual([
        SkillExperimentEventType.BASELINE_READY,
        SkillExperimentEventType.VARIANT_LAUNCHED,
      ]);
      expect(h.router.invalidate).toHaveBeenCalled();
    });

    it('pauses without drafting when the original already meets the target', async () => {
      const h = harness({
        status: SkillExperimentStatus.BASELINE,
        stats: { 'v-0': arm(30, 90) },
      });
      await run(h);
      expect(h.pauses).toEqual([
        SkillExperimentPauseReason.BASELINE_MEETS_TARGET,
      ]);
      expect(h.designer.draft).not.toHaveBeenCalled();
    });
  });

  describe('testing', () => {
    it('crowns a challenger that wins and drafts the next one from it', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 60), 'v-1': arm(30, 70) },
      });
      await run(h);
      expect(h.experiment.championVariantId).toBe('v-1');
      expect(h.variants.find((v) => v.id === 'v-0').status).toBe(
        SkillVariantStatus.RETIRED,
      );
      expect(h.events.map((e) => e.type)).toContain(
        SkillExperimentEventType.CHAMPION_CHANGED,
      );
      // The next draft is revised from the new champion.
      expect(h.designer.draft).toHaveBeenCalledWith(
        expect.objectContaining({
          currentBest: expect.objectContaining({ label: 'V1' }),
          originalText: ORIGINAL_TEXT,
        }),
      );
    });

    it('pauses with the winner serving when it reaches the target', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(30, 88) },
      });
      await run(h);
      expect(h.experiment.championVariantId).toBe('v-1');
      expect(h.pauses).toEqual([SkillExperimentPauseReason.TARGET_REACHED]);
      expect(h.designer.draft).not.toHaveBeenCalled();
    });

    it('retires a losing challenger and drafts another', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(30, 60) },
      });
      await run(h);
      expect(h.variants.find((v) => v.id === 'v-1').status).toBe(
        SkillVariantStatus.RETIRED,
      );
      expect(h.experiment.consecutiveLosses).toBe(1);
      expect(h.designer.draft).toHaveBeenCalledTimes(1);
    });

    it('pulls a challenger early when it breaks the output format', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(10, 50, 5, 4) },
      });
      await run(h);
      const retired = h.events.find(
        (e) => e.type === SkillExperimentEventType.VARIANT_RETIRED,
      );
      expect(retired?.message).toMatch(/retired early/);
    });

    it('pauses for lack of progress after too many losses in a row', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(30, 60) },
        experiment: { consecutiveLosses: 2 },
      });
      await run(h);
      expect(h.pauses).toEqual([SkillExperimentPauseReason.NO_PROGRESS]);
      expect(h.designer.draft).not.toHaveBeenCalled();
    });

    it('pauses when the variant budget is spent', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(30, 60) },
        experiment: { variantsDrafted: 8 },
      });
      await run(h);
      expect(h.pauses).toEqual([SkillExperimentPauseReason.MAX_VARIANTS]);
    });

    it('waits while the comparison is undecided', async () => {
      const h = harness({
        withChallenger: true,
        stats: { 'v-0': arm(40, 70), 'v-1': arm(12, 71) },
      });
      await run(h);
      expect(h.experiment.challengerVariantId).toBe('v-1');
      expect(h.events).toEqual([]);
    });
  });

  describe('designer failures', () => {
    it('stores a rejected draft that never serves, and counts the failure', async () => {
      const h = harness({ stats: { 'v-0': arm(30, 60) } });
      h.designer.draft.mockResolvedValueOnce({
        ok: false,
        errors: ['Dropped runtime placeholders: {{guidance}}'],
        lastContent: 'Grade {{answer}}.',
        model: 'model-x',
      } as any);
      await run(h);
      const rejected = h.variants.find(
        (v) => v.status === SkillVariantStatus.REJECTED,
      );
      expect(rejected?.statusReason).toMatch(/\{\{guidance\}\}/);
      expect(h.experiment.challengerVariantId).toBeNull();
      expect(h.experiment.designFailures).toBe(1);
    });

    it('pauses after repeated design failures', async () => {
      const h = harness({
        stats: { 'v-0': arm(30, 60) },
        experiment: { designFailures: 2 },
      });
      h.designer.draft.mockResolvedValueOnce({
        ok: false,
        errors: ['x'],
        lastContent: null,
        model: null,
      } as any);
      await run(h);
      expect(h.pauses).toEqual([SkillExperimentPauseReason.DESIGNER_FAILED]);
    });

    it('discards a draft when an admin stopped the experiment meanwhile', async () => {
      const h = harness({ stats: { 'v-0': arm(30, 60) } });
      h.state.experiments.findOneBy.mockResolvedValueOnce({
        ...h.experiment,
        status: SkillExperimentStatus.OFF,
      });
      await run(h);
      expect(h.variants).toHaveLength(1);
    });
  });

  it('restarts the run from the new text when the skill was edited', async () => {
    const h = harness({ skillText: 'An edited skill {{answer}} {{guidance}}' });
    await run(h);
    expect(h.state.beginRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exp-1' }),
      'An edited skill {{answer}} {{guidance}}',
      expect.any(Array),
      expect.objectContaining({ type: SkillExperimentEventType.RESET }),
    );
    expect(h.state.refreshStats).not.toHaveBeenCalled();
  });

  it('only judges, never advances, a paused experiment', async () => {
    const h = harness({
      status: SkillExperimentStatus.PAUSED,
      stats: { 'v-0': arm(40, 60) },
    });
    await run(h);
    expect(h.designer.draft).not.toHaveBeenCalled();
    expect(h.state.refreshStats).toHaveBeenCalled();
  });

  describe('judgeOne', () => {
    const observation = (patch: any = {}) => ({
      id: 'o-1',
      input: { answer: 'x' },
      output: '{"score": 1, "feedback": "ok"}',
      skillError: null,
      judgeAttempts: 0,
      ...patch,
    });

    it('scores a failed skill call 0 without calling the judge', async () => {
      const h = harness({});
      await h.engine.judgeOne(
        h.experiment,
        h.variants[0],
        null,
        observation({ skillError: 'timeout', output: null }) as any,
      );
      expect(h.judge.judge).not.toHaveBeenCalled();
      expect(h.observationUpdates[0].patch).toMatchObject({
        status: SkillObservationStatus.JUDGED,
        score: 0,
        formatOk: false,
      });
    });

    it('scores an output that broke the established shape 0', async () => {
      const h = harness({
        experiment: {
          outputShape: { kind: 'json', requiredKeys: ['feedback', 'score'] },
        },
      });
      await h.engine.judgeOne(
        h.experiment,
        h.variants[0],
        null,
        observation({ output: 'Score: 1' }) as any,
      );
      expect(h.judge.judge).not.toHaveBeenCalled();
      expect(h.observationUpdates[0].patch.score).toBe(0);
    });

    it('sends the original text, never the variant, as the judge’s task context', async () => {
      const h = harness({ withChallenger: true });
      h.judge.judge.mockResolvedValue({
        score: 75,
        criteria: { fair: { score: 4, reason: 'ok' } },
        summary: 'fine',
        model: 'judge-1',
      });
      await h.engine.judgeOne(
        h.experiment,
        h.variants[0],
        null,
        observation() as any,
      );
      expect(h.judge.judge).toHaveBeenCalledWith(
        expect.objectContaining({ taskInstructions: ORIGINAL_TEXT }),
      );
      expect(JSON.stringify(h.judge.judge.mock.calls[0][0])).not.toContain(
        'v-1',
      );
      expect(h.observationUpdates[0].patch).toMatchObject({
        status: SkillObservationStatus.JUDGED,
        score: 75,
        judgeModel: 'judge-1',
      });
    });

    it('marks an observation failed after the last judge attempt', async () => {
      const h = harness({});
      h.judge.judge.mockRejectedValue(new Error('bad json'));
      await h.engine.judgeOne(
        h.experiment,
        h.variants[0],
        null,
        observation({ judgeAttempts: 2 }) as any,
      );
      expect(h.observationUpdates[0].patch).toMatchObject({
        judgeAttempts: 3,
        status: SkillObservationStatus.FAILED,
      });
    });
  });
});
