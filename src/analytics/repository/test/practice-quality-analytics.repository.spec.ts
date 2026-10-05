import { DataSource } from 'typeorm';

import { AnalyticsBucket } from '../platform-analytics.repository';
import {
  PRACTICE_THRESHOLDS,
  PracticeQualityAnalyticsRepository,
} from '../practice-quality-analytics.repository';

/**
 * The practice-quality read (AAQ-208/209): one statement over countable,
 * non-test sessions, with the org and the language as BOUND parameters, the
 * client's filler/interim lines dropped, and every message aggregated in SQL.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';
const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2026-04-01T00:00:00.000Z');

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const dataSource = { query } as unknown as DataSource;
  return {
    query,
    repository: new PracticeQualityAnalyticsRepository(dataSource),
  };
};

const callOf = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[0];
  return { sql: String(sql), params: params as unknown[] };
};

const BASE_PARAMS = [
  'month',
  START,
  END,
  PRACTICE_THRESHOLDS.minLearnerTurns,
  PRACTICE_THRESHOLDS.minDurationMinutes * 60_000,
  PRACTICE_THRESHOLDS.minLearnerChars,
];

describe('PracticeQualityAnalyticsRepository.getPracticeQuality', () => {
  it('reads countable, non-test sessions in the window, platform-wide and every language by default', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(START, END, 'month');
    const { sql, params } = callOf(query);

    expect(params).toEqual(BASE_PARAMS);
    expect(sql).toContain(`s.status = 'ENDED'`);
    expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
    expect(sql).toContain(
      `s."roomId" NOT LIKE 'preview-%' AND s."roomId" NOT LIKE 'seed-room-%'`,
    );
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain('COALESCE(s."endedAt", s."createdAt") >= $2');
    expect(sql).toContain('COALESCE(s."endedAt", s."createdAt") < $3');
    expect(sql).toContain(
      `date_trunc($1, COALESCE(s."endedAt", s."createdAt"))`,
    );
    expect(sql).not.toContain(SCOPE);
    expect(sql).not.toContain('languages l');
  });

  it('measures duration net of pauses through the details join', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(START, END, 'month');
    const { sql } = callOf(query);
    expect(sql).toContain(
      'LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id',
    );
    expect(sql).toContain('d."callDuration"');
    expect(sql).toContain('s."totalPausedMs"');
    expect(sql).toContain('per.duration_ms >= $5');
  });

  it('splits learner from client by senderId and drops the client filler/interim lines', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(START, END, 'month');
    const { sql } = callOf(query);
    expect(sql).toContain('m."senderId" <> -1');
    expect(sql).toContain(
      `COALESCE(m.metadata->>'utteranceKind', '') NOT IN ('filler', 'interim')`,
    );
    // Messages are reduced per session in SQL, then per bucket and window.
    expect(sql).toContain('GROUP BY m."scenarioSessionId"');
    expect(sql).toContain('GROUP BY GROUPING SETS ((per.bucket), ())');
    // Practice: all three thresholds, by bound parameter.
    expect(sql).toContain('per.learner_turns >= $4');
    expect(sql).toContain('per.learner_chars >= $6');
    expect(sql).toContain('per.learner_turns < $4');
  });

  it('narrows by the session tenant and language, both bound, never interpolated', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(START, END, 'week', {
      tenantId: TENANT,
      language: 'hi-IN',
    });
    const { sql, params } = callOf(query);

    expect(params).toEqual(['week', ...BASE_PARAMS.slice(1), TENANT, 'hi-IN']);
    expect(sql).toContain('(s."tenant_id")::text');
    expect(sql).toContain('st.id::text = $7 OR st.code = $7');
    expect(sql).toContain(
      `LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int`,
    );
    expect(sql).toContain(`COALESCE(l.value, 'en') = $8`);
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).not.toContain(TENANT);
    expect(sql).not.toContain('hi-IN');
  });

  it('binds the language as $7 when no org is picked', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(START, END, 'month', {
      language: 'ta-IN',
    });
    const { sql, params } = callOf(query);
    expect(params).toEqual([...BASE_PARAMS, 'ta-IN']);
    expect(sql).toContain(`COALESCE(l.value, 'en') = $7`);
    expect(sql).not.toContain(SCOPE);
  });

  it('whitelists the bucket before it reaches date_trunc', async () => {
    const { query, repository } = build();
    await repository.getPracticeQuality(
      START,
      END,
      "month'); DROP TABLE users; --" as AnalyticsBucket,
    );
    expect(callOf(query).params[0]).toBe('month');
  });

  it('maps bucket rows and the whole-window total row', async () => {
    const { repository } = build([
      {
        bucket: '2026-01-01',
        is_total: 0,
        sessions: '30',
        talk_share_sessions: '28',
        talk_p25: '31.5',
        talk_median: '44',
        talk_p75: '52.25',
        turns_median: '7.5',
        practice_sessions: '21',
        short_turn_sessions: '4',
      },
      {
        bucket: null,
        is_total: 1,
        sessions: '30',
        talk_share_sessions: '28',
        talk_p25: null,
        talk_median: null,
        talk_p75: null,
        turns_median: null,
        practice_sessions: '21',
        short_turn_sessions: '4',
      },
    ]);
    const rows = await repository.getPracticeQuality(START, END, 'month');
    expect(rows).toEqual([
      {
        bucket: '2026-01-01',
        sessions: 30,
        talkShareSessions: 28,
        talkShareP25: 31.5,
        talkShareMedian: 44,
        talkShareP75: 52.25,
        learnerTurnsMedian: 7.5,
        practiceSessions: 21,
        shortTurnSessions: 4,
      },
      {
        bucket: null,
        sessions: 30,
        talkShareSessions: 28,
        talkShareP25: null,
        talkShareMedian: null,
        talkShareP75: null,
        learnerTurnsMedian: null,
        practiceSessions: 21,
        shortTurnSessions: 4,
      },
    ]);
  });
});
