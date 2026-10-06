import { DataSource } from 'typeorm';

import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { EffectivenessAnalyticsRepository } from '../../repository/effectiveness-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../../repository/foundational-skills-analytics.repository';
import { EffectivenessAnalyticsService } from '../effectiveness-analytics.service';
import { FoundationalSkillsAnalyticsService } from '../foundational-skills-analytics.service';

/**
 * The service over REAL repositories and a mocked `DataSource`, so the SQL
 * each endpoint actually sends (rubric pin, test-org exclusion, bound org id)
 * is asserted alongside what it returns — and the segments' overall row is
 * checked against the Helping skills service itself, not a copy of its rules.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

const wobble = (u: number, k: number): number => {
  const x = Math.sin(u * 31.7 + k * 7.3) * 10000;
  return x - Math.floor(x) - 0.5;
};

/** 30 learners, 2–9 scored cuts each, as `getAllLearnerCuts` SQL rows. */
const CUT_ROWS = Array.from({ length: 30 }, (_, i) => i + 1).flatMap((u) =>
  Array.from({ length: 2 + (u % 8) }, (_, j) => j + 1).map((k) => ({
    user_id: u,
    name: `Learner ${u}`,
    tenant_id: u % 2 ? 'acme' : 'uuid-a',
    cut: k,
    closed_at: new Date(T0 + (u * 50 + k) * DAY).toISOString(),
    score: Math.min(
      4,
      Math.max(1, 2.4 + 0.06 * k * ((u % 3) - 0.5) + 0.7 * wobble(u, k)),
    ),
    unhelpful: false,
    levels: { verbal: 3 },
    verdicts: [],
    session_ids: [
      `00000000-0000-4000-8000-${String(u * 100 + k).padStart(12, '0')}`,
    ],
  })),
);

const build = () => {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('foundational_skill_cuts')) return CUT_ROWS;
    if (sql.includes('user_groups')) {
      return Array.from({ length: 34 }, (_, i) => ({
        user_id: i + 1,
        countable_sessions: i < 28 ? 3 : i < 31 ? 1 : 0,
      }));
    }
    if (sql.includes(`metadata->>'workerType'`)) {
      return [{ user_id: 1, worker_type: 'LAY' }];
    }
    if (sql.includes('track_enrollments')) return [];
    if (sql.includes('t.code AS code')) {
      return [{ id: 'uuid-a', code: 'acme' }];
    }
    return [];
  });
  const dataSource = { query } as unknown as DataSource;
  const fhsRepository = new FoundationalSkillsAnalyticsRepository(dataSource);
  const service = new EffectivenessAnalyticsService(
    new EffectivenessAnalyticsRepository(dataSource),
    fhsRepository,
  );
  const helpingSkills = new FoundationalSkillsAnalyticsService(fhsRepository);
  const sqlOf = () => query.mock.calls.map(([sql]) => String(sql));
  const paramsOf = () =>
    query.mock.calls.map((call) => ((call as unknown[])[1] ?? []) as unknown[]);
  return { query, service, helpingSkills, sqlOf, paramsOf };
};

const cutCall = (sqls: string[], params: unknown[][]) => {
  const i = sqls.findIndex((s) => s.includes('foundational_skill_cuts'));
  return { sql: sqls[i], params: params[i] };
};

