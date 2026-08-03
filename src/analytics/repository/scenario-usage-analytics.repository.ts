import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

export interface ScenarioUsageRow {
  scenarioId: number;
  title: string;
  sessionCount: number;
}

/**
 * Platform-wide scenario usage, for the Testing tab — "which scenarios do
 * learners actually practise, across every tenant?".
 *
 * A tenant-scoped sibling of this exact question already exists
 * (`TenantAnalyticsRepository.getMostUsedSimulations`, behind
 * `v1/tenant-analytics/organization-metrics`), but it is windowed, mandatorily
 * tenant-scoped, and consumed only by the tenant-admin `ally-helpline-dashboard`
 * app. This repository answers the platform-wide version for super-admins:
 * all-time (matching every other Testing-tab endpoint), across every
 * non-test tenant, with an optional single-tenant narrowing for debugging.
 *
 * No `MIN_ORG_GROUP_SIZE`-style privacy floor here — that convention exists
 * because a per-org or per-person breakdown can re-identify a small group;
 * ranking scenarios by session count names a piece of content, not a person
 * or an account, so it does not apply.
 *
 * Scenario titles are read even for soft-deleted scenarios (`scenarios` has
 * `deletedAt`, a `DeleteDateColumn`) — a scenario removed after being widely
 * used should not vanish from a historical usage ranking.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL, quoted
 * camelCase identifiers (`tenant_id` excepted), counts `::int`,
 * `excludeTestTenants`/`countableSessionPredicate` applied so "a completed
 * simulation" is the same fact here as everywhere else on this surface.
 */
@Injectable()
export class ScenarioUsageAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async getRanked(
    direction: 'ASC' | 'DESC',
    limit: number,
    tenantId?: string,
  ): Promise<ScenarioUsageRow[]> {
    const params: unknown[] = [ScenarioSessionEventStatus.COMPLETED];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('s."tenant_id"', tenantPlaceholder)}`
      : '';
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const rows = await this.dataSource.query(
      `
      SELECT
        s."scenarioId"        AS "scenarioId",
        sc.title               AS "title",
        COUNT(*)::int           AS "sessionCount"
      FROM scenario_sessions s
      JOIN scenarios sc ON sc.id = s."scenarioId"
      WHERE s."eventStatus" = $1
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}
      GROUP BY s."scenarioId", sc.title
      ORDER BY "sessionCount" ${direction}
      LIMIT ${limitPlaceholder}
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      scenarioId: Number(r.scenarioId),
      title: (r.title as string | null) ?? `Scenario #${r.scenarioId}`,
      sessionCount: Number(r.sessionCount) || 0,
    }));
  }

  /** Top `limit` scenarios by all-time completed-session count, most-used first. */
  getMostUsed(limit: number, tenantId?: string): Promise<ScenarioUsageRow[]> {
    return this.getRanked('DESC', limit, tenantId);
  }

  /**
   * Bottom `limit` scenarios by all-time completed-session count, among
   * scenarios with >=1 completed session — a scenario nobody has ever
   * completed has no row to rank (an `INNER JOIN` group-by cannot produce
   * one), so this is "least-used of the used", not "unused scenarios".
   */
  getLeastUsed(limit: number, tenantId?: string): Promise<ScenarioUsageRow[]> {
    return this.getRanked('ASC', limit, tenantId);
  }
}
