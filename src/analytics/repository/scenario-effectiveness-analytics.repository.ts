import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import {
  RepeatGroupRow,
  ScenarioMetaRow,
  ScenarioTagRow,
  resolvedSessionScorePredicate,
} from '../util/scenario-effectiveness.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Reads behind the Curriculum sub-tab's "Scenarios" section (AAQ-214..216).
 *
 * The helping-skills cuts themselves come from
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` (rubric-pinned,
 * test orgs excluded, org-scoped by the cut's own tenant); this repository adds
 * what that one does not carry: each scenario's tags and play count, and the
 * per-learner replay groups of the same scenario version.
 *
 * Every read of `scenario_sessions` keeps to countable sessions
 * (`status = 'ENDED'`, `eventStatus = 'COMPLETED'`, no preview or seed rooms),
 * excludes test organisations and, when an org is picked, narrows by the
 * session's own tenant with the id as a BOUND parameter.
 */
@Injectable()
export class ScenarioEffectivenessAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The countable-session predicate on alias `s`, with the org bound to `placeholder`. */
  private sessionScope(placeholder: string, tenantId?: string): string {
    const base =
      `s.status = '${ScenarioSessionStatus.ENDED}' ` +
      `AND s."eventStatus" = '${ScenarioSessionEventStatus.COMPLETED}' ` +
      `AND ${countableSessionPredicate('s')} ` +
      `AND ${excludeTestTenants('s."tenant_id"')}`;
    return tenantId
      ? `${base} AND ${scopeToTenant('s."tenant_id"', placeholder)}`
      : base;
  }

  /**
   * Title and all-time countable sessions of each scenario in `scenarioIds` —
   * the "sessions played" a tag gap is ranked by. A scenario with no countable
   * session in scope still comes back, with 0. Deleted scenarios keep their
   * title: their cuts are history, not a mistake.
   */
  async getScenarioMeta(
    scenarioIds: readonly number[],
    tenantId?: string,
  ): Promise<ScenarioMetaRow[]> {
    if (scenarioIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `
      SELECT sc.id AS scenario_id, sc.title,
             COUNT(s.id)::int AS sessions_played
        FROM scenarios sc
        LEFT JOIN scenario_sessions s
          ON s."scenarioId" = sc.id
         AND ${this.sessionScope('$2', tenantId)}
       WHERE sc.id = ANY($1::int[])
       GROUP BY sc.id, sc.title
      `,
      tenantId ? [scenarioIds, tenantId] : [scenarioIds],
    );
    return rows.map((r: any) => ({
      scenarioId: Number(r.scenario_id),
      title: (r.title as string | null) ?? null,
      sessionsPlayed: Number(r.sessions_played) || 0,
    }));
  }

  /**
   * Every competency each scenario is tagged with, by name: `competencyIds`
   * (Roleplay Studio v2) and the legacy single `competencyId` it mirrors,
   * unpacked the same way as `CourseImpactAnalyticsRepository.getCourseCompetencies`.
   * Custom competencies come back flagged rather than dropped, so the caller
   * can say a tag exists even though its name identifies nothing.
   */
  async getScenarioTags(
    scenarioIds: readonly number[],
  ): Promise<ScenarioTagRow[]> {
    if (scenarioIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT sc.id AS scenario_id, comp.name,
             comp."isCustom" AS is_custom
        FROM scenarios sc
        CROSS JOIN LATERAL (
          SELECT jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(sc."competencyIds") = 'array'
                        THEN sc."competencyIds" ELSE '[]'::jsonb END
                 ) AS id
          UNION
          SELECT sc."competencyId"::text WHERE sc."competencyId" IS NOT NULL
        ) cid
        JOIN competencies comp ON comp.id::text = cid.id
       WHERE sc.id = ANY($1::int[])
       ORDER BY sc.id, comp.name
      `,
      [scenarioIds],
    );
    return rows.map((r: any) => ({
      scenarioId: Number(r.scenario_id),
      name: String(r.name),
      isCustom: r.is_custom === true,
    }));
  }

  /**
   * One row per learner × scenario × scenario version with at least two
   * eligible plays: how many, and the first and latest score by session start
   * (ties broken by id, so the pick is stable). Aggregated in SQL so only the
   * groups travel, never the sessions.
   *
   * Eligible = countable, a non-null `score`, and not the unresolved 0 (a 0
   * with no detected event — see `resolvedSessionScorePredicate`). Grouping on
   * `scenarioVersionId` puts NULL-version sessions (predating versioning) in a
   * group of their own, so a version change always starts a new pairing.
   */
  async getRepeatGroups(tenantId?: string): Promise<RepeatGroupRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH plays AS (
        SELECT s."counselorId" AS user_id, s."scenarioId" AS scenario_id,
               s."scenarioVersionId" AS version_id, s.id,
               s.score::float AS score,
               COALESCE(s."startedAt", s."createdAt") AS played_at
          FROM scenario_sessions s
         WHERE ${this.sessionScope('$1', tenantId)}
           AND s.score IS NOT NULL
           AND ${resolvedSessionScorePredicate('s')}
      ),
      groups AS (
        SELECT user_id, scenario_id, version_id,
               COUNT(*)::int AS plays,
               (array_agg(score ORDER BY played_at, id))[1] AS first_score,
               MIN(played_at) AS first_at,
               (array_agg(score ORDER BY played_at DESC, id DESC))[1] AS latest_score,
               MAX(played_at) AS latest_at
          FROM plays
         GROUP BY user_id, scenario_id, version_id
        HAVING COUNT(*) >= 2
      )
      SELECT g.user_id, g.scenario_id, sc.title, g.version_id,
             v."versionNumber" AS version_number, g.plays,
             g.first_score, g.first_at, g.latest_score, g.latest_at
        FROM groups g
        LEFT JOIN scenarios sc ON sc.id = g.scenario_id
        LEFT JOIN scenario_versions v ON v.id = g.version_id
       ORDER BY g.scenario_id, g.version_id, g.user_id
      `,
      tenantId ? [tenantId] : [],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      scenarioId: Number(r.scenario_id),
      title: (r.title as string | null) ?? null,
      versionId: (r.version_id as string | null) ?? null,
      versionNumber:
        r.version_number === null || r.version_number === undefined
          ? null
          : Number(r.version_number),
      plays: Number(r.plays),
      firstScore: Number(r.first_score),
      firstAt: new Date(r.first_at),
      latestScore: Number(r.latest_score),
      latestAt: new Date(r.latest_at),
    }));
  }
}
