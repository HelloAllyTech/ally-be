import { DataSource } from 'typeorm';

import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsAnalyticsRepository } from '../foundational-skills-analytics.repository';
import { ScenarioEffectivenessAnalyticsRepository } from '../scenario-effectiveness-analytics.repository';

/**
 * The Curriculum → Scenarios reads. Every read of scenario_sessions must keep
 * to countable sessions, drop test orgs, and narrow to a picked org by a BOUND
 * parameter (never interpolated); the cut read it builds on must stay pinned to
 * one rubric version.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';
const TEST_ORG = '"isTestOrganization" = true';
const COUNTABLE = `s."roomId" NOT LIKE 'preview-%' AND s."roomId" NOT LIKE 'seed-room-%'`;

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const dataSource = { query } as unknown as DataSource;
  return {
    query,
    repository: new ScenarioEffectivenessAnalyticsRepository(dataSource),
    cuts: new FoundationalSkillsAnalyticsRepository(dataSource),
  };
};

const lastCall = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
  return { sql: String(sql), params: params as unknown[] };
};

describe('the cut read behind opportunity coverage', () => {
  it('is pinned to one rubric version, scored cuts only, test orgs excluded', async () => {
    const { query, cuts } = build();
    await cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION, TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual([FHS_RUBRIC_VERSION, TENANT]);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain(`a.status = 'SCORED'`);
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).not.toContain(TENANT);
  });
});

describe('ScenarioEffectivenessAnalyticsRepository.getScenarioMeta', () => {
  it('counts countable, non-test sessions per scenario, platform-wide by default', async () => {
    const { query, repository } = build([
      { scenario_id: 4, title: 'Grief', sessions_played: '12' },
    ]);
    const rows = await repository.getScenarioMeta([4, 9]);
    const { sql, params } = lastCall(query);

    expect(params).toEqual([[4, 9]]);
    expect(sql).toContain('sc.id = ANY($1::int[])');
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
    expect(sql).toContain(COUNTABLE);
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(SCOPE);
    expect(rows).toEqual([
      { scenarioId: 4, title: 'Grief', sessionsPlayed: 12 },
    ]);
  });

  it('narrows the play count by the session tenant, bound as $2, on the JOIN so every scenario stays listed', async () => {
    const { query, repository } = build();
    await repository.getScenarioMeta([4], TENANT);
    const { sql, params } = lastCall(query);

    expect(params).toEqual([[4], TENANT]);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).not.toContain(TENANT);
    const scope = sql.indexOf(SCOPE);
    expect(scope).toBeGreaterThan(sql.indexOf('LEFT JOIN scenario_sessions'));
    expect(scope).toBeLessThan(sql.search(/\n\s*WHERE /));
  });

  it('does not query for no scenarios', async () => {
    const { query, repository } = build();
    expect(await repository.getScenarioMeta([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ScenarioEffectivenessAnalyticsRepository.getScenarioTags', () => {
  it('unpacks competencyIds and the legacy competencyId, keeping the custom flag', async () => {
    const { query, repository } = build([
      {
        scenario_id: 4,
        name: 'Empathy, Warmth & Genuineness',
        is_custom: false,
      },
      { scenario_id: 4, name: '7_custom_1', is_custom: true },
    ]);
    const rows = await repository.getScenarioTags([4]);
    const { sql, params } = lastCall(query);

    expect(params).toEqual([[4]]);
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain('sc."competencyIds"');
    expect(sql).toContain('sc."competencyId"::text');
    expect(rows).toEqual([
      { scenarioId: 4, name: 'Empathy, Warmth & Genuineness', isCustom: false },
      { scenarioId: 4, name: '7_custom_1', isCustom: true },
    ]);
  });
});

describe('ScenarioEffectivenessAnalyticsRepository.getRepeatGroups', () => {
  it('reads countable, scored, resolved sessions of non-test orgs, grouped per learner × scenario × version', async () => {
    const { query, repository } = build([
      {
        user_id: 3,
        scenario_id: 4,
        title: 'Grief',
        version_id: null,
        version_number: null,
        plays: '3',
        first_score: '40',
        first_at: '2026-07-01T00:00:00.000Z',
        latest_score: '55.5',
        latest_at: '2026-07-04T00:00:00.000Z',
      },
    ]);
    const rows = await repository.getRepeatGroups();
    const { sql, params } = lastCall(query);

    expect(params).toEqual([]);
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
    expect(sql).toContain(COUNTABLE);
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('s.score IS NOT NULL');
    // The unresolved 0: a zero with no detected event.
    expect(sql).toContain(
      'NOT (s.score = 0 AND NOT EXISTS (SELECT 1 FROM scenario_session_events rse',
    );
    expect(sql).toContain('GROUP BY user_id, scenario_id, version_id');
    expect(sql).toContain('HAVING COUNT(*) >= 2');
    expect(sql).not.toContain(SCOPE);

    expect(rows).toEqual([
      {
        userId: 3,
        scenarioId: 4,
        title: 'Grief',
        versionId: null,
        versionNumber: null,
        plays: 3,
        firstScore: 40,
        firstAt: new Date('2026-07-01T00:00:00.000Z'),
        latestScore: 55.5,
        latestAt: new Date('2026-07-04T00:00:00.000Z'),
      },
    ]);
  });

  it('narrows by the session tenant, bound as $1', async () => {
    const { query, repository } = build();
    await repository.getRepeatGroups(TENANT);
    const { sql, params } = lastCall(query);

    expect(params).toEqual([TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('st.id::text = $1 OR st.code = $1');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });
});
