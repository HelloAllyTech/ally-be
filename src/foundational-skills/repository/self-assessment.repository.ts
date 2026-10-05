import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';
import { SelfAssessmentTrigger } from '../enum/self-assessment.enum';
import { LastSelfAssessment } from '../util/self-assessment-due.util';

/** Anything that can run a parameterised query: the DataSource or a transaction's manager. */
export interface QueryRunnerLike {
  query(sql: string, params?: unknown[]): Promise<any>;
}

/**
 * First key of the two-key advisory lock that serialises one learner's
 * submits, so a double-tapped submit cannot pass the due check twice. The
 * second key is the user id. Arbitrary but fixed; the migration's timestamp
 * prefix keeps it from colliding with another feature's namespace.
 */
export const SELF_ASSESSMENT_LOCK_NAMESPACE = 1975710;

export interface NewSelfAssessment {
  userId: number;
  tenantId: string;
  instrumentVersion: string;
  trigger: SelfAssessmentTrigger;
  triggerRef: string | null;
  responses: Record<string, number>;
  answeredAt: Date;
}

/**
 * The learner-side reads and the one write of `learner_self_assessments`, plus
 * the two facts the due rule needs from elsewhere: the learner's scored-cut
 * count (the foundational-skills measure, one rubric version) and their latest
 * course completion. The analytics read side lives in
 * src/analytics/repository/self-efficacy-analytics.repository.ts.
 *
 * Nothing here filters test organisations: a learner in a test org is asked
 * like anyone else (that is how the flow gets tested), and the analytics drop
 * them at read time.
 */
@Injectable()
export class SelfAssessmentRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The learner's most recent answer (including a dismissal), or null. */
  async findLast(
    userId: number,
    runner: QueryRunnerLike = this.dataSource,
  ): Promise<LastSelfAssessment | null> {
    const [row] = await runner.query(
      `
      SELECT x."answeredAt" AS answered_at, x."trigger" AS trigger,
             x."triggerRef" AS trigger_ref
        FROM learner_self_assessments x
       WHERE x."userId" = $1
       ORDER BY x."answeredAt" DESC, x."createdAt" DESC
       LIMIT 1
      `,
      [userId],
    );
    if (!row) return null;
    return {
      answeredAt: new Date(row.answered_at),
      trigger: String(row.trigger),
      triggerRef: (row.trigger_ref as string | null) ?? null,
    };
  }

  /**
   * The learner's scored cuts under `rubricVersion` — `SCORED` with a
   * composite, the same definition every analytics read uses. `closedBy`
   * counts only cuts that had closed by then (the count as it stood at a past
   * answer).
   */
  async countScoredCuts(
    userId: number,
    rubricVersion: string,
    closedBy?: Date,
    runner: QueryRunnerLike = this.dataSource,
  ): Promise<number> {
    const closedFilter = closedBy
      ? `\n         AND c."closedSessionEndedAt" <= $4`
      : '';
    const [row] = await runner.query(
      `
      SELECT COUNT(*)::int AS n
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
       WHERE c."userId" = $1
         AND a."rubricVersion" = $2
         AND a.status = $3
         AND a."compositeScore" IS NOT NULL${closedFilter}
      `,
      closedBy
        ? [userId, rubricVersion, FhsAssessmentStatus.SCORED, closedBy]
        : [userId, rubricVersion, FhsAssessmentStatus.SCORED],
    );
    return Number(row?.n ?? 0);
  }

  /**
   * The learner's most recent course completion strictly after `since` (any
   * completion when `since` is null). Soft-deleted enrollments do not count.
   */
  async latestCourseCompletionSince(
    userId: number,
    since: Date | null,
    runner: QueryRunnerLike = this.dataSource,
  ): Promise<{ trackId: string; completedAt: Date } | null> {
    const sinceFilter = since ? `\n         AND e."completedAt" > $2` : '';
    const [row] = await runner.query(
      `
      SELECT e."trackId"::text AS track_id, e."completedAt" AS completed_at
        FROM track_enrollments e
       WHERE e."userId" = $1
         AND e."completedAt" IS NOT NULL
         AND e."deletedAt" IS NULL${sinceFilter}
       ORDER BY e."completedAt" DESC
       LIMIT 1
      `,
      since ? [userId, since] : [userId],
    );
    if (!row) return null;
    return {
      trackId: String(row.track_id),
      completedAt: new Date(row.completed_at),
    };
  }

  /** Serialise this learner's submits until the surrounding transaction ends. */
  async lockLearner(userId: number, runner: QueryRunnerLike): Promise<void> {
    await runner.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
      SELF_ASSESSMENT_LOCK_NAMESPACE,
      userId,
    ]);
  }

  async insert(
    row: NewSelfAssessment,
    runner: QueryRunnerLike = this.dataSource,
  ): Promise<{ id: string; answeredAt: Date }> {
    const [inserted] = await runner.query(
      `
      INSERT INTO learner_self_assessments
        ("tenant_id", "userId", "instrumentVersion", "trigger", "triggerRef",
         "responses", "answeredAt")
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING id, "answeredAt" AS answered_at
      `,
      [
        row.tenantId,
        row.userId,
        row.instrumentVersion,
        row.trigger,
        row.triggerRef,
        JSON.stringify(row.responses),
        row.answeredAt,
      ],
    );
    return {
      id: String(inserted.id),
      answeredAt: new Date(inserted.answered_at),
    };
  }
}
