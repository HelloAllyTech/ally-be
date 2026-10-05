import { DataSource } from 'typeorm';

import { FoundationalSkillsEffectivenessRepository } from '../foundational-skills-effectiveness.repository';

/**
 * The reads behind AAQ-205..207. Every session query must count only real,
 * completed practice (countable rooms, no AI-vs-AI test runs), drop test
 * organisations, and — when an org is picked — narrow by the session's own
 * tenant with the id as a BOUND parameter, never interpolated.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new FoundationalSkillsEffectivenessRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const lastCall = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
  return { sql: String(sql), params: params as unknown[] };
};

const expectPractice = (sql: string) => {
  expect(sql).toContain(`s.status = 'ENDED'`);
  expect(sql).toContain(`s."eventStatus" = 'COMPLETED'`);
  expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
  expect(sql).toContain(`s."roomId" NOT LIKE 'seed-room-%'`);
  expect(sql).toContain(`(s.metadata->>'v2vTest')::boolean, false) = false`);
  expect(sql).toContain('"isTestOrganization" = true');
};

describe('FoundationalSkillsEffectivenessRepository', () => {
  describe('getPracticeOrdinals', () => {
    it('numbers countable sessions per learner by start time and reads every non-test org', async () => {
      const { query, repository } = build();
      await repository.getPracticeOrdinals(12);
      const { sql, params } = lastCall(query);

      expectPractice(sql);
      expect(sql).toContain('PARTITION BY s."counselorId"');
      expect(sql).toContain(
        'ORDER BY COALESCE(s."startedAt", s."createdAt"), s.id',
      );
      expect(sql).toContain('sc."difficultyLevel"');
      expect(sql).toContain('ordinal <= $1');
      expect(sql).not.toContain(SCOPE);
      expect(params).toEqual([12, ['EASY', 'MEDIUM', 'HARD']]);
    });

    it('narrows to one org by the session tenant, bound as $3', async () => {
      const { query, repository } = build();
      await repository.getPracticeOrdinals(12, TENANT);
      const { sql, params } = lastCall(query);

      expectPractice(sql);
      expect(sql).toContain(SCOPE);
      expect(sql).toContain('(s."tenant_id")::text');
      expect(sql).toContain('st.id::text = $3 OR st.code = $3');
      expect(sql).not.toContain(TENANT);
      expect(params).toEqual([12, ['EASY', 'MEDIUM', 'HARD'], TENANT]);
    });

    it('maps rows to numbers', async () => {
      const { repository } = build([
        {
          ordinal: '2',
          difficulty: 'HARD',
          sessions: '7',
          experienced_sessions: '3',
        },
      ]);
      expect(await repository.getPracticeOrdinals(12)).toEqual([
        { ordinal: 2, difficulty: 'HARD', sessions: 7, experiencedSessions: 3 },
      ]);
    });
  });

  describe('getPracticeMinutesToCuts', () => {
    it('does not query with nothing to look up', async () => {
      const { query, repository } = build();
      expect(await repository.getPracticeMinutesToCuts([])).toEqual(new Map());
      expect(query).not.toHaveBeenCalled();
    });

    it('sums countable session time up to the cut’s closing session, compared in SQL', async () => {
      const { query, repository } = build([
        { user_id: 7, cut_index: 3, ms: 90 * 60000 },
        { user_id: 8, cut_index: 2, ms: null }, // unknown, not 0
      ]);
      const out = await repository.getPracticeMinutesToCuts([
        { userId: 7, cut: 3 },
        { userId: 8, cut: 2 },
      ]);
      const { sql, params } = lastCall(query);

      expectPractice(sql);
      expect(sql).toContain('unnest($1::int[], $2::int[])');
      expect(sql).toContain('s."endedAt" <= c."closedSessionEndedAt"');
      expect(sql).toContain('"callDuration"'); // sessionDurationMsExpr
      expect(sql).toContain('"totalPausedMs"');
      expect(sql).not.toContain(SCOPE);
      expect(params).toEqual([
        [7, 8],
        [3, 2],
      ]);
      expect(out).toEqual(new Map([['7:3', 90]]));
    });

    it('keeps only the picked org’s sessions, bound as $3', async () => {
      const { query, repository } = build();
      await repository.getPracticeMinutesToCuts(
        [{ userId: 7, cut: 3 }],
        TENANT,
      );
      const { sql, params } = lastCall(query);
      expect(sql).toContain('st.id::text = $3 OR st.code = $3');
      expect(sql).not.toContain(TENANT);
      expect(params).toEqual([[7], [3], TENANT]);
    });
  });

  describe('getSessionTimes', () => {
    it('does not query with no sessions', async () => {
      const { query, repository } = build();
      expect(await repository.getSessionTimes([])).toEqual(new Map());
      expect(query).not.toHaveBeenCalled();
    });

    it('reads every distinct session once and maps missing times to null', async () => {
      const { query, repository } = build([
        {
          session_id: 'a',
          started_at: '2026-01-01T09:00:00Z',
          ended_at: '2026-01-01T10:00:00Z',
        },
        { session_id: 'b', started_at: null, ended_at: null },
      ]);
      const out = await repository.getSessionTimes(['a', 'b', 'a']);
      const { sql, params } = lastCall(query);
      expect(sql).toContain('s.id = ANY($1::uuid[])');
      expect(params).toEqual([['a', 'b']]);
      expect(out.get('a')?.endedAt?.toISOString()).toBe(
        '2026-01-01T10:00:00.000Z',
      );
      expect(out.get('b')).toEqual({ startedAt: null, endedAt: null });
    });
  });
});
