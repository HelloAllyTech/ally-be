import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  OrgEnrolmentRow,
  OrgTenant,
} from '../util/effectiveness-orgs.util';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
} from '../util/test-tenant.util';

/**
 * Reads what the org effectiveness scorecard (EFF-90, AAQ-232) and the cost
 * per improved learner (EFF-61, AAQ-218) need beyond the scored cuts — which
 * come from `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts`
 * (rubric-pinned, test orgs excluded), read once for every org.
 *
 *  - the org list (live, non-test tenants) the cut tenants resolve against;
 *  - course enrolments started / completed, grouped by the LEARNER's raw
 *    `users.tenant_id` (uuid or code — resolved to an org in TypeScript, so
 *    both spellings land on one row), as course impact scopes enrolments;
 *  - the learners whose sessions incurred learner-caused AI spend in a window.
 *
 * Raw SQL over tables BY NAME, quoted camelCase columns (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively. No tenant id is ever
 * interpolated: these reads are platform-wide and the org attribution happens
 * in `effectiveness-orgs.util`.
 */
@Injectable()
export class EffectivenessOrgsAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Live, non-test orgs. `tenants.id` is a real uuid; the shared exclusion
   * predicate is applied to it anyway, so "whose data counts?" keeps exactly
   * one answer in the codebase.
   */
  async getOrgs(): Promise<OrgTenant[]> {
    const rows = await this.dataSource.query(
      `
      SELECT t.id::text AS id, t.name, t.code
        FROM tenants t
       WHERE t."deletedAt" IS NULL
         AND ${excludeTestTenants('t.id')}
       ORDER BY t.name, t.id
      `,
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      name: (r.name as string | null) ?? 'Unnamed organisation',
      code: (r.code as string | null) || null,
    }));
  }

  /**
   * Started and completed enrolments per raw `users.tenant_id`.
   *
   * Started = the learner opened or completed at least one item
   * (`track_item_progress.startedAt`/`completedAt`), or the enrolment has
   * completed items or a `completedAt` — NOT `track_enrollments.startedAt`,
   * which enrolling writes immediately. Live enrolments in live courses only;
   * test orgs excluded through the learner, because `track_enrollments` has a
   * nullable tenant column of its own.
   */
  async getEnrolmentCounts(): Promise<OrgEnrolmentRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH enrolments AS (
        SELECT e."userId" AS user_id,
               (e."completedAt" IS NOT NULL) AS completed,
               (e."completedAt" IS NOT NULL
                 OR e."completedItems" > 0
                 OR EXISTS (
                   SELECT 1 FROM track_item_progress p
                    WHERE p."trackEnrollmentId" = e.id
                      AND p."deletedAt" IS NULL
                      AND (p."startedAt" IS NOT NULL OR p."completedAt" IS NOT NULL)
                 )) AS started
          FROM track_enrollments e
          JOIN tracks t ON t.id = e."trackId" AND t."deletedAt" IS NULL
         WHERE e."deletedAt" IS NULL
           AND ${excludeTestTenantsByUser('e."userId"')}
      )
      SELECT u."tenant_id" AS tenant_ref,
             COUNT(*) FILTER (WHERE en.started)::int AS started,
             COUNT(*) FILTER (WHERE en.started AND en.completed)::int AS completed,
             COUNT(DISTINCT en.user_id) FILTER (WHERE en.started)::int AS learners_started
        FROM enrolments en
        JOIN users u ON u.id = en.user_id
       GROUP BY u."tenant_id"
      `,
    );
    return rows.map((r: any) => ({
      tenantRef: (r.tenant_ref as string | null) ?? null,
      started: Number(r.started) || 0,
      completed: Number(r.completed) || 0,
      learnersStarted: Number(r.learners_started) || 0,
    }));
  }

  /**
   * Distinct learners (`scenario_sessions."counselorId"`) behind the
   * session-tagged `llm_usage` rows of the given learner-caused `tasks` in
   * `[start, endExclusive)` — the same tasks and window as the spend numerator.
   * Untagged calls (quiz grading, memory folds) cannot name a learner, so this
   * is a lower bound. Test orgs excluded on both the usage row and the session.
   */
  async getLearnersWithSpend(
    start: Date,
    endExclusive: Date,
    tasks: readonly string[],
  ): Promise<number> {
    if (tasks.length === 0) return 0;
    const [row] = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT s."counselorId")::int AS learners
        FROM llm_usage lu
        JOIN scenario_sessions s ON s.id = lu."scenarioSessionId"
       WHERE lu."occurredAt" >= $1
         AND lu."occurredAt" < $2
         AND lu.task = ANY($3::text[])
         AND s."counselorId" IS NOT NULL
         AND ${excludeTestTenants('lu."tenant_id"')}
         AND ${excludeTestTenants('s."tenant_id"')}
      `,
      [start, endExclusive, [...tasks]],
    );
    return Number(row?.learners ?? 0) || 0;
  }
}
