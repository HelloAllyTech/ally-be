import { DataSource } from 'typeorm';

import { MeasurementConvergenceAnalyticsRepository } from '../measurement-convergence-analytics.repository';
import { versionKey } from '../../util/measurement-convergence.util';

/**
 * EFF-80's session reads: session ids bound as one uuid[] parameter, test orgs
 * excluded, and the session score counted only when it is a countable,
 * resolved score — on the cut's sessions and on the z yardstick alike.
 */
const TEST_ORG = '"isTestOrganization" = true';
const COUNTABLE = [
  "s.status = 'ENDED'",
  `s."eventStatus" = 'COMPLETED'`,
  `s."roomId" NOT LIKE 'preview-%'`,
  `s."roomId" NOT LIKE 'seed-room-%'`,
  's.score IS NOT NULL',
  // The unresolved 0: a zero with no detected event.
  'NOT (s.score = 0 AND NOT EXISTS (SELECT 1 FROM scenario_session_events rse',
];

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repo = new MeasurementConvergenceAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repo };
};

const IDS = [
  '11111111-0000-4000-8000-000000000001',
  '11111111-0000-4000-8000-000000000002',
];

describe('MeasurementConvergenceAnalyticsRepository.getSessionSignals', () => {
  it('binds the ids and the instruction categories; reads every ruler’s source', async () => {
    const { query, repo } = build();
    await repo.getSessionSignals(IDS);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([IDS, 'SHOULD_DO', 'SHOULD_NOT_DO']);
    expect(sql).toContain('unnest($1::uuid[])');
    expect(sql).toContain('bi.category = $2');
    expect(sql).toContain('bi.category = $3');
    // varchar detection row → cast the uuid side.
    expect(sql).toContain('bi.id::text = sb."scenarioBehaviorInstructionId"');
    expect(sql).toContain(`d.summary->'feedback'->'skillCoverage'`);
    expect(sql).toContain('scenario_session_feedbacks f');
    for (const p of COUNTABLE) expect(sql).toContain(p);
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('(s."tenant_id")::text');
    for (const id of IDS) expect(sql).not.toContain(id);
  });

  it('maps rows defensively, keyed by session id', async () => {
    const { repo } = build([
      {
        session_id: IDS[0],
        scenario_id: '7',
        version_id: 'v-1',
        score: '12.5',
        score_eligible: true,
        do_hits: '3',
        dont_hits: 1,
        skill_coverage: [{ category: 'x', percentage: 50 }],
        rating: '4.5',
      },
      {
        session_id: IDS[1],
        scenario_id: null,
        version_id: null,
        score: null,
        score_eligible: null,
        do_hits: null,
        dont_hits: null,
        skill_coverage: null,
        rating: null,
      },
    ]);
    const out = await repo.getSessionSignals(IDS);
    expect(out.get(IDS[0])).toEqual({
      scenarioId: 7,
      versionId: 'v-1',
      score: 12.5,
      scoreEligible: true,
      doHits: 3,
      dontHits: 1,
      skillCoverage: [{ category: 'x', percentage: 50 }],
      rating: 4.5,
    });
    expect(out.get(IDS[1])).toEqual({
      scenarioId: null,
      versionId: null,
      score: null,
      scoreEligible: false,
      doHits: 0,
      dontHits: 0,
      skillCoverage: null,
      rating: null,
    });
  });

  it('asks nothing for no sessions', async () => {
    const { query, repo } = build();
    expect((await repo.getSessionSignals([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('MeasurementConvergenceAnalyticsRepository.getVersionScoreStats', () => {
  it('measures each version over every countable, resolved, non-test session', async () => {
    const { query, repo } = build([
      {
        scenario_id: 7,
        version_id: 'v-1',
        sessions: '12',
        mean: '3.5',
        sd: '1.2',
      },
      { scenario_id: 7, version_id: null, sessions: 3, mean: 1, sd: null },
    ]);
    const out = await repo.getVersionScoreStats(IDS);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([IDS]);
    expect(sql).toContain('v.id = ANY($1::uuid[])');
    // NULL-version sessions are a group of their own, not dropped by `=`.
    expect(sql).toContain('IS NOT DISTINCT FROM s."scenarioVersionId"');
    for (const p of COUNTABLE) expect(sql).toContain(p);
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('STDDEV_SAMP(s.score)');
    expect(out.get(versionKey(7, 'v-1'))).toEqual({
      sessions: 12,
      mean: 3.5,
      sd: 1.2,
    });
    expect(out.get(versionKey(7, null))).toEqual({
      sessions: 3,
      mean: 1,
      sd: null,
    });
  });

  it('asks nothing for no sessions', async () => {
    const { query, repo } = build();
    expect((await repo.getVersionScoreStats([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
