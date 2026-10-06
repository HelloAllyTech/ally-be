import { DataSource } from 'typeorm';

import { FoundationalSkillsAnalyticsRepository } from '../foundational-skills-analytics.repository';
import { FoundationalSkillsTransferRepository } from '../foundational-skills-transfer.repository';

/**
 * The two R1 reads added for the gated Helping skills charts — transfer to a
 * new scenario (AAQ-220) and the dose–response minutes (AAQ-217). Each must pin
 * the rubric, drop test orgs, and narrow by the cut's own tenant with the id as
 * a BOUND parameter, never interpolated.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';
const TEST_ORGS = '"isTestOrganization" = true';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const dataSource = { query } as unknown as DataSource;
  return { query, dataSource };
};

const callOf = (query: jest.Mock, i = 0) => ({
  sql: String(query.mock.calls[i][0]),
  params: query.mock.calls[i][1] as unknown[],
});

describe('FoundationalSkillsTransferRepository.getCutScenarios', () => {
  it('reads every sealed cut, scored or not, with the rubric pinned on the join', async () => {
    const { query, dataSource } = build();
    await new FoundationalSkillsTransferRepository(dataSource).getCutScenarios(
      'v1',
    );
    const { sql, params } = callOf(query);
    expect(params).toEqual(['v1']);
    // LEFT JOIN: an unscored cut still says which scenarios were played.
    expect(sql).toContain('LEFT JOIN foundational_skill_assessments a');
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain(`a.status = 'SCORED'`);
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    expect(sql).toContain(TEST_ORGS);
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).not.toContain(SCOPE);
    // Session order is kept, and a cut with no sessions is not dropped.
    expect(sql).toContain('WITH ORDINALITY');
    expect(sql).toContain('LEFT JOIN LATERAL');
  });

  it('narrows by the cut tenant, bound as $2', async () => {
    const { query, dataSource } = build();
    await new FoundationalSkillsTransferRepository(dataSource).getCutScenarios(
      'v1',
      TENANT,
    );
    const { sql, params } = callOf(query);
    expect(params).toEqual(['v1', TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).toContain(TEST_ORGS);
    expect(sql).not.toContain(TENANT);
  });

  it('parses rows: null score stays null, sessions keep their order', async () => {
    const { dataSource } = build([
      {
        user_id: '7',
        cut: '2',
        score: null,
        sessions: [
          { sessionId: 's-1', scenarioId: 11, difficulty: 'EASY' },
          { sessionId: 's-2', scenarioId: null, difficulty: null },
        ],
      },
      { user_id: 7, cut: 3, score: '2.5', sessions: null },
    ]);
    const rows = await new FoundationalSkillsTransferRepository(
      dataSource,
    ).getCutScenarios('v1');
    expect(rows).toEqual([
      {
        userId: 7,
        cut: 2,
        score: null,
        sessions: [
          { sessionId: 's-1', scenarioId: 11, difficulty: 'EASY' },
          { sessionId: 's-2', scenarioId: null, difficulty: null },
        ],
      },
      { userId: 7, cut: 3, score: 2.5, sessions: [] },
    ]);
  });
});

describe('FoundationalSkillsAnalyticsRepository.getPracticeMinutesByLearner', () => {
  it('does not query for nobody', async () => {
    const { query, dataSource } = build();
    const out = await new FoundationalSkillsAnalyticsRepository(
      dataSource,
    ).getPracticeMinutesByLearner('v1', []);
    expect(out.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('sums countable sessions of the scored cuts, rubric-pinned, ids bound', async () => {
    const { query, dataSource } = build([
      { user_id: '3', ms: 90_000 },
      { user_id: '4', ms: null },
    ]);
    const out = await new FoundationalSkillsAnalyticsRepository(
      dataSource,
    ).getPracticeMinutesByLearner('v1', [3, 4]);

    const { sql, params } = callOf(query);
    expect(params).toEqual(['v1', [3, 4]]);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain(`a.status = 'SCORED'`);
    expect(sql).toContain('sc.user_id = ANY($2::int[])');
    expect(sql).toContain('SELECT DISTINCT sc.user_id, x.session_id');
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain('d."callDuration"');
    expect(sql).toContain(TEST_ORGS);
    expect(sql).not.toContain(SCOPE);
    // 90s → 1.5 min; a learner with no measurable duration is absent, not 0.
    expect(out).toEqual(new Map([[3, 1.5]]));
  });

  it('narrows to one org by the cut tenant, bound as $3', async () => {
    const { query, dataSource } = build();
    await new FoundationalSkillsAnalyticsRepository(
      dataSource,
    ).getPracticeMinutesByLearner('v1', [3], TENANT);
    const { sql, params } = callOf(query);
    expect(params).toEqual(['v1', [3], TENANT]);
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).not.toContain(TENANT);
  });
});
