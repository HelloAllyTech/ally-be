import { DataSource } from 'typeorm';

import { FoundationalSkillsAnalyticsRepository } from '../foundational-skills-analytics.repository';
import { FoundationalSkillsBenchmarkAnalyticsRepository } from '../foundational-skills-benchmark.repository';

/**
 * The Helping skills tab's org filter. Every query it reaches must narrow by
 * the row's own tenant with the id as a BOUND parameter (never interpolated),
 * keep the test-org exclusion, and change nothing when no org is picked.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';

const build = () => {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query } as unknown as DataSource;
  return { query, dataSource };
};

const callsOf = (query: jest.Mock) =>
  query.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: params as unknown[],
  }));

describe('FoundationalSkillsAnalyticsRepository.getAllLearnerCuts — org filter', () => {
  it('reads every non-test org when no tenant is given', async () => {
    const { query, dataSource } = build();
    await new FoundationalSkillsAnalyticsRepository(
      dataSource,
    ).getAllLearnerCuts('v1');

    const [{ sql, params }] = callsOf(query);
    expect(params).toEqual(['v1']);
    expect(sql).not.toContain(SCOPE);
    expect(sql).toContain('"isTestOrganization" = true');
  });

  it('narrows the cuts to one org by their own tenant, bound as $2', async () => {
    const { query, dataSource } = build();
    await new FoundationalSkillsAnalyticsRepository(
      dataSource,
    ).getAllLearnerCuts('v1', TENANT);

    const [{ sql, params }] = callsOf(query);
    expect(params).toEqual(['v1', TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    // Still excludes test orgs, and never carries the id in the SQL text.
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).not.toContain(TENANT);
  });
});

describe('FoundationalSkillsBenchmarkAnalyticsRepository — org filter', () => {
  const run = async (tenantId?: string) => {
    const { query, dataSource } = build();
    const repository = new FoundationalSkillsBenchmarkAnalyticsRepository(
      dataSource,
    );
    await repository.getScenarios('v1', tenantId);
    await repository.getCoverage('v1', tenantId);
    await repository.getScoredSessions('v1', tenantId);
    return callsOf(query);
  };

  it('reads every non-test org when no tenant is given', async () => {
    for (const { sql, params } of await run()) {
      expect(params).toEqual(['v1']);
      expect(sql).not.toContain(SCOPE);
    }
  });

  it('narrows scored sessions, coverage and pending by the session tenant', async () => {
    const [scenarios, coverage, sessions] = await run(TENANT);

    for (const { sql, params } of [scenarios, coverage, sessions]) {
      expect(params).toEqual(['v1', TENANT]);
      expect(sql).toContain('st.id::text = $2 OR st.code = $2');
      expect(sql).not.toContain(TENANT);
    }
    expect(scenarios.sql).toContain('(b."tenant_id")::text');
    expect(sessions.sql).toContain('(b."tenant_id")::text');
    // Both the assessed rows and the not-yet-scored sessions are narrowed, so
    // "pending" counts only this org's backlog.
    expect(coverage.sql).toContain('(b."tenant_id")::text');
    expect(coverage.sql).toContain('(s."tenant_id")::text');
  });

  it('keeps every flagged scenario listed — the scope is on the join, not the WHERE', async () => {
    const [scenarios] = await run(TENANT);
    const join = scenarios.sql.indexOf('LEFT JOIN');
    // The statement's own WHERE starts a line; the predicates' subqueries are inline.
    const where = scenarios.sql.search(/\n\s*WHERE /);
    const scope = scenarios.sql.indexOf(SCOPE);
    expect(scope).toBeGreaterThan(join);
    expect(scope).toBeLessThan(where);
  });
});
