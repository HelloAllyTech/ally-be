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
});
