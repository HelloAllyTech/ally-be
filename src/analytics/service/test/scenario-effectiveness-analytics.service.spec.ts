import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import { ScenarioCalibrationAnalyticsRepository } from '../../repository/scenario-calibration-analytics.repository';
import { ScenarioEffectivenessAnalyticsRepository } from '../../repository/scenario-effectiveness-analytics.repository';
import { RepeatGroupRow } from '../../util/scenario-effectiveness.util';
import { ScenarioEffectivenessAnalyticsService } from '../scenario-effectiveness-analytics.service';

const cut = (
  userId: number,
  sessionIds: string[],
  levels: Record<string, number> = { verbal: 3 },
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: 'never served',
  tenantId: 'ally',
  cut: 1,
  closedAt: new Date('2026-07-01T00:00:00.000Z'),
  score: 3,
  unhelpful: false,
  levels,
  verdicts: [],
  sessionIds,
});

const make = () => {
  const cutsRepository = {
    getAllLearnerCuts: jest.fn().mockResolvedValue([]),
    getSessionScenarios: jest.fn().mockResolvedValue(new Map()),
  };
  const repository = {
    getScenarioMeta: jest.fn().mockResolvedValue([]),
    getScenarioTags: jest.fn().mockResolvedValue([]),
    getRepeatGroups: jest.fn().mockResolvedValue([]),
  };
  const calibrationRepository = {
    getScoringConfigChangedAt: jest.fn().mockResolvedValue([]),
  };
  const service = new ScenarioEffectivenessAnalyticsService(
    repository as unknown as ScenarioEffectivenessAnalyticsRepository,
    cutsRepository as unknown as FoundationalSkillsAnalyticsRepository,
    calibrationRepository as unknown as ScenarioCalibrationAnalyticsRepository,
  );
  return { service, repository, cutsRepository, calibrationRepository };
};

describe('ScenarioEffectivenessAnalyticsService.getOpportunityCoverage', () => {
  it('reads rubric-pinned cuts, resolves every session once, and asks only for single-scenario scenarios', async () => {
    const { service, repository, cutsRepository } = make();
    cutsRepository.getAllLearnerCuts.mockResolvedValue([
      cut(1, ['a', 'b']),
      cut(2, ['a']),
      cut(3, ['c', 'd']), // crosses scenarios 2 and 3
    ]);
    cutsRepository.getSessionScenarios.mockResolvedValue(
      new Map([
        ['a', { scenarioId: 1, scenarioTitle: 'One' }],
        ['b', { scenarioId: 1, scenarioTitle: 'One' }],
        ['c', { scenarioId: 2, scenarioTitle: 'Two' }],
        ['d', { scenarioId: 3, scenarioTitle: 'Three' }],
      ]),
    );

    const res = await service.getOpportunityCoverage({ tenantId: ' ally ' });

    expect(cutsRepository.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'ally',
    );
    expect(cutsRepository.getSessionScenarios).toHaveBeenCalledWith([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(repository.getScenarioMeta).toHaveBeenCalledWith([1], 'ally');
    expect(repository.getScenarioTags).toHaveBeenCalledWith([1]);

    expect(res.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(res.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(res.skills.map((s) => s.skill)).toEqual(
      FHS_RUBRIC.map((s) => s.key),
    );
    expect(res.skills).toHaveLength(14);
    expect(res.scoredCuts).toBe(3);
    expect(res.singleScenarioCuts).toBe(2);
    expect(res.belowFloor).toEqual([
      { scenarioId: 1, title: 'Untitled scenario', cuts: 2 },
    ]);
    expect(res.thresholds).toEqual({ maxOpportunityPct: 30, minCuts: 20 });
    expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
    expect(res.provenance.derivation).toContain('R1');
    expect(res.provenance.note).toContain('self-harm cue');
    // A population view: no learner names anywhere in the payload.
    expect(JSON.stringify(res)).not.toContain('never served');
  });

  it('is empty, not an error, with no cuts', async () => {
    const { service, repository } = make();
    const res = await service.getOpportunityCoverage();
    expect(res.scenarios).toEqual([]);
    expect(res.tagGaps).toEqual([]);
    expect(res.singleScenarioShare).toBeNull();
    expect(res.scoping.tenantId).toBeNull();
    expect(repository.getScenarioMeta).toHaveBeenCalledWith([], undefined);
  });
});

describe('ScenarioEffectivenessAnalyticsService.getRepeatImprovement', () => {
  const group = (userId: number, scenarioId: number): RepeatGroupRow => ({
    userId,
    scenarioId,
    title: `S${scenarioId}`,
    versionId: 'v1',
    versionNumber: 1,
    plays: 2,
    firstScore: 10,
    firstAt: new Date('2026-07-01T00:00:00.000Z'),
    latestScore: 20,
    latestAt: new Date('2026-07-03T00:00:00.000Z'),
  });

  it('passes the org through and selects the requested scenario', async () => {
    const { service, repository } = make();
    repository.getRepeatGroups.mockResolvedValue([
      group(1, 4),
      group(2, 4),
      group(1, 9),
    ]);
    const res = await service.getRepeatImprovement({
      scenarioId: 9,
      tenantId: 'ally',
    });

    expect(repository.getRepeatGroups).toHaveBeenCalledWith('ally');
    expect(res.selected).toMatchObject({
      scenarioId: 9,
      pairs: 1,
      learners: null,
    });
    expect(res.picker.map((p) => p.scenarioId)).toEqual([4, 9]);
    expect(res.thresholds).toEqual({ minSpanHours: 24, pickerSize: 10 });
    expect(res.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(res.provenance.derivation).toContain('R2');
    expect(res.provenance.note).toContain('one scenario version');
    expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });

  it('counts, per version, the pairs that straddle the last scoring-config edit', async () => {
    const { service, repository, calibrationRepository } = make();
    repository.getRepeatGroups.mockResolvedValue([
      group(1, 4), // 07-01 → 07-03: straddles a 07-02 edit
      {
        ...group(2, 4),
        firstAt: new Date('2026-07-02T12:00:00.000Z'),
        latestAt: new Date('2026-07-04T00:00:00.000Z'),
      }, // wholly after
      group(1, 9),
    ]);
    calibrationRepository.getScoringConfigChangedAt.mockResolvedValue([
      { scenarioId: 4, changedAt: new Date('2026-07-02T00:00:00.000Z') },
      { scenarioId: 9, changedAt: null },
    ]);
    const res = await service.getRepeatImprovement({});

    expect(
      calibrationRepository.getScoringConfigChangedAt,
    ).toHaveBeenCalledWith(expect.arrayContaining([4, 9]));
    const s4 = res.scenarios.find((r) => r.scenarioId === 4);
    const s9 = res.scenarios.find((r) => r.scenarioId === 9);
    expect(s4).toMatchObject({
      pairs: 2,
      pairsSpanningScoringChange: 1,
      scoringChangedAt: '2026-07-02T00:00:00.000Z',
    });
    expect(s9).toMatchObject({
      pairsSpanningScoringChange: 0,
      scoringChangedAt: null,
    });
    expect(res.provenance.note).toContain('does not pin the scoring config');
  });

  it('defaults the selection to the scenario with the most pairs', async () => {
    const { service, repository } = make();
    repository.getRepeatGroups.mockResolvedValue([
      group(1, 4),
      group(2, 4),
      group(1, 9),
    ]);
    const res = await service.getRepeatImprovement();
    expect(repository.getRepeatGroups).toHaveBeenCalledWith(undefined);
    expect(res.selected?.scenarioId).toBe(4);
  });
});
