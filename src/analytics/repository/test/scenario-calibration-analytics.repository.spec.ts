import { DataSource } from 'typeorm';

import { ScenarioCalibrationAnalyticsRepository } from '../scenario-calibration-analytics.repository';

/**
 * Calibration and progression read countable sessions only, always exclude
 * test orgs, and narrow to one org by the session's own tenant with the id as
 * a BOUND parameter — never interpolated. The scoring-config reads take
 * scenario ids only (they are scenario content, not tenant data).
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';
const TEST_ORG = '"isTestOrganization" = true';

const build = (result: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(result);
  const dataSource = { query } as unknown as DataSource;
  return {
    query,
    repo: new ScenarioCalibrationAnalyticsRepository(dataSource),
  };
};

const callOf = (query: jest.Mock, i = 0) => ({
  sql: String(query.mock.calls[i][0]),
  params: query.mock.calls[i][1] as unknown[],
});

const expectCountable = (sql: string) => {
  expect(sql).toContain("s.status = 'ENDED'");
  expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
  expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
  expect(sql).toContain(`s."roomId" NOT LIKE 'seed-room-%'`);
  expect(sql).toContain(TEST_ORG);
};

describe('ScenarioCalibrationAnalyticsRepository.getCalibrationSessions', () => {
  it('reads every non-test org when no tenant is given', async () => {
    const { query, repo } = build();
    await repo.getCalibrationSessions();
    const { sql, params } = callOf(query);
    expect(params).toEqual([]);
    expect(sql).not.toContain(SCOPE);
    expectCountable(sql);
    expect(sql).toContain('s.score IS NOT NULL');
    // The unresolved 0 is flagged (same rule as repeat improvement), not silently kept.
    expect(sql).toContain('s.score = 0 AND NOT EXISTS');
    expect(sql).toContain('scenario_session_events');
    expect(sql).toContain('s."scenarioVersionId"');
  });

  it('narrows to one org by the session tenant, bound as $1', async () => {
    const { query, repo } = build();
    await repo.getCalibrationSessions(TENANT);
    const { sql, params } = callOf(query);
    expect(params).toEqual([TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('st.id::text = $1 OR st.code = $1');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });

  it('maps driver strings to numbers and booleans', async () => {
    const { repo } = build([
      {
        scenario_id: '4',
        version_id: null,
        version_number: '2',
        title: 'T',
        difficulty_level: 'HARD',
        score: '35',
        started_at: '2026-07-01T00:00:00.000Z',
        resolved: 't',
      },
    ]);
    const [row] = await repo.getCalibrationSessions();
    expect(row).toEqual({
      scenarioId: 4,
      versionId: null,
      versionNumber: 2,
      title: 'T',
      difficultyLevel: 'HARD',
      score: 35,
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
      resolved: true,
    });
  });
});

describe('ScenarioCalibrationAnalyticsRepository — scoring config', () => {
  it('skips the database with no scenarios', async () => {
    const { query, repo } = build();
    expect(await repo.getScoringContributors([])).toEqual([]);
    expect(await repo.getScoringConfigChangedAt([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads what the worker is sent: mapped ACTIVE events, PASSIVE events, behaviour instructions', async () => {
    const { query, repo } = build([
      { scenario_id: 1, kind: 'event', score: 10, max_occurrences: '3' },
      { scenario_id: 1, kind: 'event', score: 5, max_occurrences: null },
      { scenario_id: 1, kind: 'behaviour', score: -10, max_occurrences: null },
    ]);
    const rows = await repo.getScoringContributors([1, 2]);
    const { sql, params } = callOf(query);

    expect(params).toEqual([[1, 2]]);
    expect(sql).toContain('ANY($1::int[])');
    expect(sql).toContain('COALESCE(se.score, ev.score)');
    expect(sql).toContain(`se."deletedAt" IS NULL`);
    expect(sql).toContain(`se."autoTerminationStatus" = false`);
    expect(sql).toContain(`ev."visibilityType" = 'ACTIVE'`);
    expect(sql).toContain(`ev."visibilityType" = 'PASSIVE'`);
    expect(sql).toContain("'maxOccurrences'");
    expect(sql).toContain('scenario_behavior_instructions');
    expect(sql).toContain("bi.category = 'SHOULD_DO'");
    expect(sql).toMatch(/THEN 10\s+ELSE -10 END/);
    expect(rows).toEqual([
      { scenarioId: 1, kind: 'event', score: 10, maxOccurrences: 3 },
      { scenarioId: 1, kind: 'event', score: 5, maxOccurrences: null },
      { scenarioId: 1, kind: 'behaviour', score: -10, maxOccurrences: null },
    ]);
  });

  it('dates the last config change from mappings, base events, behaviour instructions and PASSIVE events, soft deletes included', async () => {
    const { query, repo } = build([
      { scenario_id: 1, changed_at: new Date('2026-08-01T00:00:00Z') },
      { scenario_id: 2, changed_at: null },
    ]);
    const rows = await repo.getScoringConfigChangedAt([1, 2]);
    const { sql, params } = callOf(query);
    expect(params).toEqual([[1, 2]]);
    expect(sql).toContain('FROM scenario_events se');
    expect(sql).toContain('JOIN session_events ev');
    expect(sql).toContain('FROM scenario_behavior_instructions bi');
    expect(sql).toContain(`'PASSIVE'`);
    expect(sql).toContain('"deletedAt")');
    expect(rows).toEqual([
      { scenarioId: 1, changedAt: new Date('2026-08-01T00:00:00Z') },
      { scenarioId: 2, changedAt: null },
    ]);
  });
});

describe('ScenarioCalibrationAnalyticsRepository.getProgressionShapes', () => {
  const START = new Date('2026-06-01T00:00:00Z');
  const END = new Date('2026-09-01T00:00:00Z');

  it('reads countable sessions ended in the window, platform-wide', async () => {
    const { query, repo } = build();
    await repo.getProgressionShapes(START, END, 'month');
    const { sql, params } = callOf(query);
    expect(params).toEqual([START, END]);
    expect(sql).not.toContain(SCOPE);
    expectCountable(sql);
    expect(sql).toContain(`s."endedAt" >= $1`);
    expect(sql).toContain(`s."endedAt" < $2`);
    expect(sql).toContain(`date_trunc('month', s."endedAt")`);
    // The keys ally-ai-learn stamps on each turn.
    expect(sql).toContain("tm.metadata ? 'stateCount'");
    expect(sql).toContain("'stateIndex'");
    expect(sql).toContain("'stateIsTerminal'");
  });

  it('narrows by the session tenant, bound as $3', async () => {
    const { query, repo } = build();
    await repo.getProgressionShapes(START, END, 'week', TENANT);
    const { sql, params } = callOf(query);
    expect(params).toEqual([START, END, TENANT]);
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });

  it('never interpolates an unlisted bucket', async () => {
    const { query, repo } = build();
    await repo.getProgressionShapes(
      START,
      END,
      "month'); DROP TABLE users; --" as never,
    );
    const { sql } = callOf(query);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain(`date_trunc('month', s."endedAt")`);
  });

  it('maps a shape row', async () => {
    const { repo } = build([
      {
        bucket: '2026-07-01',
        scenario_id: '3',
        title: null,
        has_state_metadata: true,
        states: 3,
        opening: 0,
        furthest: '2',
        lowest: 0,
        reached_end: 't',
        sessions: '5',
      },
    ]);
    const [row] = await repo.getProgressionShapes(START, END, 'month');
    expect(row).toEqual({
      bucket: '2026-07-01',
      scenarioId: 3,
      title: null,
      hasStateMetadata: true,
      states: 3,
      opening: 0,
      furthest: 2,
      lowest: 0,
      reachedEnd: true,
      sessions: 5,
    });
  });
});
