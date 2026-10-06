import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FhsAssessmentStatus } from 'src/foundational-skills/enum/foundational-skills.enum';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType, TrackStatus } from 'src/track/type/track.type';
import {
  KnowledgeEnrollmentRow,
  KnowledgeFirstAttemptRow,
  KnowledgeSkillCutRow,
  ProgressCurveEnrollmentRow,
  ProgressCurveItemRow,
} from '../util/course-progress-analytics.util';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
  scopeToTenantByUser,
} from '../util/test-tenant.util';

/**
 * Courses whose learners these charts read: live and archived — the same set
 * as the course funnel (AAQ-210) and the tenant-admin course-usage table. An
 * archived course keeps its enrolled learners finishing it, so dropping it
 * would lose real progress; a DRAFT course cannot be enrolled in.
 */
export const COURSE_PROGRESS_TRACK_STATUSES: readonly string[] = [
  TrackStatus.ACTIVE,
  TrackStatus.ARCHIVED,
];

/** A Postgres text[] as node-postgres returns it: parsed, or its literal when the type is unregistered. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{')) {
    const inner = value.slice(1, -1);
    return inner ? inner.split(',').map((s) => s.replace(/^"|"$/g, '')) : [];
  }
  return [];
}

/**
 * Reads behind Highlights → Curriculum's "Where in a course momentum dies"
 * (AAQ-225) and "Does knowing predict doing?" (AAQ-226).
 *
 * Whose data counts is decided by the LEARNER, exactly as course impact does:
 * `track_enrollments."tenantId"` is nullable and quiz attempts carry no tenant
 * at all, so the test-org exclusion and the org filter walk `users` from the
 * row's `"userId"`. Helping-skills slices are then those learners' slices,
 * wherever they practised; a slice is still dropped when its own session's
 * tenant is a test org, and every slice read is pinned to one rubric version.
 *
 * "Live" everywhere means not soft-deleted: a deleted course, section, item,
 * enrolment, progress row or attempt is invisible here, as it is to learners.
 * Courses are further limited to {@link COURSE_PROGRESS_TRACK_STATUSES}.
 */
