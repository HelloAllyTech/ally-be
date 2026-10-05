import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import {
  ConvergenceSessionSignals,
  VersionScoreStats,
  versionKey,
} from '../util/measurement-convergence.util';
import { resolvedSessionScorePredicate } from '../util/scenario-effectiveness.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants } from '../util/test-tenant.util';

/**
 * Reads the per-session signals EFF-80 (AAQ-222, "Do the rulers agree?")
 * compares with the foundational helping-skills composite. The scored cuts
 * themselves come from `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts`
 * (rubric-pinned, test orgs excluded, org-scoped there); this repository only
 * looks up the sessions those cuts name, plus the score distribution of their
 * scenario versions.
 *
 *  - R2 session score (`scenario_sessions.score`): eligible only when
 *    countable — ENDED, COMPLETED, not a preview or seed room — non-null, and
 *    not the unresolved 0 ally-ai-learn sends when no event was ever detected
 *    (`resolvedSessionScorePredicate`).
 *  - R3 behaviour-instruction hits: `scenario_session_behavior_instructions` →
 *    `scenario_behavior_instructions.category` (SHOULD_DO / SHOULD_NOT_DO,
 *    bound as parameters). The detection row stores the instruction id as
 *    varchar, so the uuid side is cast — the same join the session-score
 *    writer uses.
 *  - R4 `scenario_session_details.summary->'feedback'->'skillCoverage'`, raw
 *    (parsed in TypeScript; two label generations exist).
 *  - R6 `scenario_session_feedbacks.rating` (1–5), averaged per session.
 *
 * Session ids travel as a bound `uuid[]`; nothing is interpolated but the
 * parameter-free shared predicates and enum constants.
 */
@Injectable()
export class MeasurementConvergenceAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** A countable, resolved session score on `s`. */
  private eligibleScore(alias: string): string {
    return [
      `${alias}.status = '${ScenarioSessionStatus.ENDED}'`,
      `${alias}."eventStatus" = '${ScenarioSessionEventStatus.COMPLETED}'`,
      countableSessionPredicate(alias),
      `${alias}.score IS NOT NULL`,
      resolvedSessionScorePredicate(alias),
    ].join(' AND ');
  }

  /** Every signal for each of `sessionIds` (missing or test-org sessions are absent). */
  async getSessionSignals(
    sessionIds: readonly string[],
  ): Promise<Map<string, ConvergenceSessionSignals>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      WITH ids AS (SELECT DISTINCT unnest($1::uuid[]) AS id),
      hits AS (
        SELECT sb."scenarioSessionId" AS sid,
               COUNT(*) FILTER (WHERE bi.category = $2)::int AS do_hits,
               COUNT(*) FILTER (WHERE bi.category = $3)::int AS dont_hits
          FROM scenario_session_behavior_instructions sb
          JOIN ids ON ids.id = sb."scenarioSessionId"
          JOIN scenario_behavior_instructions bi
            ON bi.id::text = sb."scenarioBehaviorInstructionId"
         GROUP BY sb."scenarioSessionId"
      ),
      ratings AS (
        SELECT f."scenarioSessionId" AS sid, AVG(f.rating)::float AS rating
          FROM scenario_session_feedbacks f
          JOIN ids ON ids.id = f."scenarioSessionId"
         WHERE f.rating IS NOT NULL
         GROUP BY f."scenarioSessionId"
      )
      SELECT s.id::text AS session_id,
             s."scenarioId" AS scenario_id,
             s."scenarioVersionId"::text AS version_id,
             s.score::float AS score,
             (${this.eligibleScore('s')}) AS score_eligible,
             COALESCE(h.do_hits, 0)::int AS do_hits,
             COALESCE(h.dont_hits, 0)::int AS dont_hits,
             d.summary->'feedback'->'skillCoverage' AS skill_coverage,
             r.rating
        FROM scenario_sessions s
        JOIN ids ON ids.id = s.id
        LEFT JOIN hits h ON h.sid = s.id
        LEFT JOIN ratings r ON r.sid = s.id
        LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
       WHERE ${excludeTestTenants('s."tenant_id"')}
      `,
      [
        [...sessionIds],
        BehaviorInstructionCategory.SHOULD_DO,
        BehaviorInstructionCategory.SHOULD_NOT_DO,
      ],
    );
    return new Map(
      rows.map((r: any): [string, ConvergenceSessionSignals] => [
        String(r.session_id),
        {
          scenarioId:
            r.scenario_id === null || r.scenario_id === undefined
              ? null
              : Number(r.scenario_id),
          versionId: (r.version_id as string | null) ?? null,
          score:
            r.score === null || r.score === undefined ? null : Number(r.score),
          scoreEligible: r.score_eligible === true,
          doHits: Number(r.do_hits) || 0,
          dontHits: Number(r.dont_hits) || 0,
          skillCoverage: r.skill_coverage ?? null,
          rating:
            r.rating === null || r.rating === undefined
              ? null
              : Number(r.rating),
        },
      ]),
    );
  }

  /**
   * The score distribution (n, mean, sample SD) of every scenario version the
   * given sessions ran, over ALL its eligible sessions platform-wide (test
   * orgs excluded) — the yardstick a session score is z-scored against, kept
   * the same whatever org the chart is narrowed to. NULL-version sessions
   * (pre-versioning) form their own group per scenario. Keyed by
   * {@link versionKey}.
   */
  async getVersionScoreStats(
    sessionIds: readonly string[],
  ): Promise<Map<string, VersionScoreStats>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.dataSource.query(
      `
      WITH versions AS (
        SELECT DISTINCT v."scenarioId" AS scenario_id,
               v."scenarioVersionId" AS version_id
          FROM scenario_sessions v
         WHERE v.id = ANY($1::uuid[])
      )
      SELECT s."scenarioId" AS scenario_id,
             s."scenarioVersionId"::text AS version_id,
             COUNT(*)::int AS sessions,
             AVG(s.score)::float AS mean,
             STDDEV_SAMP(s.score)::float AS sd
        FROM scenario_sessions s
        JOIN versions vv
          ON vv.scenario_id = s."scenarioId"
         AND vv.version_id IS NOT DISTINCT FROM s."scenarioVersionId"
       WHERE ${this.eligibleScore('s')}
         AND ${excludeTestTenants('s."tenant_id"')}
       GROUP BY s."scenarioId", s."scenarioVersionId"
      `,
      [[...sessionIds]],
    );
    return new Map(
      rows.map((r: any): [string, VersionScoreStats] => [
        versionKey(
          r.scenario_id === null ? null : Number(r.scenario_id),
          (r.version_id as string | null) ?? null,
        ),
        {
          sessions: Number(r.sessions) || 0,
          mean: Number(r.mean),
          sd: r.sd === null || r.sd === undefined ? null : Number(r.sd),
        },
      ]),
    );
  }
}
