import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TrackItemType } from 'src/track/type/track.type';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
  scopeToTenantByUser,
} from '../util/test-tenant.util';

/** One learner's run through one course. */
export interface CourseImpactEnrollmentRow {
  trackId: string;
  title: string;
  status: string;
  userId: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** One scored helping-skills slice of one learner. */
export interface CourseImpactCutRow {
  userId: number;
  /** When the session that closed the slice ended: every word in it is from on or before this. */
  closedAt: Date;
  /**
   * When the slice's FIRST session ended — sessions are consumed in the order
   * they ended, so every session in the slice ended on or after this. Null when
   * that session can no longer be found.
   */
  firstEndedAt: Date | null;
  composite: number;
  unhelpful: boolean | null;
  /** Only skills the slice gave an opportunity for. */
  levels: Record<string, number>;
}

export interface CourseImpactCompetencyRow {
  trackId: string;
  name: string;
  /** `explicit`: the author tagged the course; `derived`: read off its roleplays' scenarios. */
  source?: 'explicit' | 'derived';
}

/**
 * Reads what the course-impact chart compares: course enrollments, and the
 * helping-skills slices (src/foundational-skills) of the learners in them.
 *
 * Whose data counts is decided ONCE, by the learner: `track_enrollments` has a
 * nullable tenant column, so — like the track drop-off charts — both the
 * test-org exclusion and the org filter walk `users`. The slices are then
 * those learners' slices, wherever they practised; a slice is still dropped
 * when its own session's tenant is a test org.
 *
 * Every slice query is pinned to one rubric version, so scores from two
 * rulers are never averaged together. The free-practice reference reads the
 * same slices for learners in scope with no enrollment at all.
 */
@Injectable()
export class CourseImpactAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The enrollment predicate, binding the tenant (when set) to `placeholder`. */
  private enrollmentScope(
    userIdColumn: string,
    placeholder: string,
    tenantId?: string,
  ): string {
    const base = excludeTestTenantsByUser(userIdColumn);
    return tenantId
      ? `${base} AND ${scopeToTenantByUser(userIdColumn, placeholder)}`
      : base;
  }

