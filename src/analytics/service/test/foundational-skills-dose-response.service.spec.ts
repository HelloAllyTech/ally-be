import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsAnalyticsService } from '../foundational-skills-analytics.service';
import { DOSE_RESPONSE_MIN_LEARNERS } from '../../util/dose-response.util';

/**
 * The dose–response keys on GET foundational-skills/progress (AAQ-217):
 * served only from the population gate, with practice minutes read only then.
 */
describe('FoundationalSkillsAnalyticsService.getProgress — dose–response', () => {
  /**
   * `learners` learners with `cuts` scored cuts each (or 4..7 by id when
   * `cuts` is 'varied'), rising for odd ids.
   */
  const rows = (learners: number, cuts: number | 'varied') =>
    Array.from({ length: learners }, (_, i) =>
      Array.from(
        { length: cuts === 'varied' ? 4 + (i % 4) : cuts },
        (_, k) => ({
          userId: i + 1,
          name: `Learner ${i + 1}`,
          tenantId: 't-1',
          cut: k + 1,
          closedAt: new Date('2026-09-01T00:00:00Z'),
          score: 2 + ((i % 2 ? 0.1 : -0.05) * k + ((i * 7 + k * 3) % 5) / 20),
          unhelpful: false,
          levels: { verbal: 2 },
          verdicts: [],
          sessionIds: [`s-${i + 1}-${k + 1}`],
        }),
      ),
    ).flat();

  const build = (cutRows: any[], minutes = new Map<number, number>()) => {
    const repository = {
      getAllLearnerCuts: jest.fn().mockResolvedValue(cutRows),
      getPracticeMinutesByLearner: jest.fn().mockResolvedValue(minutes),
    };
    return {
      repository,
      service: new FoundationalSkillsAnalyticsService(repository as any),
    };
  };

  it('below the gate serves the count only and never reads minutes', async () => {
    const { repository, service } = build(rows(12, 4));
    const res = await service.getProgress({});

    expect(repository.getPracticeMinutesByLearner).not.toHaveBeenCalled();
    expect(res.learnersScatter).toBeNull();
    expect(res.doseResponse).toMatchObject({
      minLearners: DOSE_RESPONSE_MIN_LEARNERS,
      classifiedLearners: 12,
      measurable: false,
      learnersWithMinutes: null,
      fit: null,
      minutesFit: null,
    });
    expect(res.doseResponse.provenance.note).toContain('association');
  });

  it('does not count learners too early to classify', async () => {
    // 50 learners, but only 3 cuts each: nobody is classifiable.
    const { repository, service } = build(rows(50, 3));
    const res = await service.getProgress({});
    expect(res.doseResponse.classifiedLearners).toBe(0);
    expect(repository.getPracticeMinutesByLearner).not.toHaveBeenCalled();
  });

  it('from the gate reads minutes for exactly the plotted learners, in the same org scope', async () => {
    const minutes = new Map(
      Array.from({ length: 40 }, (_, i) => [i + 1, 60 + i] as [number, number]),
    );
    const { repository, service } = build(rows(42, 'varied'), minutes);
    const res = await service.getProgress({ tenantId: 'tenant-a' });

    expect(repository.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'tenant-a',
    );
    expect(repository.getPracticeMinutesByLearner).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      Array.from({ length: 42 }, (_, i) => i + 1),
      'tenant-a',
    );
    expect(res.doseResponse).toMatchObject({
      classifiedLearners: 42,
      measurable: true,
      learnersWithMinutes: 40,
    });
    expect(res.learnersScatter).toHaveLength(42);
    expect(res.doseResponse.fit).toMatchObject({ x: 'cuts', n: 42 });
    expect(res.doseResponse.minutesFit).toMatchObject({
      x: 'practiceHours',
      n: 40,
    });
    const p = res.learnersScatter!.find((l) => l.learnerId === 41)!;
    expect(p.practiceMinutes).toBeNull();
    expect(p.cuts).toBe(4 + (40 % 4));
  });

  it('serves no cuts fit when every learner has the same number of cuts', async () => {
    const { service } = build(rows(42, 5));
    const res = await service.getProgress({});
    expect(res.doseResponse.measurable).toBe(true);
    expect(res.doseResponse.fit).toBeNull();
  });

  it('keeps every existing key alongside the new ones', async () => {
    const { service } = build(rows(42, 5));
    const res = await service.getProgress({});
    for (const key of [
      'summary',
      'byCut',
      'skills',
      'behaviours',
      'trend',
      'learners',
      'provenance',
    ]) {
      expect(res).toHaveProperty(key);
    }
    expect(res.trend.improving + res.trend.steady + res.trend.declining).toBe(
      res.doseResponse.classifiedLearners,
    );
  });
});
