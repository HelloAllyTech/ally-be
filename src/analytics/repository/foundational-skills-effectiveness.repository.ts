import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioDifficultyLevel } from 'src/learn/type/scenario.type';
import {
  PracticeOrdinalRow,
  SessionTimes,
  reachKey,
} from '../util/foundational-skills-effectiveness.util';
import {
  countableSessionPredicate,
  sessionDurationMsExpr,
} from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Practice that counts, for the three Helping skills "over time" cards: a
 * completed roleplay in a real room, not an AI-vs-AI test run, outside test
 * organisations. `tenantParam` narrows to one org by the session's own tenant
 * (the id always travels as a bound parameter).
 */
function practiceSession(alias: string, tenantParam?: string): string {
  return [
    `${alias}.status = 'ENDED'`,
    `${alias}."eventStatus" = 'COMPLETED'`,
    countableSessionPredicate(alias),
    `COALESCE((${alias}.metadata->>'v2vTest')::boolean, false) = false`,
    excludeTestTenants(`${alias}."tenant_id"`),
    ...(tenantParam
      ? [scopeToTenant(`${alias}."tenant_id"`, tenantParam)]
      : []),
  ].join('\n         AND ');
}

/**
 * The reads behind time to competence (AAQ-205), retention after a break
 * (AAQ-206) and difficulty mix by practice ordinal (AAQ-207) that the scored
 * cuts themselves do not carry. The cuts come from
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts`, so all three cards
 * stand on exactly the slice set the rest of the Helping skills tab uses.
 */
@Injectable()
export class FoundationalSkillsEffectivenessRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Practice minutes up to each (learner, cut): the summed duration (net of
   * pauses) of the learner's countable sessions that ended no later than the
   * session that closed that cut — so the session the cut closed in counts
   * whole. Joined through `foundational_skill_cuts` rather than passing the
   * close time back in, so the comparison keeps the column's full precision.
   * `tenantId` keeps only that org's sessions, matching the cuts' own scope.
   *
   * Keyed by {@link reachKey}; a learner/cut with no measurable session is
   * absent (unknown), never 0.
   */
  async getPracticeMinutesToCuts(
    targets: readonly { userId: number; cut: number }[],
    tenantId?: string,
  ): Promise<Map<string, number>> {
    if (targets.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      WITH q AS (
        SELECT DISTINCT t.user_id, t.cut_index
          FROM unnest($1::int[], $2::int[]) AS t(user_id, cut_index)
      )
      SELECT q.user_id, q.cut_index,
             SUM(${sessionDurationMsExpr('s', 'd')})::float AS ms
        FROM q
        JOIN foundational_skill_cuts c
          ON c."userId" = q.user_id AND c."cutIndex" = q.cut_index
        JOIN scenario_sessions s
          ON s."counselorId" = q.user_id
         AND s."endedAt" IS NOT NULL
         AND s."endedAt" <= c."closedSessionEndedAt"
        LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
       WHERE ${practiceSession('s', tenantId ? '$3' : undefined)}
       GROUP BY q.user_id, q.cut_index
      `,
      [
        targets.map((t) => t.userId),
        targets.map((t) => t.cut),
        ...(tenantId ? [tenantId] : []),
      ],
    );
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.ms === null || r.ms === undefined) continue;
      out.set(
        reachKey(Number(r.user_id), Number(r.cut_index)),
        Number(r.ms) / 60000,
      );
    }
    return out;
  }

  /**
   * Start and end of every session in `sessionIds`, in one read. No
   * eligibility filter: these are sessions a scored cut already contains.
   */
  async getSessionTimes(
    sessionIds: readonly string[],
  ): Promise<Map<string, SessionTimes>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      SELECT s.id::text AS session_id,
             s."startedAt" AS started_at,
             s."endedAt" AS ended_at
        FROM scenario_sessions s
       WHERE s.id = ANY($1::uuid[])
      `,
      [[...new Set(sessionIds)]],
    );
    return new Map(
      rows.map((r: any) => [
        String(r.session_id),
        {
          startedAt: r.started_at ? new Date(r.started_at) : null,
          endedAt: r.ended_at ? new Date(r.ended_at) : null,
        },
      ]),
    );
  }

  /**
   * Sessions by the learner's practice ordinal (their Nth countable session,
   * by start time, id as the tiebreak) and the scenario's difficulty label, for
   * ordinals 1..`maxOrdinal`. A label outside EASY/MEDIUM/HARD, a NULL, or a
   * scenario row that no longer exists reads as `untagged`.
   * `experienced_sessions` counts only learners with at least `maxOrdinal`
   * sessions in scope — the fixed panel, in the same pass.
   *
   * Ordinals are counted within scope: with `tenantId`, a learner's first
   * session in that org is their ordinal 1 there.
   */
  async getPracticeOrdinals(
    maxOrdinal: number,
    tenantId?: string,
  ): Promise<PracticeOrdinalRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH ordered AS (
        SELECT s."counselorId" AS user_id,
               ROW_NUMBER() OVER (
                 PARTITION BY s."counselorId"
                 ORDER BY COALESCE(s."startedAt", s."createdAt"), s.id
               ) AS ordinal,
               COUNT(*) OVER (PARTITION BY s."counselorId") AS total,
               CASE WHEN UPPER(sc."difficultyLevel") = ANY($2::text[])
                    THEN UPPER(sc."difficultyLevel")
                    ELSE 'untagged' END AS difficulty
          FROM scenario_sessions s
          LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
         WHERE s."counselorId" IS NOT NULL
           AND ${practiceSession('s', tenantId ? '$3' : undefined)}
      )
      SELECT ordinal::int AS ordinal, difficulty,
             COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE total >= $1)::int AS experienced_sessions
        FROM ordered
       WHERE ordinal <= $1
       GROUP BY ordinal, difficulty
       ORDER BY ordinal, difficulty
      `,
      [
        maxOrdinal,
        Object.values(ScenarioDifficultyLevel),
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      ordinal: Number(r.ordinal),
      difficulty: String(r.difficulty),
      sessions: Number(r.sessions),
      experiencedSessions: Number(r.experienced_sessions),
    }));
  }
}
