import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import { TASK_AREA } from '../../repository/roleplay-cost-analytics.repository';
import { EffectivenessOrgsAnalyticsService } from '../effectiveness-orgs-analytics.service';

const ORG = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Alpha',
  code: 'alpha',
};

const cut = (
  userId: number,
  n: number,
  score: number,
  closedAt = new Date('2026-09-10T00:00:00Z'),
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: null,
  tenantId: 'alpha',
  cut: n,
  closedAt,
  score,
  unhelpful: false,
  levels: { verbal: 3 },
  verdicts: [],
  sessionIds: [`s-${userId}-${n}`],
});

const improvingLearner = (userId: number) =>
  [2, 2.1, 2.9, 3].map((s, i) => cut(userId, i + 1, s));

const setup = (rows: FoundationalSkillsLearnerCutRow[]) => {
  const repository = {
    getOrgs: jest.fn().mockResolvedValue([ORG]),
    getEnrolmentCounts: jest
      .fn()
      .mockResolvedValue([
        { tenantRef: ORG.id, started: 30, completed: 12, learnersStarted: 25 },
      ]),
    getLearnersWithSpend: jest.fn().mockResolvedValue(17),
  };
  const cuts = { getAllLearnerCuts: jest.fn().mockResolvedValue(rows) };
  const roleplayCost = {
    getRoleplayCost: jest.fn().mockResolvedValue({
      window: {
        from: '2026-09-01',
        to: '2026-09-30',
        label: '2026-09-01 → 2026-09-30',
        days: 30,
        bucket: 'week',
        allTime: false,
        inProgressBucket: null,
        computedAt: '2026-10-05T00:00:00.000Z',
      },
      totalAttributableCostUsd: 84.4567,
      totalUnpricedCalls: 2,
    }),
  };
  const service = new EffectivenessOrgsAnalyticsService(
    repository as any,
    cuts as any,
    roleplayCost as any,
  );
  return { service, repository, cuts, roleplayCost };
};

describe('EffectivenessOrgsAnalyticsService.getOrgScorecard', () => {
  it('reads every scored cut ONCE, platform-wide and rubric-pinned, whatever org is asked for', async () => {
    const rows = Array.from({ length: 20 }, (_, k) =>
      improvingLearner(k + 1),
    ).flat();
    const { service, cuts } = setup(rows);
    const out = await service.getOrgScorecard({ tenantId: 'alpha' });
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledTimes(1);
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(FHS_RUBRIC_VERSION);
    expect(out.orgs).toHaveLength(1);
    expect(out.orgs[0]).toMatchObject({
      tenantId: ORG.id,
      measurableLearners: 20,
      belowFloor: false,
      courses: { started: 30, completed: 12, completionPct: 40 },
    });
    expect(out.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(out.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(out.scoping).toEqual({
      tenantId: 'alpha',
      unscopedSections: ['platform', 'summary', 'cutNoiseSd'],
    });
    expect(out.provenance.derivation).toContain('R1');
    expect(out.provenance.note).toContain('internal');
    expect(out.sparkMonths).toHaveLength(6);
  });

  it('is empty, not broken, with no data', async () => {
    const { service } = setup([]);
    const out = await service.getOrgScorecard({});
    expect(out.orgs.map((o) => o.measurableLearners)).toEqual([0]);
    expect(out.cutNoiseSd).toBeNull();
    expect(out.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });
});

describe('EffectivenessOrgsAnalyticsService.getCostPerImprovement', () => {
  it('takes the numerator from the roleplay-cost endpoint for the same window and reuses its bounds', async () => {
    const rows = Array.from({ length: 20 }, (_, k) =>
      improvingLearner(k + 1),
    ).flat();
    const { service, roleplayCost, repository, cuts } = setup(rows);
    const out = await service.getCostPerImprovement({
      range: '30d',
      bucket: 'day',
      tenantId: 'alpha',
    });
    // Same window query; bucket and tenant play no part in the total.
    expect(roleplayCost.getRoleplayCost).toHaveBeenCalledWith({
      range: '30d',
      from: undefined,
      to: undefined,
    });
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(FHS_RUBRIC_VERSION);
    expect(repository.getLearnersWithSpend).toHaveBeenCalledWith(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
      Object.keys(TASK_AREA),
    );
    expect(out).toMatchObject({
      spendUsd: 84.46,
      unpricedCalls: 2,
      improvedLearners: 20,
      classifiedLearners: 20,
      costPerImprovedLearnerUsd: 4.22,
      learnersWithSpend: 17,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      window: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(out.scoping.tenantId).toBeNull();
    expect(out.caveat).toContain('ceiling');
  });

  it('withholds the ratio below the floor of improved learners', async () => {
    const { service } = setup(improvingLearner(1));
    const out = await service.getCostPerImprovement({});
    expect(out.improvedLearners).toBe(1);
    expect(out.spendUsd).toBe(84.46);
    expect(out.costPerImprovedLearnerUsd).toBeNull();
  });
});
