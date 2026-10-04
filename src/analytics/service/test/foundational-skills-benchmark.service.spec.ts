import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FHS_BENCHMARK_MIN_CUTS_BETWEEN,
  FHS_BENCHMARK_MIN_LEARNER_CHARS,
} from 'src/foundational-skills/constants/fhs-benchmark.constants';
import { BenchmarkSessionRow } from '../../repository/foundational-skills-benchmark.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  FoundationalSkillsBenchmarkAnalyticsService,
  pairBenchmarkSessions,
} from '../foundational-skills-benchmark.service';

const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n));

const session = (
  userId: number,
  scenarioId: number,
  endedDay: number,
  cutsBefore: number,
  composite: number,
  levels: Record<string, number> = { verbal: Math.round(composite) },
): BenchmarkSessionRow => ({
  sessionId: `u${userId}-s${scenarioId}-d${endedDay}`,
  userId,
  name: `Learner ${userId}`,
  tenantId: 'tenant-a',
  scenarioId,
  endedAt: day(endedDay),
  cutsBefore,
  composite,
  levels,
});

describe('pairBenchmarkSessions', () => {
  const MIN = FHS_BENCHMARK_MIN_CUTS_BETWEEN;

  it('pairs FIRST with LATEST of the same scenario, ignoring sessions in between', () => {
    const pairs = pairBenchmarkSessions(
      [
        session(1, 10, 0, 0, 2.0),
        session(1, 10, 5, 2, 3.5),
        session(1, 10, 9, 6, 2.5),
      ],
      MIN,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].first.sessionId).toBe('u1-s10-d0');
    expect(pairs[0].latest.sessionId).toBe('u1-s10-d9');
    expect(pairs[0].cutsBetween).toBe(6);
  });

  it('orders by when sessions ended, not by input order', () => {
    const pairs = pairBenchmarkSessions(
      [session(1, 10, 9, 6, 2.5), session(1, 10, 0, 0, 2.0)],
      MIN,
    );
    expect(pairs[0].first.sessionId).toBe('u1-s10-d0');
  });

  it(`needs at least ${FHS_BENCHMARK_MIN_CUTS_BETWEEN} cuts of practice between first and latest`, () => {
    expect(
      pairBenchmarkSessions(
        [session(1, 10, 0, 1, 2), session(1, 10, 9, 1 + MIN - 1, 3)],
        MIN,
      ),
    ).toEqual([]);
    expect(
      pairBenchmarkSessions(
        [session(1, 10, 0, 1, 2), session(1, 10, 9, 1 + MIN, 3)],
        MIN,
      ),
    ).toHaveLength(1);
  });

  it('never pairs a learner across two different scenarios', () => {
    expect(
      pairBenchmarkSessions(
        [session(1, 10, 0, 0, 2), session(1, 11, 9, 9, 3)],
        MIN,
      ),
    ).toEqual([]);
  });

  it('drops a learner with a single session', () => {
    expect(pairBenchmarkSessions([session(1, 10, 0, 0, 2)], MIN)).toEqual([]);
  });

  it('counts a learner once, on the scenario with the most practice between', () => {
    const pairs = pairBenchmarkSessions(
      [
        session(1, 10, 0, 0, 2.0),
        session(1, 10, 20, 4, 2.5),
        session(1, 11, 1, 0, 1.5),
        session(1, 11, 15, 7, 3.0),
      ],
      MIN,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].scenarioId).toBe(11);
    expect(pairs[0].cutsBetween).toBe(7);
  });

  it('breaks a tie in practice by the more recent retake, then the lower scenario id', () => {
    const recent = pairBenchmarkSessions(
      [
        session(1, 10, 0, 0, 2),
        session(1, 10, 10, 5, 3),
        session(1, 11, 0, 0, 2),
        session(1, 11, 12, 5, 3),
      ],
      MIN,
    );
    expect(recent[0].scenarioId).toBe(11);

    const lowerId = pairBenchmarkSessions(
      [
        session(1, 11, 0, 0, 2),
        session(1, 11, 10, 5, 3),
        session(1, 10, 0, 0, 2),
        session(1, 10, 10, 5, 3),
      ],
      MIN,
    );
    expect(lowerId[0].scenarioId).toBe(10);
  });

  it('lists the most recent retake first', () => {
    const pairs = pairBenchmarkSessions(
      [
        session(1, 10, 0, 0, 2),
        session(1, 10, 10, 5, 3),
        session(2, 10, 0, 0, 2),
        session(2, 10, 30, 5, 3),
      ],
      MIN,
    );
    expect(pairs.map((p) => p.userId)).toEqual([2, 1]);
  });
});

