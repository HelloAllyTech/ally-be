import { DataSource } from 'typeorm';

import { FeedbackUptakeAnalyticsRepository } from '../feedback-uptake-analytics.repository';

/**
 * Every read of the feedback-uptake chart must drop test organisations, pin
 * the rubric and the mapper version, and — when an org is picked — narrow by
 * the row's own tenant with the id as a BOUND parameter, never in the SQL text.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new FeedbackUptakeAnalyticsRepository({
    query,
  } as unknown as DataSource);
  const call = (i = 0) => ({
    sql: String(query.mock.calls[i][0]).replace(/\s+/g, ' '),
    params: query.mock.calls[i][1] as unknown[],
  });
  return { query, repository, call };
};

describe('FeedbackUptakeAnalyticsRepository.getMappedSessions', () => {
  it('reads MAPPED rows of one mapper version, test orgs dropped, no org filter by default', async () => {
    const { repository, call } = build([
      {
        session_id: 's1',
        user_id: '7',
        ended_at: '2026-09-01T10:00:00Z',
        items: [{ index: 0, skill: 'verbal' }],
      },
      {
        session_id: 's2',
        user_id: '7',
        ended_at: '2026-09-02T10:00:00Z',
        items: null,
      },
    ]);
    const rows = await repository.getMappedSessions('v1');
    const { sql, params } = call();

    expect(params).toEqual(['v1']);
    expect(sql).toContain(`l."mapperVersion" = $1`);
    expect(sql).toContain(`l.status = 'MAPPED'`);
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain('(l."tenant_id")::text');
    expect(sql).not.toContain(SCOPE);
    expect(rows).toEqual([
      {
        sessionId: 's1',
        userId: 7,
        endedAt: new Date('2026-09-01T10:00:00Z'),
        items: [{ index: 0, skill: 'verbal' }],
      },
      {
        sessionId: 's2',
        userId: 7,
        endedAt: new Date('2026-09-02T10:00:00Z'),
        items: [],
      },
    ]);
  });

  it('narrows to one org by the session tenant, bound as $2', async () => {
    const { repository, call } = build();
    await repository.getMappedSessions('v1', TENANT);
    const { sql, params } = call();

    expect(params).toEqual(['v1', TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).not.toContain(TENANT);
  });
});

describe('FeedbackUptakeAnalyticsRepository.getScoredCuts', () => {
  it('pins the rubric and SCORED, drops test orgs, and reads only learners with a mapped session', async () => {
    const { repository, call } = build([
      {
        user_id: '7',
        cut_index: '2',
        closed_at: '2026-09-03T10:00:00Z',
        first_ended_at: null,
        levels: { verbal: 2 },
      },
    ]);
    const rows = await repository.getScoredCuts('fhs-v', 'v1');
    const { sql, params } = call();

    expect(params).toEqual(['fhs-v', 'v1']);
    expect(sql).toContain(`a."rubricVersion" = $1`);
    expect(sql).toContain(`a.status = 'SCORED'`);
    expect(sql).toContain(`a."compositeScore" IS NOT NULL`);
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain(`l."mapperVersion" = $2`);
    expect(sql).toContain(
      'LEFT JOIN scenario_sessions fs ON fs.id = c."startSessionId"',
    );
    expect(sql).toContain(
      'ORDER BY c."userId", c."closedSessionEndedAt", c."cutIndex"',
    );
    expect(sql).not.toContain(SCOPE);
    expect(rows).toEqual([
      {
        userId: 7,
        cutIndex: 2,
        closedAt: new Date('2026-09-03T10:00:00Z'),
        firstEndedAt: null,
        levels: { verbal: 2 },
      },
    ]);
  });

  it('narrows to one org by the CUT tenant, bound as $3', async () => {
    const { repository, call } = build();
    await repository.getScoredCuts('fhs-v', 'v1', TENANT);
    const { sql, params } = call();

    expect(params).toEqual(['fhs-v', 'v1', TENANT]);
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).not.toContain(TENANT);
  });
});

describe('FeedbackUptakeAnalyticsRepository.getCoverage', () => {
  it("counts the scheduler's own population and where each session stands", async () => {
    const { repository, call } = build([
      { debriefed: 10, mapped: 6, skipped: 1, failed: 1, pending: 2 },
    ]);
    const coverage = await repository.getCoverage('v1', 'fhs-v');
    const { sql, params } = call();

    expect(params).toEqual(['v1', 'fhs-v']);
    expect(coverage).toEqual({
      debriefed: 10,
      mapped: 6,
      skipped: 1,
      failed: 1,
      pending: 2,
    });
    // Same eligibility as the queue: completed, countable, not a test org,
    // a debrief with items, a learner with a scored cut under the pinned rubric.
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain(`d.summary->'feedback'->'areasOfGrowth'`);
    expect(sql).toContain(`fsa."rubricVersion" = $2`);
    expect(sql).toContain(`l."mapperVersion" = $1`);
    expect(sql).not.toContain(SCOPE);
  });

  it('narrows to one org by the session tenant, bound as $3', async () => {
    const { repository, call } = build([{}]);
    const coverage = await repository.getCoverage('v1', 'fhs-v', TENANT);
    const { sql, params } = call();

    expect(params).toEqual(['v1', 'fhs-v', TENANT]);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).not.toContain(TENANT);
    // An empty count row is zeros, not NaN.
    expect(coverage).toEqual({
      debriefed: 0,
      mapped: 0,
      skipped: 0,
      failed: 0,
      pending: 0,
    });
  });
});
