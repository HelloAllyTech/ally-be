import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsAnalyticsService } from '../foundational-skills-analytics.service';

describe('FoundationalSkillsAnalyticsService', () => {
  const coverage = {
    learners: 60,
    cutsSealed: 120,
    cutsScored: 110,
    cutsFailed: 2,
    cutsPending: 8,
  };

  const build = (cutRows: any[], skillRows: any[] = []) => {
    const repository = {
      getCutRows: jest.fn().mockResolvedValue(cutRows),
      getSkillRows: jest.fn().mockResolvedValue(skillRows),
      getCoverage: jest.fn().mockResolvedValue(coverage),
    };
    return {
      repository,
      service: new FoundationalSkillsAnalyticsService(repository as any),
    };
  };

  const row = (cut: number, learners: number, extra: Partial<any> = {}) => ({
    cut,
    learners,
    avgScore: 2.345,
    baselineLearners: learners,
    pairedAvgScore: 2.3,
    baselineAvgScore: 2.1,
    pairedChange: 0.245,
    unhelpfulShare: 0.4167,
    ...extra,
  });

  it('reads the current rubric version only', async () => {
    const { repository, service } = build([]);
    await service.getFoundationalSkills();
    expect(repository.getCutRows).toHaveBeenCalledWith(FHS_RUBRIC_VERSION, 1);
    expect(repository.getSkillRows).toHaveBeenCalledWith(FHS_RUBRIC_VERSION);
    expect(repository.getCoverage).toHaveBeenCalledWith(FHS_RUBRIC_VERSION);
  });

  it('rounds averages and turns the unhelpful share into a percentage', async () => {
    const { service } = build([row(1, 40)]);
    const [cut] = (await service.getFoundationalSkills()).cuts;
    expect(cut.avgScore).toBe(2.35);
    expect(cut.baselineAvgScore).toBe(2.1);
    expect(cut.pairedAvgScore).toBe(2.3);
    expect(cut.pairedChange).toBe(0.25);
    expect(cut.unhelpfulPct).toBe(41.7);
  });

  it('withholds averages below the sample floor but keeps the counts', async () => {
    const { service } = build(
      [row(1, 40), row(2, 12, { baselineLearners: 11 })],
      [
        { cut: 2, skill: 'feelings', learners: 9, avgScore: 2.5 },
        { cut: 1, skill: 'feelings', learners: 30, avgScore: 2.25 },
      ],
    );
    const { cuts } = await service.getFoundationalSkills();
    expect(cuts[1]).toMatchObject({
      cut: 2,
      learners: 12,
      avgScore: null,
      baselineLearners: 11,
      pairedAvgScore: null,
      baselineAvgScore: null,
      pairedChange: null,
      unhelpfulPct: null,
      skills: [{ skill: 'feelings', learners: 9, avgScore: null }],
    });
    expect(cuts[0].skills).toEqual([
      { skill: 'feelings', learners: 30, avgScore: 2.25 },
    ]);
  });

  it('ends the axis at the last cut at least five learners reached', async () => {
    const { service } = build([
      row(1, 40),
      row(2, 6),
      row(3, 3),
      row(4, 5),
      row(5, 1),
    ]);
    const { cuts } = await service.getFoundationalSkills();
    expect(cuts.map((c) => c.cut)).toEqual([1, 2, 3, 4]);
  });

  it('describes the ruler and lists the 14 skills', async () => {
    const { service } = build([]);
    const res = await service.getFoundationalSkills();
    expect(res.cuts).toEqual([]);
    expect(res.skills).toHaveLength(14);
    expect(res.scoreDomain).toEqual([1, 4]);
    expect(res.minSampleSize).toBe(20);
    expect(res.coverage).toEqual(coverage);
    expect(res.provenance.note).toContain(FHS_RUBRIC_VERSION);
  });

  describe('getLearners', () => {
    const cutRow = (userId: number, cut: number, extra: Partial<any> = {}) => ({
      userId,
      name: `Learner ${userId}`,
      tenantId: 't-1',
      cut,
      closedAt: new Date(`2026-09-0${cut}T10:00:00Z`),
      score: 2,
      unhelpful: false,
      levels: { verbal: 3 },
      verdicts: [],
      sessionIds: [],
      ...extra,
    });

    const buildLearners = (rows: any[], total = 1) => {
      const repository = {
        getLearnerCuts: jest.fn().mockResolvedValue({ total, rows }),
        getSessionScenarios: jest.fn().mockResolvedValue(new Map()),
      };
      return {
        repository,
        service: new FoundationalSkillsAnalyticsService(repository as any),
      };
    };

    it('defaults the query and pins the current rubric version', async () => {
      const { repository, service } = buildLearners([]);
      const res = await service.getLearners({});
      expect(repository.getLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
        { minCut: 1, limit: 100, offset: 0, userId: undefined },
      );
      expect(res).toMatchObject({ minCut: 1, limit: 100, offset: 0 });
    });

    it('passes minCut and paging through', async () => {
      const { repository, service } = buildLearners([], 24);
      const res = await service.getLearners({
        minCut: 5,
        limit: 10,
        offset: 20,
      });
      expect(repository.getLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
        { minCut: 5, limit: 10, offset: 20, userId: undefined },
      );
      expect(res.total).toBe(24);
    });

    it('groups cuts per learner and computes change since cut 1', async () => {
      const { service } = buildLearners(
        [
          cutRow(7, 1, { score: 2.1 }),
          cutRow(7, 2, { score: 2.456, unhelpful: true }),
          cutRow(9, 1, { score: 2.5 }),
        ],
        2,
      );
      const { learners } = await service.getLearners({});
      expect(learners).toHaveLength(2);
      expect(learners[0]).toMatchObject({
        id: 7,
        name: 'Learner 7',
        cutsReached: 2,
        changeSinceFirstCut: 0.36,
      });
      expect(learners[0].cuts[1]).toMatchObject({
        cut: 2,
        compositeScore: 2.46,
        hasUnhelpfulBehaviour: true,
        closedAt: '2026-09-02T10:00:00.000Z',
      });
      expect(learners[1].changeSinceFirstCut).toBe(0);
    });

    it('flattens observed behaviour codes, deduped and sorted', async () => {
      const { service } = buildLearners([
        cutRow(7, 1, {
          verdicts: [
            { skill: 'verbal', observed: ['verbal.b2', 'verbal.b1'] },
            { skill: 'goals', observed: ['goals.u1'] },
            { skill: 'hope' },
            { skill: 'verbal', observed: ['verbal.b1'] },
          ],
        }),
      ]);
      const [learner] = (await service.getLearners({})).learners;
      expect(learner.cuts[0].observed).toEqual([
        'goals.u1',
        'verbal.b1',
        'verbal.b2',
      ]);
    });

    it('leaves the change null when cut 1 has no scored result', async () => {
      const { service } = buildLearners([cutRow(7, 2), cutRow(7, 3)]);
      const [learner] = (await service.getLearners({ minCut: 2 })).learners;
      expect(learner.changeSinceFirstCut).toBeNull();
      expect(learner.cutsReached).toBe(3);
    });
  });

  describe('getProgress', () => {
    const row = (
      userId: number,
      cut: number,
      levels: Record<string, number>,
    ) => ({
      userId,
      name: `Learner ${userId}`,
      tenantId: 't-1',
      cut,
      closedAt: new Date('2026-09-01T00:00:00Z'),
      score: 2,
      unhelpful: false,
      levels,
      verdicts: [{ skill: 'verbal', observed: ['verbal.b1'] }],
      sessionIds: [],
    });

    it('reads every scored cut under the current version and serves the thresholds', async () => {
      const rows = Array.from({ length: 25 }, (_, i) => [
        row(i + 1, 1, { verbal: 2 }),
        row(i + 1, 2, { verbal: 3 }),
      ]).flat();
      const repository = {
        getAllLearnerCuts: jest.fn().mockResolvedValue(rows),
      };
      const service = new FoundationalSkillsAnalyticsService(repository as any);

      const res = await service.getProgress({});

      expect(repository.getAllLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
      );
      expect(res).toMatchObject({
        rubricVersion: FHS_RUBRIC_VERSION,
        minSampleSize: 20,
        minCohortSize: 5,
        measuredLearners: 25,
        cuts: 2,
        cohortOptions: [{ cuts: 2, learners: 25 }],
        windows: { early: [1], late: [2] },
      });
      expect(res.thresholds.trendMinCuts).toBe(4);
      expect(res.skills.find((s) => s.skill === 'verbal')).toMatchObject({
        n: 25,
        change: 1,
        up: 25,
        detectable: true,
      });
      expect(res.precision.levelsChecked).toBe(0); // fixture verdicts carry no level
      expect(res.behaviours.find((b) => b.code === 'verbal.b1')).toMatchObject({
        earlyPct: 100,
        latePct: 100,
      });
      expect(res.provenance.note).toContain('cuts 1');
    });
  });

  it('passes a userId filter through to the learner read', async () => {
    const repository = {
      getLearnerCuts: jest.fn().mockResolvedValue({ total: 0, rows: [] }),
      getSessionScenarios: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new FoundationalSkillsAnalyticsService(repository as any);
    await service.getLearners({ userId: 42 });
    expect(repository.getLearnerCuts).toHaveBeenCalledWith(FHS_RUBRIC_VERSION, {
      minCut: 1,
      limit: 100,
      offset: 0,
      userId: 42,
    });
  });

  it('compares with cut 2 when asked and puts a CI on the paired change', async () => {
    const repository = {
      getCutRows: jest.fn().mockResolvedValue([
        {
          cut: 3,
          learners: 25,
          avgScore: 2.3,
          baselineLearners: 25,
          pairedAvgScore: 2.3,
          baselineAvgScore: 2.25,
          pairedChange: 0.05,
          pairedChangeSd: 0.25,
          unhelpfulShare: 0.3,
        },
      ]),
      getSkillRows: jest.fn().mockResolvedValue([]),
      getCoverage: jest.fn().mockResolvedValue({
        learners: 0,
        cutsSealed: 0,
        cutsScored: 0,
        cutsFailed: 0,
        cutsPending: 0,
      }),
    };
    const service = new FoundationalSkillsAnalyticsService(repository as any);
    const res = await service.getFoundationalSkills({ baselineCut: 2 });
    expect(repository.getCutRows).toHaveBeenCalledWith(FHS_RUBRIC_VERSION, 2);
    expect(res.baselineCut).toBe(2);
    // 0.05 ± 1.96 · 0.25 / √25 = 0.05 ± 0.098
    expect(res.cuts[0].pairedChangeCi).toEqual([-0.05, 0.15]);
  });

  it('attaches each cut its sessions and their scenarios', async () => {
    const repository = {
      getLearnerCuts: jest.fn().mockResolvedValue({
        total: 1,
        rows: [
          {
            userId: 7,
            name: 'L',
            tenantId: 't',
            cut: 1,
            closedAt: new Date('2026-09-01T00:00:00Z'),
            score: 2,
            unhelpful: false,
            levels: {},
            verdicts: [],
            sessionIds: ['s-1', 's-2'],
          },
        ],
      }),
      getSessionScenarios: jest
        .fn()
        .mockResolvedValue(
          new Map([['s-1', { scenarioId: 11, scenarioTitle: 'Exam stress' }]]),
        ),
    };
    const service = new FoundationalSkillsAnalyticsService(repository as any);
    const [learner] = (await service.getLearners({})).learners;
    expect(repository.getSessionScenarios).toHaveBeenCalledWith(['s-1', 's-2']);
    expect(learner.cuts[0].sessions).toEqual([
      { sessionId: 's-1', scenarioId: 11, scenarioTitle: 'Exam stress' },
      { sessionId: 's-2', scenarioId: null, scenarioTitle: null },
    ]);
  });
});
