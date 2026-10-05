import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SessionItemStatus } from 'src/common/type/common.type';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { TrackItemType, TrackStatus } from 'src/track/type/track.type';
import {
  enrollmentDaysToCompleteSql,
  enrollmentReachedHalfSql,
} from '../util/course-progress-sql.util';
import {
  FunnelEnrollmentRow,
  GateProgressRow,
  QuizAttemptRow,
  QuizGradingFlag,
  QuizItemRow,
  QuizQuestionMeta,
} from '../util/curriculum.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import {
  excludeTestTenantsByUser,
  scopeToTenantByUser,
} from '../util/test-tenant.util';

/** A roleplay item whose completion criteria carry a numeric `minScore`. */
export interface GatedRoleplayItemRow {
  trackItemId: string;
  title: string;
  trackId: string;
  trackTitle: string;
  scenarioId: number | null;
  minScore: number;
}

/**
 * Courses whose learners the curriculum charts read: live and archived. An
 * archived course keeps its enrolled learners finishing it
 * (TrackEnrollmentService.getTrackDetailForLearner), so dropping it would lose
 * real progress; a DRAFT course cannot be enrolled in. Same set as the
 * tenant-admin course-usage table.
 */
const LEARNER_COURSE_STATUSES = [TrackStatus.ACTIVE, TrackStatus.ARCHIVED];

/**
 * Reads behind Highlights → Curriculum: the course funnel (EFF-21), quiz
 * outcomes (EFF-23) and roleplay gates (EFF-24).
 *
 * Whose data counts is decided by the LEARNER, like course impact and the
 * track drop-off charts: none of these tables carries a reliable tenant
 * column of its own (`track_enrollments."tenantId"` is nullable;
 * quiz attempts and item progress have none), so both the test-org exclusion
 * and the org filter walk `users`, with the tenant id always a bound
 * parameter. Soft-deleted courses, items, enrolments, progress rows and
 * attempts are excluded everywhere.
 */
