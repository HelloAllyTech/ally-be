import { DataSource } from 'typeorm';

import { EffectivenessAnalyticsRepository } from '../effectiveness-analytics.repository';

/**
 * Every Effectiveness read keeps the test-org exclusion, binds every value
 * (the org id above all) as a parameter, and — for the funnel population —
 * reads roles from `user_groups` exactly as the activation funnel does.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';
const TEST_ORG = '"isTestOrganization" = true';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new EffectivenessAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const lastCall = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
  return { sql: String(sql), params: (params ?? []) as unknown[] };
};

describe('EffectivenessAnalyticsRepository.getFunnelPopulation', () => {
  it('is the activation population: LEARNER via user_groups, test orgs out, countable sessions only', async () => {
    const { query, repository } = build([
      { user_id: '7', countable_sessions: '3' },
      { user_id: 9, countable_sessions: null },
    ]);
    const out = await repository.getFunnelPopulation();

    const { sql, params } = lastCall(query);
    expect(params).toEqual(['LEARNER', 'ENDED', 'COMPLETED']);
    expect(sql).toContain('JOIN groups g ON g.id = ug."groupId"');
    expect(sql).toContain('g.name = $1');
    // No collapsed role column anywhere.
    expect(sql).not.toMatch(/u\."?role"?\s*=/);
    expect(sql).toContain('s.status = $2');
    expect(sql).toContain('s."eventStatus" = $3');
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'seed-room-%'`);
    // Both the people and the sessions drop test orgs.
    expect(sql).toContain('(u."tenant_id")::text');
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql.split(TEST_ORG).length - 1).toBe(2);
    // A LEFT JOIN: never-practised learners survive with 0.
    expect(sql).toContain('LEFT JOIN scenario_sessions s');
    expect(sql).not.toContain(SCOPE);
    expect(out).toEqual([
      { userId: 7, countableSessions: 3 },
      { userId: 9, countableSessions: 0 },
    ]);
  });

  it("narrows by the learner's own org, the id bound as $4", async () => {
    const { query, repository } = build();
    await repository.getFunnelPopulation(TENANT);

    const { sql, params } = lastCall(query);
    expect(params).toEqual(['LEARNER', 'ENDED', 'COMPLETED', TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });
});

describe('EffectivenessAnalyticsRepository segment lookups', () => {
  it('session attributes: bound ids, test orgs out, a guarded languageId cast', async () => {
    const { query, repository } = build([
      {
        session_id: 'a',
        language_key: 'hi',
        language_label: 'Hindi',
        difficulty: 'HARD',
      },
    ]);
    const out = await repository.getSessionSegmentAttributes(['a', 'b']);

    const { sql, params } = lastCall(query);
    expect(params).toEqual([['a', 'b']]);
    expect(sql).toContain('ss.id = ANY($1::uuid[])');
    expect(sql).toContain('(ss."tenant_id")::text');
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain(`~ '^[0-9]{1,9}$'`);
    expect(sql).toContain('sc."difficultyLevel"');
    expect(out.get('a')).toEqual({
      languageKey: 'hi',
      languageLabel: 'Hindi',
      difficulty: 'HARD',
    });
  });

  it('skips the database when there is nothing to look up', async () => {
    const { query, repository } = build();
    expect((await repository.getSessionSegmentAttributes([])).size).toBe(0);
    expect((await repository.getWorkerTypes([])).size).toBe(0);
    expect((await repository.getCourseStarts([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('worker types: users.metadata, bound ids, test orgs out', async () => {
    const { query, repository } = build([
      { user_id: '3', worker_type: 'LAY' },
      { user_id: 4, worker_type: null },
    ]);
    const out = await repository.getWorkerTypes([3, 4]);

    const { sql, params } = lastCall(query);
    expect(params).toEqual([[3, 4]]);
    expect(sql).toContain(`u.metadata->>'workerType'`);
    expect(sql).toContain('u.id = ANY($1::int[])');
    expect(sql).toContain(TEST_ORG);
    expect([...out.entries()]).toEqual([
      [3, 'LAY'],
      [4, null],
    ]);
  });

  it('course starts: earliest started live enrollment in a live course, test orgs out by user', async () => {
    const { query, repository } = build([
      { user_id: '3', started_at: '2026-02-01T00:00:00.000Z' },
    ]);
    const out = await repository.getCourseStarts([3]);

    const { sql, params } = lastCall(query);
    expect(params).toEqual([[3]]);
    expect(sql).toContain('MIN(e."startedAt")');
    expect(sql).toContain('e."startedAt" IS NOT NULL');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain('WHERE ttu.id = e."userId"');
    expect(sql).toContain(TEST_ORG);
    expect(out.get(3)?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('tenant aliases: uuid and code both resolve to the uuid; test orgs left out', async () => {
    const { query, repository } = build([
      { id: 'uuid-a', code: 'acme' },
      { id: 'uuid-b', code: null },
    ]);
    const out = await repository.getTenantAliases();

    const { sql } = lastCall(query);
    expect(sql).toContain('"isTestOrganization" IS NOT TRUE');
    expect([...out.entries()]).toEqual([
      ['uuid-a', 'uuid-a'],
      ['acme', 'uuid-a'],
      ['uuid-b', 'uuid-b'],
    ]);
  });
});
