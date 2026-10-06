import { DataSource } from 'typeorm';

import { QualityDistributionAnalyticsRepository } from '../quality-distribution-analytics.repository';

/**
 * Satisfaction by practice ordinal (AAQ-229): all-time (no window bound), one
 * rating per session, numbered per learner by session start, test orgs and
 * org scoping by the SESSION's tenant.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repo = new QualityDistributionAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repo };
};

describe('QualityDistributionAnalyticsRepository.getRatingsByOrdinal', () => {
  it('is all-time, one rating per session, ordinals by session start', async () => {
    const { query, repo } = build();
    await repo.getRatingsByOrdinal(12, 6);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([12, 6, 4]);
    // No window: nothing compares a date with a bound parameter.
    expect(sql).not.toMatch(/"createdAt" >= \$/);
    expect(sql).not.toMatch(/"createdAt" < \$/);
    // Latest answer per session wins.
    expect(sql).toContain('DISTINCT ON (f."scenarioSessionId")');
    expect(sql).toContain('f."createdAt" DESC');
    expect(sql).toContain(
      'PARTITION BY user_id ORDER BY started_at, session_id',
    );
    expect(sql).toContain('COALESCE(s."startedAt", s."createdAt")');
    // The tail is pooled, not dropped; the panel split rides along.
    expect(sql).toContain('LEAST(ordinal, $1::int + 1)');
    expect(sql).toContain('rated_sessions >= $2::int');
    // By the session: test orgs out, preview/seed rooms out.
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).not.toContain('EXISTS (SELECT 1 FROM tenants st');
  });

  it('narrows by the session tenant, bound as $4', async () => {
    const { query, repo } = build();
    await repo.getRatingsByOrdinal(12, 6, TENANT);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([12, 6, 4, TENANT]);
    expect(sql).toContain(
      'EXISTS (SELECT 1 FROM tenants st WHERE (st.id::text = (s."tenant_id")::text',
    );
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).not.toContain(TENANT);
  });

  it('parses counts and sums defensively', async () => {
    const { repo } = build([
      {
        ordinal: '1',
        experienced: true,
        ratings: '3',
        ratingSum: '12',
        high: '2',
      },
      { ordinal: 13, experienced: false, ratings: 1, ratingSum: 5, high: 1 },
    ]);
    expect(await repo.getRatingsByOrdinal(12, 6)).toEqual([
      { ordinal: 1, experienced: true, ratings: 3, ratingSum: 12, high: 2 },
      { ordinal: 13, experienced: false, ratings: 1, ratingSum: 5, high: 1 },
    ]);
  });
});
