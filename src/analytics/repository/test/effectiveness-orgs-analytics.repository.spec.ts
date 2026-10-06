import { DataSource } from 'typeorm';

import { EffectivenessOrgsAnalyticsRepository } from '../effectiveness-orgs-analytics.repository';

/**
 * The org scorecard and cost-per-improvement reads: test orgs excluded on
 * every table they touch, no tenant id ever interpolated, and the window and
 * tasks bound as parameters.
 */
const TEST_ORG = '"isTestOrganization" = true';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repo = new EffectivenessOrgsAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repo };
};

const callOf = (query: jest.Mock, i = 0) => ({
  sql: String(query.mock.calls[i][0]),
  params: query.mock.calls[i][1] as unknown[] | undefined,
});

describe('EffectivenessOrgsAnalyticsRepository.getOrgs', () => {
  it('reads live, non-test tenants with no parameters', async () => {
    const { query, repo } = build([
      { id: 'u-1', name: 'Alpha', code: 'alpha' },
      { id: 'u-2', name: null, code: '' },
    ]);
    const orgs = await repo.getOrgs();
    const { sql, params } = callOf(query);
    expect(params).toBeUndefined();
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('(t.id)::text');
    expect(orgs).toEqual([
      { id: 'u-1', name: 'Alpha', code: 'alpha' },
      { id: 'u-2', name: 'Unnamed organisation', code: null },
    ]);
  });
});

describe('EffectivenessOrgsAnalyticsRepository.getEnrolmentCounts', () => {
  it('groups started/completed enrolments by the learner’s raw tenant, test orgs excluded through the user', async () => {
    const { query, repo } = build([
      {
        tenant_ref: 'alpha',
        started: '4',
        completed: '1',
        learners_started: '3',
      },
      { tenant_ref: null, started: 2, completed: 0, learners_started: 2 },
    ]);
    const rows = await repo.getEnrolmentCounts();
    const { sql } = callOf(query);
    // Test orgs walked through users — track_enrollments' own tenant is nullable.
    expect(sql).toContain('FROM users ttu');
    expect(sql).toContain('ttu.id = e."userId"');
    expect(sql).toContain(TEST_ORG);
    // "Started" is item activity, not the enrolment's own startedAt.
    expect(sql).toContain('p."trackEnrollmentId" = e.id');
    expect(sql).not.toContain('e."startedAt"');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain('GROUP BY u."tenant_id"');
    expect(rows).toEqual([
      { tenantRef: 'alpha', started: 4, completed: 1, learnersStarted: 3 },
      { tenantRef: null, started: 2, completed: 0, learnersStarted: 2 },
    ]);
  });
});

describe('EffectivenessOrgsAnalyticsRepository.getLearnersWithSpend', () => {
  it('binds the window and the learner-caused tasks, excluding test orgs on usage and session', async () => {
    const { query, repo } = build([{ learners: '12' }]);
    const start = new Date('2026-09-01T00:00:00Z');
    const end = new Date('2026-10-01T00:00:00Z');
    const n = await repo.getLearnersWithSpend(start, end, [
      'AGENT_TURN',
      'SUMMARY',
    ]);
    const { sql, params } = callOf(query);
    expect(n).toBe(12);
    expect(params).toEqual([start, end, ['AGENT_TURN', 'SUMMARY']]);
    expect(sql).toContain('lu."occurredAt" >= $1');
    expect(sql).toContain('lu."occurredAt" < $2');
    expect(sql).toContain('lu.task = ANY($3::text[])');
    expect(sql).toContain('(lu."tenant_id")::text');
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).not.toContain('AGENT_TURN');
  });

  it('asks nothing with no tasks', async () => {
    const { query, repo } = build();
    expect(await repo.getLearnersWithSpend(new Date(), new Date(), [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