@Injectable()
export class CourseProgressAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The learner predicate on `userIdColumn`, binding the tenant (when set) to `placeholder`. */
  private learnerScope(
    userIdColumn: string,
    placeholder: string,
    tenantId?: string,
  ): string {
    const base = excludeTestTenantsByUser(userIdColumn);
    return tenantId
      ? `${base} AND ${scopeToTenantByUser(userIdColumn, placeholder)}`
      : base;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Progress curve (AAQ-225)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Every live item of every live ACTIVE or ARCHIVED course, with the two order columns the
   * engine walks (sections by `order`, items by `order` within a section).
   * Course structure is the same for every org, so this read is unscoped;
   * only courses with an enrolment in scope reach the response.
   */
  async getLiveTrackItems(): Promise<ProgressCurveItemRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT i."trackId" AS track_id, i.id AS item_id, i.title, i.type,
             s.id AS section_id, s."order" AS section_order,
             i."order" AS item_order
        FROM track_items i
        JOIN track_sections s ON s.id = i."trackSectionId"
                             AND s."trackId" = i."trackId"
                             AND s."deletedAt" IS NULL
        JOIN tracks t ON t.id = i."trackId"
                     AND t."deletedAt" IS NULL
                     AND t.status = ANY($1)
       WHERE i."deletedAt" IS NULL
      `,
      [COURSE_PROGRESS_TRACK_STATUSES],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      itemId: String(r.item_id),
      title: (r.title as string | null) ?? 'Untitled item',
      type: String(r.type ?? ''),
      sectionId: String(r.section_id),
      sectionOrder: Number(r.section_order ?? 0),
      itemOrder: Number(r.item_order ?? 0),
    }));
  }

  /**
   * Every live enrolment in a live course, for learners in scope, with its
   * live progress rows folded into: which items it reached (row not LOCKED),
   * which it opened (`startedAt` set), and whether it opened or completed
   * anything at all (the funnel's "started").
   */
  async getProgressEnrollments(
    tenantId?: string,
  ): Promise<ProgressCurveEnrollmentRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT e.id AS enrollment_id, e."trackId" AS track_id,
             t.title, t.status,
             e."completedAt" AS completed_at,
             e."completedItems" AS completed_items,
             COALESCE(
               array_agg(p."trackItemId"::text) FILTER (WHERE p.status <> $1),
               '{}'
             ) AS reached_item_ids,
             COALESCE(
               array_agg(p."trackItemId"::text) FILTER (WHERE p."startedAt" IS NOT NULL),
               '{}'
             ) AS opened_item_ids,
             COALESCE(
               bool_or(p."startedAt" IS NOT NULL OR p.status = $2),
               false
             ) AS opened_any
        FROM track_enrollments e
        JOIN tracks t ON t.id = e."trackId"
                     AND t."deletedAt" IS NULL
                     AND t.status = ANY($3)
        LEFT JOIN track_item_progress p ON p."trackEnrollmentId" = e.id
                                       AND p."deletedAt" IS NULL
       WHERE e."deletedAt" IS NULL
         AND ${this.learnerScope('e."userId"', '$4', tenantId)}
       GROUP BY e.id, t.id
      `,
      [
        SessionItemStatus.LOCKED,
        SessionItemStatus.COMPLETED,
        COURSE_PROGRESS_TRACK_STATUSES,
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      enrollmentId: String(r.enrollment_id),
      trackId: String(r.track_id),
      title: (r.title as string | null) ?? 'Untitled course',
      status: String(r.status ?? ''),
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      completedItems: Number(r.completed_items ?? 0),
      openedAny: r.opened_any === true,
      reachedItemIds: toStringArray(r.reached_item_ids),
      openedItemIds: toStringArray(r.opened_item_ids),
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Knowledge vs skill (AAQ-226)
  // ───────────────────────────────────────────────────────────────────────────

  /** A live QUIZ item in a live section of course `trackColumn`. */
  private liveQuizItems(trackColumn: string, typePlaceholder: string): string {
    return `
      SELECT qi.id
        FROM track_items qi
        JOIN track_sections qs ON qs.id = qi."trackSectionId"
                              AND qs."deletedAt" IS NULL
       WHERE qi."trackId" = ${trackColumn}
         AND qi."deletedAt" IS NULL
         AND qi.type = ${typePlaceholder}`;
  }

  /**
   * Every live enrolment, for learners in scope, in a live course that has at
   * least one live quiz — a course with no quiz has no knowledge measure, so
   * its learners would only inflate "missing quiz".
   */
  async getQuizCourseEnrollments(
    tenantId?: string,
  ): Promise<KnowledgeEnrollmentRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT e."trackId" AS track_id, t.title, t.status,
             (SELECT COUNT(*) FROM (${this.liveQuizItems('e."trackId"', '$1')}) qc)::int AS quiz_items,
             e."userId" AS user_id, e."startedAt" AS started_at
        FROM track_enrollments e
        JOIN tracks t ON t.id = e."trackId"
                     AND t."deletedAt" IS NULL
                     AND t.status = ANY($2)
       WHERE e."deletedAt" IS NULL
         AND EXISTS (${this.liveQuizItems('e."trackId"', '$1')})
         AND ${this.learnerScope('e."userId"', '$3', tenantId)}
      `,
      [
        TrackItemType.QUIZ,
        COURSE_PROGRESS_TRACK_STATUSES,
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      title: (r.title as string | null) ?? 'Untitled course',
      status: String(r.status ?? ''),
      quizItems: Number(r.quiz_items ?? 0),
      userId: Number(r.user_id),
      startedAt: r.started_at ? new Date(r.started_at) : null,
    }));
  }

  /**
   * Each learner's FIRST attempt at each live quiz, for learners in scope: the
   * earliest live `attemptNumber = 1` attempt (a re-enrolment restarts the
   * count, so a learner can have two). Returned whether or not it was scored
   * — a pending or ungraded first attempt must not be replaced by a later one.
   * Scores only; never answers or grading.
   */
  async getFirstQuizAttempts(
    tenantId?: string,
  ): Promise<KnowledgeFirstAttemptRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT ON (q."trackItemId", q."userId")
             i."trackId" AS track_id, q."trackItemId" AS track_item_id,
             q."userId" AS user_id,
             q."scorePct"::float AS score_pct, q.passed
        FROM track_quiz_attempts q
        JOIN track_items i ON i.id = q."trackItemId"
                          AND i."deletedAt" IS NULL
                          AND i.type = $1
        JOIN track_sections s ON s.id = i."trackSectionId"
                             AND s."deletedAt" IS NULL
        JOIN tracks t ON t.id = i."trackId"
                     AND t."deletedAt" IS NULL
                     AND t.status = ANY($2)
       WHERE q."deletedAt" IS NULL
         AND q."attemptNumber" = 1
         AND ${this.learnerScope('q."userId"', '$3', tenantId)}
       ORDER BY q."trackItemId", q."userId",
                q."submittedAt" ASC NULLS LAST, q."createdAt" ASC, q.id ASC
      `,
      [
        TrackItemType.QUIZ,
        COURSE_PROGRESS_TRACK_STATUSES,
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      trackItemId: String(r.track_item_id),
      userId: Number(r.user_id),
      scorePct:
        r.score_pct === null || r.score_pct === undefined
          ? null
          : Number(r.score_pct),
      passed: r.passed === null || r.passed === undefined ? null : !!r.passed,
    }));
  }

  /**
   * Every scored helping-skills slice under `rubricVersion` of learners with
   * a live enrolment in scope — the same scored-slice definition and timing
   * fields as course impact: SCORED, a composite, the rubric pinned, the
   * slice's own test-org exclusion, and the slice's first session's end time.
   */
  async getScoredCuts(
    rubricVersion: string,
    tenantId?: string,
  ): Promise<KnowledgeSkillCutRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT c."userId" AS user_id,
             c."closedSessionEndedAt" AS closed_at,
             fs."endedAt" AS first_ended_at,
             a."compositeScore"::float AS composite
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
        LEFT JOIN scenario_sessions fs ON fs.id = c."startSessionId"
       WHERE a."rubricVersion" = $1
         AND a.status = '${FhsAssessmentStatus.SCORED}'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}
         AND c."userId" IN (
               SELECT e."userId"
                 FROM track_enrollments e
                WHERE e."deletedAt" IS NULL
                  AND ${this.learnerScope('e."userId"', '$2', tenantId)}
             )
       ORDER BY c."userId", c."closedSessionEndedAt", c."cutIndex"
      `,
      tenantId ? [rubricVersion, tenantId] : [rubricVersion],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      closedAt: new Date(r.closed_at),
      firstEndedAt: r.first_ended_at ? new Date(r.first_ended_at) : null,
      composite: Number(r.composite),
    }));
  }
}