@Injectable()
export class CurriculumAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Start of an all-time window: the platform's first row. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** The learner predicate, binding the tenant (when set) to `placeholder`. */
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

  /**
   * Every live enrolment CREATED in [start, end) in a live or archived
   * course, for learners in scope — one row each, with the shared
   * "reached half" and "days to complete" definitions evaluated in SQL so
   * they cannot drift from the tenant-admin course-usage table.
   */
  async getFunnelEnrollments(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<FunnelEnrollmentRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT e."trackId" AS track_id, t.title, t.status,
             t."totalItems" AS total_items,
             e."completedItems" AS completed_items,
             e."completedAt" AS completed_at,
             e."lastActivityAt" AS last_activity_at,
             (${enrollmentReachedHalfSql('e', 't."totalItems"')}) AS reached_half,
             CASE WHEN e."completedAt" IS NOT NULL
                  THEN ${enrollmentDaysToCompleteSql('e')} END AS days_to_complete,
             EXISTS (
               SELECT 1 FROM track_item_progress p
                WHERE p."trackEnrollmentId" = e.id
                  AND p."deletedAt" IS NULL
                  AND (p."startedAt" IS NOT NULL OR p.status = $3)
             ) AS opened_any_item
        FROM track_enrollments e
        JOIN tracks t ON t.id = e."trackId"
                     AND t."deletedAt" IS NULL
                     AND t.status = ANY($4)
       WHERE e."deletedAt" IS NULL
         AND e."createdAt" >= $1
         AND e."createdAt" < $2
         AND ${this.learnerScope('e."userId"', '$5', tenantId)}
      `,
      [
        start,
        end,
        SessionItemStatus.COMPLETED,
        LEARNER_COURSE_STATUSES,
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      trackId: String(r.track_id),
      title: (r.title as string | null) ?? 'Untitled course',
      status: String(r.status ?? ''),
      totalItems: Number(r.total_items) || 0,
      openedAnyItem: r.opened_any_item === true,
      completedItems: Number(r.completed_items) || 0,
      reachedHalf: r.reached_half === true,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      daysToComplete:
        r.days_to_complete === null || r.days_to_complete === undefined
          ? null
          : Number(r.days_to_complete),
      lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at) : null,
    }));
  }

  /**
   * Every live QUIZ item in a live course, with its questions reduced to id,
   * type and position — the prompt, options and answer key never leave the
   * database.
   */
  async getQuizItems(): Promise<QuizItemRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT i.id AS item_id, i.title, i."trackId" AS track_id,
             t.title AS track_title,
             COALESCE((
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', x.q->>'id',
                          'type', x.q->>'type',
                          'position', x.ord
                        ) ORDER BY x.ord)
                 FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(i.content->'questions') = 'array'
                             THEN i.content->'questions' ELSE '[]'::jsonb END
                      ) WITH ORDINALITY AS x(q, ord)
             ), '[]'::jsonb) AS questions
        FROM track_items i
        JOIN tracks t ON t.id = i."trackId" AND t."deletedAt" IS NULL
       WHERE i."deletedAt" IS NULL
         AND i.type = $1
      `,
      [TrackItemType.QUIZ],
    );
    return rows.map((r: any) => ({
      trackItemId: String(r.item_id),
      title: (r.title as string | null) ?? 'Untitled quiz',
      trackId: String(r.track_id),
      trackTitle: (r.track_title as string | null) ?? 'Untitled course',
      questions: (Array.isArray(r.questions) ? r.questions : [])
        .filter((q: any) => q && typeof q.id === 'string')
        .map(
          (q: any): QuizQuestionMeta => ({
            id: q.id,
            type: typeof q.type === 'string' ? q.type : null,
            position: Number(q.position),
          }),
        ),
    }));
  }

  /**
   * Quiz attempts for every (quiz, learner) whose `attemptNumber = 1`
   * attempt was submitted in [start, end): all of that learner's live
   * attempts on the quiz submitted before `end` (earlier ones included, so a
   * learner who first sat the quiz before the window can be recognised and
   * left out). The per-question grading is returned for first attempts only,
   * reduced to question id + correct + graded — the LLM's feedback text and
   * the learner's answers are never selected.
   */
  async getQuizAttempts(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<QuizAttemptRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT q.id AS attempt_id, q."trackItemId" AS item_id,
             q."userId" AS user_id, q."attemptNumber" AS attempt_number,
             q."submittedAt" AS submitted_at,
             q."scorePct"::float AS score_pct, q.passed,
             CASE WHEN q."attemptNumber" = 1 THEN COALESCE((
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'questionId', g->>'questionId',
                          'correct', g->'correct',
                          'graded', g->'graded'
                        ))
                 FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(q.grading) = 'array'
                             THEN q.grading ELSE '[]'::jsonb END
                      ) g
             ), '[]'::jsonb) END AS grading
        FROM track_quiz_attempts q
        JOIN track_items i ON i.id = q."trackItemId"
                          AND i."deletedAt" IS NULL
                          AND i.type = $3
        JOIN tracks t ON t.id = i."trackId" AND t."deletedAt" IS NULL
       WHERE q."deletedAt" IS NULL
         AND q."submittedAt" IS NOT NULL
         AND q."submittedAt" < $2
         AND EXISTS (
           SELECT 1 FROM track_quiz_attempts f
            WHERE f."trackItemId" = q."trackItemId"
              AND f."userId" = q."userId"
              AND f."deletedAt" IS NULL
              AND f."attemptNumber" = 1
              AND f."submittedAt" >= $1
              AND f."submittedAt" < $2
         )
         AND ${this.learnerScope('q."userId"', '$4', tenantId)}
      `,
      [start, end, TrackItemType.QUIZ, ...(tenantId ? [tenantId] : [])],
    );
    return rows.map((r: any) => ({
      attemptId: String(r.attempt_id),
      trackItemId: String(r.item_id),
      userId: Number(r.user_id),
      attemptNumber: Number(r.attempt_number),
      submittedAt: new Date(r.submitted_at),
      scorePct:
        r.score_pct === null || r.score_pct === undefined
          ? null
          : Number(r.score_pct),
      passed: typeof r.passed === 'boolean' ? r.passed : null,
      grading: Array.isArray(r.grading)
        ? r.grading.map(
            (g: any): QuizGradingFlag => ({
              questionId: typeof g?.questionId === 'string' ? g.questionId : '',
              correct: typeof g?.correct === 'boolean' ? g.correct : null,
              graded: typeof g?.graded === 'boolean' ? g.graded : null,
            }),
          )
        : null,
    }));
  }

  /**
   * Every live ROLEPLAY item in a live course whose `completionCriteria`
   * carries a NUMERIC `minScore` — including 0 and below, which the service
   * then treats as ungated through `meetsMinimumScore`, so the rule lives in
   * one place.
   */
  async getGatedRoleplayItems(): Promise<GatedRoleplayItemRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT i.id AS item_id, i.title, i."trackId" AS track_id,
             t.title AS track_title, i."scenarioId" AS scenario_id,
             (i."completionCriteria"->>'minScore')::float AS min_score
        FROM track_items i
        JOIN tracks t ON t.id = i."trackId" AND t."deletedAt" IS NULL
       WHERE i."deletedAt" IS NULL
         AND i.type = $1
         AND jsonb_typeof(i."completionCriteria"->'minScore') = 'number'
      `,
      [TrackItemType.ROLEPLAY],
    );
    return rows.map((r: any) => ({
      trackItemId: String(r.item_id),
      title: (r.title as string | null) ?? 'Untitled roleplay',
      trackId: String(r.track_id),
      trackTitle: (r.track_title as string | null) ?? 'Untitled course',
      scenarioId:
        r.scenario_id === null || r.scenario_id === undefined
          ? null
          : Number(r.scenario_id),
      minScore: Number(r.min_score),
    }));
  }

  /**
   * Every live progress row on a ROLEPLAY item with a numeric `minScore`,
   * for learners in scope, that has at least one linked COUNTABLE session
   * (`scenario_sessions."trackItemProgressId"`; ended and completed, not a
   * preview or seed room). Each row carries its linked-session count, the
   * first session's score (by start time) and when the last one ended.
   * All-time.
   */
  async getGateProgress(tenantId?: string): Promise<GateProgressRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT p."trackItemId" AS item_id, p.status,
             p."completedAt" AS completed_at,
             p."attemptCount" AS attempt_count,
             ss.sessions, ss.first_score, ss.last_session_at
        FROM track_item_progress p
        JOIN track_items i ON i.id = p."trackItemId"
                          AND i."deletedAt" IS NULL
                          AND i.type = $1
                          AND jsonb_typeof(i."completionCriteria"->'minScore') = 'number'
        JOIN tracks t ON t.id = i."trackId" AND t."deletedAt" IS NULL
        JOIN track_enrollments e ON e.id = p."trackEnrollmentId"
                                AND e."deletedAt" IS NULL
        JOIN LATERAL (
          SELECT COUNT(*)::int AS sessions,
                 (array_agg(s.score ORDER BY COALESCE(s."startedAt", s."createdAt"), s.id))[1]
                   AS first_score,
                 MAX(COALESCE(s."endedAt", s."updatedAt")) AS last_session_at
            FROM scenario_sessions s
           WHERE s."trackItemProgressId" = p.id
             AND s.status = $2
             AND s."eventStatus" = $3
             AND ${countableSessionPredicate('s')}
        ) ss ON ss.sessions > 0
       WHERE p."deletedAt" IS NULL
         AND ${this.learnerScope('p."userId"', '$4', tenantId)}
      `,
      [
        TrackItemType.ROLEPLAY,
        ScenarioSessionStatus.ENDED,
        ScenarioSessionEventStatus.COMPLETED,
        ...(tenantId ? [tenantId] : []),
      ],
    );
    return rows.map((r: any) => ({
      trackItemId: String(r.item_id),
      status: String(r.status ?? ''),
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      attemptCount: Number(r.attempt_count) || 0,
      sessions: Number(r.sessions) || 0,
      firstScore:
        r.first_score === null || r.first_score === undefined
          ? null
          : Number(r.first_score),
      lastSessionAt: r.last_session_at ? new Date(r.last_session_at) : null,
    }));
  }
}