  /** Every live enrollment in a live course, for learners in scope. */
  async getEnrollments(
    tenantId?: string,
  ): Promise<CourseImpactEnrollmentRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT e."trackId" AS track_id, t.title, t.status,
             e."userId" AS user_id,
             e."startedAt" AS started_at, e."completedAt" AS completed_at
        FROM track_enrollments e
        JOIN tracks t ON t.id = e."trackId" AND t."deletedAt" IS NULL
       WHERE e."deletedAt" IS NULL
         AND ${this.enrollmentScope('e."userId"', '$1', tenantId)}
      `,
      tenantId ? [tenantId] : [],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      title: (r.title as string | null) ?? 'Untitled course',
      status: String(r.status ?? ''),
      userId: Number(r.user_id),
      startedAt: r.started_at ? new Date(r.started_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
    }));
  }

  /**
   * The scored-slice read both cohorts share: the columns, the rubric pin and
   * the slice's own test-org exclusion. `learnerPredicate` decides WHOSE
   * slices — written against `c."userId"`, binding the tenant (when set) to
   * `$2`.
   */
  private async scoredCuts(
    rubricVersion: string,
    learnerPredicate: string,
    tenantId?: string,
  ): Promise<CourseImpactCutRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT c."userId" AS user_id,
             c."closedSessionEndedAt" AS closed_at,
             fs."endedAt" AS first_ended_at,
             a."compositeScore"::float AS composite,
             a."hasUnhelpfulBehaviour" AS unhelpful,
             a."skillLevels" AS levels
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
        LEFT JOIN scenario_sessions fs ON fs.id = c."startSessionId"
       WHERE a."rubricVersion" = $1
         AND a.status = 'SCORED'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}
         AND ${learnerPredicate}
       ORDER BY c."userId", c."closedSessionEndedAt", c."cutIndex"
      `,
      tenantId ? [rubricVersion, tenantId] : [rubricVersion],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      closedAt: new Date(r.closed_at),
      firstEndedAt: r.first_ended_at ? new Date(r.first_ended_at) : null,
      composite: Number(r.composite),
      unhelpful: r.unhelpful ?? null,
      levels: r.levels && typeof r.levels === 'object' ? r.levels : {},
    }));
  }

  /**
   * Every scored slice with a composite, for learners who have an enrollment
   * in scope, ordered by learner then when the slice closed. Slices are a
   * handful per learner, so the set is read once and windowed in memory.
   */
  async getScoredCuts(
    rubricVersion: string,
    tenantId?: string,
  ): Promise<CourseImpactCutRow[]> {
    return this.scoredCuts(
      rubricVersion,
      `c."userId" IN (
           SELECT e."userId"
             FROM track_enrollments e
            WHERE e."deletedAt" IS NULL
              AND ${this.enrollmentScope('e."userId"', '$2', tenantId)}
         )`,
      tenantId,
    );
  }

  /**
   * The free-practice reference's slices: every scored slice of learners in
   * scope who have NO live enrollment in any course (a soft-deleted
   * enrollment does not count as one). Scoped exactly like
   * {@link getScoredCuts} — test orgs and the org filter by the learner's own
   * org, the slice's own test-org exclusion and the rubric pin — so the two
   * cohorts differ only in having taken a course.
   */
  async getFreePracticeCuts(
    rubricVersion: string,
    tenantId?: string,
  ): Promise<CourseImpactCutRow[]> {
    return this.scoredCuts(
      rubricVersion,
      `${this.enrollmentScope('c."userId"', '$2', tenantId)}
         AND NOT EXISTS (
           SELECT 1
             FROM track_enrollments fe
            WHERE fe."userId" = c."userId"
              AND fe."deletedAt" IS NULL
         )`,
      tenantId,
    );
  }

  /**
   * Which competencies each course teaches, by name. The author's own tag
   * (`tracks."competencyIds"`) wins when it resolves to at least one shared
   * competency; otherwise the course falls back to what its live ROLEPLAY
   * items' scenarios assess (`competencyIds` and the legacy single
   * `competencyId` it mirrors). Deciding on "resolves" rather than "not NULL"
   * means a course whose only tagged competency was deleted falls back
   * instead of losing its skills. Custom competencies are left out on both
   * paths: they are one author's private variants, named after their owner's
   * user id.
   */
  async getCourseCompetencies(): Promise<CourseImpactCompetencyRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH explicit AS (
        SELECT DISTINCT t.id AS track_id, comp.name
          FROM tracks t
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(t."competencyIds") = 'array'
                 THEN t."competencyIds" ELSE '[]'::jsonb END
          ) AS cid(id)
          JOIN competencies comp ON comp.id::text = cid.id
                                AND comp."isCustom" = false
         WHERE t."deletedAt" IS NULL
      ),
      derived AS (
        SELECT DISTINCT i."trackId" AS track_id, comp.name
          FROM track_items i
          JOIN scenarios sc ON sc.id = i."scenarioId"
          CROSS JOIN LATERAL (
            SELECT jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(sc."competencyIds") = 'array'
                          THEN sc."competencyIds" ELSE '[]'::jsonb END
                   ) AS id
            UNION
            SELECT sc."competencyId"::text WHERE sc."competencyId" IS NOT NULL
          ) cid
          JOIN competencies comp ON comp.id::text = cid.id
                                AND comp."isCustom" = false
         WHERE i."deletedAt" IS NULL
           AND i.type = $1
      )
      SELECT track_id, name, 'explicit' AS source FROM explicit
      UNION ALL
      SELECT d.track_id, d.name, 'derived' AS source FROM derived d
       WHERE NOT EXISTS (SELECT 1 FROM explicit e WHERE e.track_id = d.track_id)
       ORDER BY name
      `,
      [TrackItemType.ROLEPLAY],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      name: String(r.name),
      source: r.source === 'explicit' ? 'explicit' : 'derived',
    }));
  }
}
