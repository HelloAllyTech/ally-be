import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import { MeasurementConvergenceAnalyticsService } from '../measurement-convergence-analytics.service';
import { MIN_PAIRS_FOR_CONVERGENCE } from '../../util/measurement-convergence.util';

const row = (
  userId: number,
  cut: number,
  sessionIds: string[],
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: null,
  tenantId: 't-1',
  cut,
  closedAt: new Date('2026-09-01T00:00:00Z'),
  score: 2.5,
  unhelpful: false,
  levels: {},
  verdicts: [],
  sessionIds,
});

const setup = (rows: FoundationalSkillsLearnerCutRow[]) => {
  const repository = {
    getSessionSignals: jest.fn().mockResolvedValue(new Map()),
    getVersionScoreStats: jest.fn().mockResolvedValue(new Map()),
  };
  const cuts = { getAllLearnerCuts: jest.fn().mockResolvedValue(rows) };
  const service = new MeasurementConvergenceAnalyticsService(
    repository as any,
    cuts as any,
  );
  return { service, repository, cuts };
};

describe('MeasurementConvergenceAnalyticsService.getConvergence', () => {
  it('reads rubric-pinned cuts in the org scope and looks up each session once', async () => {
    const { service, repository, cuts } = setup([
      row(1, 1, ['a', 'b']),
      row(1, 2, ['b', 'c']),
    ]);
    const out = await service.getConvergence({ tenantId: 'acme' });
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'acme',
    );
    expect(repository.getSessionSignals).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(repository.getVersionScoreStats).toHaveBeenCalledWith([
      'a',
      'b',
      'c',
    ]);
    expect(out.minPairs).toBe(MIN_PAIRS_FOR_CONVERGENCE);
    expect(out.scoping).toEqual({
      tenantId: 'acme',
      unscopedSections: ['sessionScoreReference'],
    });
    // Sessions not found → not single-scenario → nothing compared.
    expect(out.cuts).toEqual({
      total: 2,
      singleScenario: 0,
      singleScenarioPct: 0,
    });
    expect(out.pairs).toHaveLength(10);
    expect(out.caveat).toContain('Agreement is not validity');
    expect(out.provenance.note).toContain(String(MIN_PAIRS_FOR_CONVERGENCE));
  });

  it('is platform-wide with no tenant', async () => {
    const { service, cuts } = setup([]);
    const out = await service.getConvergence({});
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
    expect(out.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    expect(out.strongest).toBeNull();
  });
});
