import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsTransferAnalyticsService } from '../foundational-skills-transfer.service';
import { TransferCutRow } from '../../util/foundational-skills-transfer.util';

const cut = (
  userId: number,
  k: number,
  score: number | null,
  scenarioId: number,
): TransferCutRow => ({
  userId,
  cut: k,
  score,
  sessions: [
    { sessionId: `u${userId}-c${k}`, scenarioId, difficulty: 'MEDIUM' },
  ],
});

describe('FoundationalSkillsTransferAnalyticsService', () => {
  const build = (rows: TransferCutRow[]) => {
    const repository = {
      getCutScenarios: jest.fn().mockResolvedValue(rows),
    };
    return {
      repository,
      service: new FoundationalSkillsTransferAnalyticsService(
        repository as any,
      ),
    };
  };

  it('reads the current rubric, platform-wide by default, and echoes the scope', async () => {
    const { repository, service } = build([]);
    const res = await service.getTransfer();
    expect(repository.getCutScenarios).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
    expect(res).toMatchObject({
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: 20,
      minSingleScenarioCuts: 3,
      scoreDomain: [1, 4],
      learnersWithPair: 0,
      learners: null,
      scoping: { tenantId: null, unscopedSections: [] },
    });
    expect(res.comparison.change).toBeNull();
    expect(() => new Date(res.computedAt).toISOString()).not.toThrow();
  });

  it('passes a trimmed org filter through', async () => {
    const { repository, service } = build([]);
    const res = await service.getTransfer({ tenantId: ' tenant-a ' });
    expect(repository.getCutScenarios).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'tenant-a',
    );
    expect(res.scoping.tenantId).toBe('tenant-a');
  });

  it('serves the floored comparison and the slope rows once 20 learners pair', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      cut(i + 1, 1, 2.2, 1),
      cut(i + 1, 2, 2.2, 1),
      cut(i + 1, 3, 2.0, 2),
    ]).flat();
    const res = await build(rows).service.getTransfer();
    expect(res.comparison).toMatchObject({
      n: 20,
      beforeAvg: 2.2,
      afterAvg: 2,
      change: -0.2,
      down: 20,
    });
    expect(res.learners).toHaveLength(20);
    expect(res.learners![0]).toEqual({
      learnerId: 1,
      before: 2.2,
      after: 2,
      change: -0.2,
      pairs: 1,
    });
    expect(res.singleScenarioSharePct).toBe(100);
  });

  it('names the ruler and the difficulty caveat on the card', async () => {
    const res = await build([]).service.getTransfer();
    expect(res.provenance.derivation).toContain('R1');
    expect(res.provenance.derivation).toContain(FHS_RUBRIC_VERSION);
    expect(res.provenance.note).toContain('AAQ-207');
    expect(res.provenance.note).toContain('harder');
    expect(res.provenance.note).not.toMatch(/\bcaused\b/);
  });
});
