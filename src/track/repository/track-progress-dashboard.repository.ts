import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from 'src/learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from 'src/learn/service/scenario-session-evaluation.service';
import { countableSessionPredicate } from 'src/analytics/util/session-eligibility.util';
import { TrackItemType } from '../type/track.type';

/** One evaluated ROLEPLAY attempt in a single learner's single course. */
export interface RoleplayFeedbackRow {
  trackItemId: string;
  trackItemTitle: string | null;
  scenarioSessionId: string;
  /**
   * The learner's roleplay score for THIS attempt — `scenario_sessions.score`,
   * the platform's one learner-facing roleplay number: the -100..100 meter the
   * learner watched during the session, the value `meetsMinimumScore` gates
   * item completion on, the `score` column in super-admin Roleplay Logs, and
   * the per-item `score` on Track Overview.
   *
   * Deliberately NOT `scenario_session_details.compositeScore`, which this
   * dashboard used to report. That is the actor-evaluation composite —
   * round(mean(applicable metrics)) from the LLM judge over the globally
   * configured agent test cases, on its own 0..100 scale — and it feeds
   * super-admin Roleplay Logs' evaluation panel and the analytics quality
   * surfaces. Reading it here made the same finished roleplay carry two
   * different "scores" for the same learner across two views of the same
   * course, and the one the course progress dashboard showed was not the one
   * that decided whether the item completed.
   */
  sessionScore: number | null;
  occurredAt: string | null;
  skillCoverage: { category: string; percentage: number }[] | null;
  evaluationMarkdown: string | null;
}

/**
 * Reads the roleplay side of one learner's progress through one course:
 * every completed, evaluated ROLEPLAY attempt, oldest first, with whatever
 * skillCoverage payload its evaluation left behind.
 *
 * Raw SQL over tables by name, following SkillGrowthAnalyticsRepository's
 * convention — this is a cross-table read composition (track_item_progress /
 * scenario_sessions / scenario_session_details), not a track_* table's own
 * CRUD, so it does not belong on an entity Repository<T>.
 */
@Injectable()
export class TrackProgressDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Scoped by `trackEnrollmentId` alone — that already uniquely identifies
   * (learner, track), so no separate userId/tenantId predicate is needed.
   * Deliberately does NOT apply excludeTestTenants/scopeToTenant: those guard
   * cross-tenant super-admin analytics, not a learner reading their own data.
   *
   * Returns EVERY completed+evaluated attempt, not just an item's current
   * one — a learner who retried a roleplay item has demonstrated something on
   * every attempt, and "consolidated feedback ... until current completion"
   * means everything done so far in the course, not just current per-item
   * state (which Track Overview already shows via TrackItemProgress.score).
   */
  async getRoleplayFeedback(
    trackEnrollmentId: string,
  ): Promise<RoleplayFeedbackRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        tip."trackItemId"                       AS "trackItemId",
        ti.title                                  AS "trackItemTitle",
        s.id                                       AS "scenarioSessionId",
        s."score"                                 AS "sessionScore",
        d.summary->'feedback'->'skillCoverage'    AS "skillCoverage",
        d."evaluationMarkdown"                    AS "evaluationMarkdown",
        COALESCE(s."startedAt", s."createdAt")     AS "occurredAt"
      FROM track_item_progress tip
      JOIN track_items ti ON ti.id = tip."trackItemId"
      JOIN scenario_sessions s ON s."trackItemProgressId" = tip.id
      JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
      WHERE tip."trackEnrollmentId" = $1
        AND ti.type = $2
        AND s."eventStatus" = $3
        AND d."evaluationStatus" = $4
        -- Still an "was this attempt judged at all?" predicate, not the score
        -- source: the skillCoverage/markdown feedback this dashboard
        -- consolidates only exists for a judged session. The score it reports
        -- comes from the session row above.
        AND d."compositeScore" IS NOT NULL
        AND ${countableSessionPredicate('s')}
      ORDER BY "occurredAt" ASC
      `,
      [
        trackEnrollmentId,
        TrackItemType.ROLEPLAY,
        ScenarioSessionEventStatus.COMPLETED,
        ActorEvaluationStatus.COMPLETED,
      ],
    );

    const typed = rows as Record<string, unknown>[];
    return typed.map((r) => ({
      trackItemId: String(r.trackItemId),
      trackItemTitle: (r.trackItemTitle as string | null) ?? null,
      scenarioSessionId: String(r.scenarioSessionId),
      sessionScore: this.num(r.sessionScore),
      occurredAt: this.iso(r.occurredAt),
      skillCoverage: this.parseSkillCoverage(r.skillCoverage),
      evaluationMarkdown: (r.evaluationMarkdown as string | null) ?? null,
    }));
  }

  /**
   * skillCoverage survives as data, not as trust: entries are whatever
   * ally-ai wrote (two label generations exist across the platform's
   * history), so anything that is not a {category, percentage} pair is
   * dropped rather than guessed at. Duplicated from
   * SkillGrowthAnalyticsRepository.parseSkillCoverage rather than
   * cross-imported from analytics/ — same reasoning that repository gives
   * for not sharing its CTEs across files.
   */
  private parseSkillCoverage(
    value: unknown,
  ): { category: string; percentage: number }[] | null {
    if (!Array.isArray(value)) return null;
    const entries = value
      .map((e) => {
        if (typeof e !== 'object' || e === null) return null;
        const category = (e as Record<string, unknown>).category;
        const percentage = this.num((e as Record<string, unknown>).percentage);
        if (typeof category !== 'string' || percentage === null) return null;
        return { category, percentage };
      })
      .filter((e): e is { category: string; percentage: number } => e !== null);
    return entries.length ? entries : null;
  }

  /** pg timestamps arrive as Date or string depending on driver mood. */
  private iso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
