import { DataSource } from 'typeorm';

import { PracticeDepthAnalyticsRepository } from '../practice-depth-analytics.repository';

/**
 * The practice-spacing read (AAQ-224): countable sessions only, the funnel's
 * learner population, test orgs out, an org filter bound — never interpolated.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repo = new PracticeDepthAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repo };
};

describe('PracticeDepthAnalyticsRepository.getSessionGaps', () => {
  it('reads countable sessions of LEARNERs, test orgs excluded, platform-wide by default', async () => {
    const { query, repo } = build();
    await repo.getSessionGaps();

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['LEARNER', 'ENDED', 'COMPLETED']);
    expect(sql).toContain('g.name = $1');
    expect(sql).toContain('s.status = $2');
    expect(sql).toContain('s."eventStatus" = $3');
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'seed-room-%'`);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('(u."tenant_id")::text');
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).not.toContain('EXISTS (SELECT 1 FROM tenants st');
    // Whole days between consecutive starts, per learner, in order.
    expect(sql).toContain('LAG(started_at) OVER');
    expect(sql).toContain('/ 86400');
  });

  it('narrows by the learner’s tenant, as the funnel does, bound as $4', async () => {
    const { query, repo } = build();
    await repo.getSessionGaps(TENANT);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['LEARNER', 'ENDED', 'COMPLETED', TENANT]);
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).not.toContain(TENANT);
  });

  it('parses one row per learner, a single session having no gaps', async () => {
    const { repo } = build([
      { userId: '5', sessions: '3', gaps: [0, 4] },
      { userId: 6, sessions: 1, gaps: [] },
      { userId: 7, sessions: 1, gaps: null },
    ]);
    expect(await repo.getSessionGaps()).toEqual([
      { userId: 5, sessions: 3, gaps: [0, 4] },
      { userId: 6, sessions: 1, gaps: [] },
      { userId: 7, sessions: 1, gaps: [] },
    ]);
  });
});