describe('EffectivenessAnalyticsService.getFunnel', () => {
  it('pins the rubric and scopes both halves of the funnel to the org as a bound parameter', async () => {
    const { service, sqlOf, paramsOf } = build();
    const out = await service.getFunnel({ tenantId: TENANT });

    const cuts = cutCall(sqlOf(), paramsOf());
    expect(cuts.params).toEqual([FHS_RUBRIC_VERSION, TENANT]);
    expect(cuts.sql).toContain('a."rubricVersion" = $1');
    expect(cuts.sql).toContain(`a.status = 'SCORED'`);
    expect(cuts.sql).toContain('a."compositeScore" IS NOT NULL');
    expect(cuts.sql).toContain('"isTestOrganization" = true');
    for (const sql of sqlOf()) expect(sql).not.toContain(TENANT);

    expect(out.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(out.minSampleSize).toBe(20);
    expect(out.minCohortSize).toBe(5);
    expect(out.scoping.tenantId).toBe(TENANT);
    expect(out.provenance.derivation).toContain('R1');
    expect(out.provenance.note).toContain('outside the funnel');
    expect(typeof out.computedAt).toBe('string');
  });

  it('returns a non-widening funnel whose last stage is a subset of AAQ-181’s improving', async () => {
    const { service, helpingSkills } = build();
    const out = await service.getFunnel({});
    const progress = await helpingSkills.getProgress({});

    const reached = out.stages.map((s) => s.reached);
    expect(reached[0]).toBe(34);
    for (let i = 1; i < reached.length; i += 1) {
      expect(reached[i]).toBeLessThanOrEqual(reached[i - 1]);
    }
    // Learners 29–30 have cuts but a single session: clamped out.
    expect(out.clamp).toEqual({
      measuredLearners: 30,
      outsideFunnel: 2,
      notInPopulation: 0,
      fewerThanTwoSessions: 2,
    });
    expect(out.helpingSkillsTrend).toEqual(progress.trend);
    expect(out.stages[6].reached).toBe(out.trend.improving);
    expect(out.trend.improving).toBeLessThanOrEqual(progress.trend.improving);
    expect(out.scoping.tenantId).toBeNull();
  });
});

describe('EffectivenessAnalyticsService.getProgressSegments', () => {
  it.each([
    [{}, 'language'],
    [{ baselineFrom: 2 as const }, 'workerType'],
    [{ cuts: 3 }, 'orgSize'],
    [{ tenantId: TENANT }, 'course'],
    [{}, 'difficultyTransition'],
  ] as const)(
    'overall equals Helping skills summary.composite (AAQ-168) for %j by %s',
    async (q, dimension) => {
      const { service, helpingSkills } = build();
      const out = await service.getProgressSegments({ ...q, dimension });
      const progress = await helpingSkills.getProgress(q);
      const c = progress.summary.composite;

      expect(out.cuts).toBe(progress.cuts);
      expect(out.windows).toEqual(progress.windows);
      expect(out.panelLearners).toBe(progress.summary.cohortLearners);
      expect(out.overall).toEqual({
        learners: c.n,
        earlyComposite: progress.summary.earlyComposite,
        lateComposite: progress.summary.lateComposite,
        change: c.change,
        ci: c.ci,
        up: c.up,
        down: c.down,
        tied: c.tied,
        signP: c.signP,
        detectable: c.detectable,
      });
      const total =
        out.segments.reduce((a, s) => a + s.learners, 0) +
        out.withheld.reduce((a, s) => a + s.learners, 0);
      expect(total).toBe(out.panelLearners);
      expect(out.dimension).toBe(dimension);
      // The fixture clears the floor, so the comparison is of real numbers.
      expect(out.overall.change).not.toBeNull();
      expect(out.overall.ci).not.toBeNull();
    },
  );

  it('runs only the lookup the dimension needs', async () => {
    const cases: [string, string][] = [
      ['language', 'scenario_sessions ss'],
      ['difficulty', 'scenario_sessions ss'],
      ['workerType', `metadata->>'workerType'`],
      ['course', 'track_enrollments'],
      ['orgSize', 't.code AS code'],
    ];
    const lookups = cases.map(([, marker]) => marker);
    for (const [dimension, marker] of cases) {
      const { service, sqlOf } = build();
      await service.getProgressSegments({ dimension: dimension as never });
      const sent = sqlOf();
      expect(sent.some((s) => s.includes(marker))).toBe(true);
      for (const other of lookups.filter((m) => m !== marker)) {
        expect(sent.some((s) => s.includes(other))).toBe(false);
      }
    }
  });

  it('counts an org once under its code and its uuid', async () => {
    const { service } = build();
    const out = await service.getProgressSegments({ dimension: 'orgSize' });
    // Every measured learner practised in the one org (half its cuts say
    // 'acme', half 'uuid-a'): 30 learners → the 10–49 band, never 1–9.
    expect([...out.segments, ...out.withheld].map((s) => s.key)).toEqual([
      '10-49',
    ]);
  });

  it('defaults to language and echoes every dimension, floors and provenance', async () => {
    const { service } = build();
    const out = await service.getProgressSegments({});
    expect(out.dimension).toBe('language');
    expect(out.dimensions).toEqual([
      'language',
      'workerType',
      'orgSize',
      'course',
      'difficulty',
      'difficultyTransition',
    ]);
    expect(out.minSampleSize).toBe(20);
    expect(out.scoreDomain).toEqual([1, 4]);
    expect(out.provenance.note).toContain('hypothesis');
    expect(out.scoping).toEqual({
      tenantId: null,
      note: 'Every non-test org.',
    });
  });
});
