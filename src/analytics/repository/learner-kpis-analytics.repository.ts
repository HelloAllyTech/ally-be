import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

export interface LearnerActivitySummary {
  /** Distinct LEARNER-role accounts with >=1 completed session, all-time. */
  activeLearners: number;
  /** Completed sessions attributed to LEARNER-role accounts, all-time. */
  totalCompletedSessions: number;
}

/** One calendar month's LEARNER-role signups, all-time (oldest first). */
export interface LearnerSignupMonthRow {
  /** First day of the calendar month, `yyyy-mm-01`. */
  month: string;
  newLearners: number;
}

/**
 * LEARNER-role-scoped counterparts of the platform overview's headline KPIs
 * (`totalUsers`, `activeUsers`, `simulationsCompleted`, `newUsers`), for the
 * Testing tab.
 *
 * Every one of those existing KPIs counts every `users` row unconditionally —
 * confirmed by reading `PlatformAnalyticsRepository.getTotalUsers` /
 * `getNewUsersByBucket` / `getActiveUserCountSince` — so an admin/counsellor
 * account moves the same numbers a learner does. This repository answers the
 * same four questions filtered to the LEARNER role, so "how are our learners
 * doing" stops being diluted by the accounts running the platform.
 *
 * All-time by design, matching every other Testing-tab endpoint (`org-health`,
 * `competency-map`, `roleplay-volume`) — the tab hides the page-level range
 * picker (`Analytics.tsx` TABS registry, `testing` entry: `uses.range: false`),
 * so a windowed query here would silently ignore a picker the reader can see
 * is absent for every other panel on the page.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over
 * tables BY NAME, quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int`, `excludeTestTenants`/`countableSessionPredicate`
 * applied to every activity table so "a completed simulation" stays the exact
 * same definition here as on the volume charts beside it.
 */
@Injectable()
export class LearnerKpisAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * `activeLearners` and `totalCompletedSessions` in one pass: both are
   * aggregates over the same LEARNER-role, non-test-tenant session set, so
   * computing them separately would mean scanning `scenario_sessions` twice
   * for numbers that have to reconcile with each other.
   */
  async getActivitySummary(tenantId?: string): Promise<LearnerActivitySummary> {
    const params: unknown[] = [
      UserRole.LEARNER,
      ScenarioSessionEventStatus.COMPLETED,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('u."tenant_id"', tenantPlaceholder)}`
      : '';

    const rows = await this.dataSource.query(
      `
      WITH learners AS (
        SELECT u.id AS user_id
        FROM users u
        WHERE EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $1
              )
          AND ${excludeTestTenants('u."tenant_id"')}
          ${tenantPredicate}
      )
      SELECT
        COUNT(DISTINCT s."counselorId")::int AS "activeLearners",
        COUNT(*)::int                        AS "totalCompletedSessions"
      FROM scenario_sessions s
      JOIN learners l ON l.user_id = s."counselorId"
      WHERE s."eventStatus" = $2
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
      `,
      params,
    );

    const row = rows[0] ?? {};
    return {
      activeLearners: Number(row.activeLearners) || 0,
      totalCompletedSessions: Number(row.totalCompletedSessions) || 0,
    };
  }

  /**
   * LEARNER-role signups per calendar month, all-time, oldest first. Same
   * shape and same reasoning as
   * `UsageLevelAnalyticsRepository.getLearnerSignupsByMonth` (all-time, not
   * windowed, `deletedAt` deliberately not filtered since `users` has no such
   * column) — kept as its own query here rather than a cross-repository call
   * so this repository has no dependency on the usage-levels feature's
   * lifecycle.
   */
  async getSignupsByMonth(tenantId?: string): Promise<LearnerSignupMonthRow[]> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('u."tenant_id"', tenantPlaceholder)}`
      : '';

    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(date_trunc('month', u."createdAt"), 'YYYY-MM-DD') AS "month",
        COUNT(*)::int AS "newLearners"
      FROM users u
      WHERE EXISTS (
              SELECT 1 FROM user_groups ug
              JOIN groups g ON g.id = ug."groupId"
              WHERE ug."userId" = u.id AND g.name = $1
            )
        AND ${excludeTestTenants('u."tenant_id"')}
        ${tenantPredicate}
      GROUP BY month
      ORDER BY month ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      month: String(r.month),
      newLearners: Number(r.newLearners) || 0,
    }));
  }
}
