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
    expect(repository.getCutRows).toHaveBeenCalledWith(FHS_RUBRIC_VERSION);
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
      ...extra,
    });

    const buildLearners = (rows: any[], total = 1) => {
      const repository = {
        getLearnerCuts: jest.fn().mockResolvedValue({ total, rows }),
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
        1,
        100,
        0,
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
        5,
        10,
        20,
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
});