describe('FoundationalSkillsBenchmarkAnalyticsService', () => {
  const coverage = {
    sessionsScored: 0,
    sessionsSkipped: 0,
    sessionsFailed: 0,
    sessionsPending: 0,
  };

  const build = (
    rows: BenchmarkSessionRow[],
    scenarios = [
      {
        id: 10,
        title: 'Benchmark: sleepless nights',
        sessionsScored: rows.length,
      },
    ],
    cov = coverage,
  ) => {
    const repository = {
      getScenarios: jest.fn().mockResolvedValue(scenarios),
      getCoverage: jest.fn().mockResolvedValue(cov),
      getScoredSessions: jest.fn().mockResolvedValue(rows),
    };
    return {
      repository,
      service: new FoundationalSkillsBenchmarkAnalyticsService(
        repository as any,
      ),
    };
  };

  /** `n` paired learners on scenario 10, each moving by `delta(i)`. */
  const pairedRows = (
    n: number,
    delta: (i: number) => number,
    levels?: (i: number, end: 'first' | 'latest') => Record<string, number>,
  ) =>
    Array.from({ length: n }, (_, i) => [
      session(i + 1, 10, 0, 0, 2, levels ? levels(i, 'first') : { verbal: 2 }),
      session(
        i + 1,
        10,
        30,
        5,
        2 + delta(i),
        levels ? levels(i, 'latest') : { verbal: 2 + Math.sign(delta(i)) },
      ),
    ]).flat();

  it('reads the current rubric version only', async () => {
    const { repository, service } = build([]);
    await service.getBenchmark();
    expect(repository.getScenarios).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
    expect(repository.getCoverage).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
    expect(repository.getScoredSessions).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
  });

  it('narrows every read to the org filter when one is given', async () => {
    const { repository, service } = build([]);
    await service.getBenchmark({ tenantId: 'tenant-a' });
    for (const read of [
      repository.getScenarios,
      repository.getCoverage,
      repository.getScoredSessions,
    ]) {
      expect(read).toHaveBeenCalledWith(FHS_RUBRIC_VERSION, 'tenant-a');
    }
  });

  it('returns the explanatory empty shape, not an error, when nothing is flagged', async () => {
    const { service } = build([], []);
    const res = await service.getBenchmark();
    expect(res.scenarios).toEqual([]);
    expect(res.coverage).toEqual({
      sessionsScored: 0,
      sessionsSkipped: 0,
      sessionsFailed: 0,
      sessionsPending: 0,
      learnersWithOne: 0,
      learnersPaired: 0,
    });
    expect(res.summary).toEqual({
      learners: 0,
      firstAvg: null,
      latestAvg: null,
      change: null,
      changeCi: null,
      up: 0,
      down: 0,
      tied: 0,
      signP: null,
      detectable: false,
    });
    expect(res.skills).toHaveLength(FHS_RUBRIC.length);
    expect(res.skills.every((s) => s.pairedLearners === 0)).toBe(true);
    expect(res.learners).toEqual([]);
    expect(res.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(res.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(res.scoreDomain).toEqual([1, 4]);
    expect(res.minLearnerChars).toBe(FHS_BENCHMARK_MIN_LEARNER_CHARS);
    expect(res.minCutsBetween).toBe(FHS_BENCHMARK_MIN_CUTS_BETWEEN);
  });

  it('withholds averages, interval and test below the floor but keeps the counts', async () => {
    const n = MIN_SCORE_SAMPLE_SIZE - 1;
    const { service } = build(
      pairedRows(n, (i) => (i < 12 ? 0.5 : i < 15 ? -0.25 : 0)),
    );
    const { summary, coverage: cov } = await service.getBenchmark();
    expect(summary.learners).toBe(n);
    expect(summary.firstAvg).toBeNull();
    expect(summary.latestAvg).toBeNull();
    expect(summary.change).toBeNull();
    expect(summary.changeCi).toBeNull();
    expect(summary.signP).toBeNull();
    expect(summary.detectable).toBe(false);
    expect([summary.up, summary.down, summary.tied]).toEqual([12, 3, 4]);
    expect(cov.learnersPaired).toBe(n);
    expect(cov.learnersWithOne).toBe(n);
  });

  it('reports the paired change with its interval and sign test at the floor', async () => {
    const n = MIN_SCORE_SAMPLE_SIZE;
    // 16 up by 0.5, 4 down by 0.25: mean change = (8 - 1) / 20 = 0.35.
    const { service } = build(pairedRows(n, (i) => (i < 16 ? 0.5 : -0.25)));
    const { summary } = await service.getBenchmark();
    expect(summary.learners).toBe(n);
    expect(summary.firstAvg).toBe(2);
    expect(summary.latestAvg).toBe(2.35);
    expect(summary.change).toBe(0.35);
    expect(summary.up).toBe(16);
    expect(summary.down).toBe(4);
    expect(summary.tied).toBe(0);
    expect(summary.changeCi).not.toBeNull();
    const [lo, hi] = summary.changeCi!;
    expect(lo).toBeLessThanOrEqual(0.35);
    expect(hi).toBeGreaterThanOrEqual(0.35);
    expect(lo).toBeGreaterThan(0);
    expect(summary.detectable).toBe(true);
    // Exact two-sided sign test, 16 vs 4: p ≈ 0.0118.
    expect(summary.signP).toBeCloseTo(0.0118, 3);
  });

  it('pairs a skill only where it was assessable in BOTH sessions', async () => {
    const n = MIN_SCORE_SAMPLE_SIZE + 2;
    const { service } = build(
      pairedRows(
        n,
        () => 0.5,
        (i, end): Record<string, number> =>
          end === 'first'
            ? { verbal: 2, empathy: 2 }
            : // Two learners had no empathy opportunity in their retake: they
              // drop out of the empathy pair rather than counting as a fall.
              i < 2
              ? { verbal: 3 }
              : { verbal: 3, empathy: 3 },
      ),
    );
    const { skills } = await service.getBenchmark();
    const verbal = skills.find((s) => s.skill === 'verbal')!;
    const empathy = skills.find((s) => s.skill === 'empathy')!;
    const harm = skills.find((s) => s.skill === 'harm')!;
    expect(verbal.pairedLearners).toBe(n);
    expect(verbal.change).toBe(1);
    expect(empathy.pairedLearners).toBe(n - 2);
    expect(empathy.firstAvg).toBe(2);
    expect(empathy.latestAvg).toBe(3);
    expect(empathy.change).toBe(1);
    expect(harm.pairedLearners).toBe(0);
    expect(harm.firstAvg).toBeNull();
    expect(verbal.name).toBe(FHS_RUBRIC.find((s) => s.key === 'verbal')!.name);
  });

  it('lists each paired learner with both ends, string scenario ids and rounded change', async () => {
    const { service } = build(
      [
        session(7, 10, 0, 0, 2.33),
        session(7, 10, 30, 4, 2.67),
        session(8, 10, 0, 0, 2), // one session only: counted, not paired
      ],
      [{ id: 10, title: 'Benchmark', sessionsScored: 3 }],
      { ...coverage, sessionsScored: 3, sessionsPending: 2 },
    );
    const res = await service.getBenchmark();
    expect(res.scenarios).toEqual([
      { id: '10', title: 'Benchmark', sessionsScored: 3 },
    ]);
    expect(res.coverage).toMatchObject({
      sessionsScored: 3,
      sessionsPending: 2,
      learnersWithOne: 2,
      learnersPaired: 1,
    });
    expect(res.learners).toEqual([
      {
        id: 7,
        name: 'Learner 7',
        tenantId: 'tenant-a',
        scenarioId: '10',
        first: {
          sessionId: 'u7-s10-d0',
          endedAt: day(0).toISOString(),
          cutsBefore: 0,
          composite: 2.33,
        },
        latest: {
          sessionId: 'u7-s10-d30',
          endedAt: day(30).toISOString(),
          cutsBefore: 4,
          composite: 2.67,
        },
        change: 0.34,
      },
    ]);
  });
});
