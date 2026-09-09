import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsXpGoal } from '../entity/analytics-xp-goal.entity';
import { XpGoalGrain } from '../dto/goals-xp-analytics.dto';

export interface ActualXpRow {
  periodStart: string;
  actualXp: number;
}

@Injectable()
export class GoalsXpAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** XP earned per period, from the same ledger as xp-growth. Test tenants excluded. */
  async getActualXpByPeriod(
    grain: XpGoalGrain,
    start: Date,
    endExclusive: Date,
  ): Promise<ActualXpRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT to_char(date_trunc($1, e."awardedOn"), 'YYYY-MM-DD') AS "periodStart",
             COALESCE(SUM(e."xp"), 0)::bigint AS "actualXp"
      FROM xp_events e
      WHERE e."awardedOn" >= $2 AND e."awardedOn" < $3
        AND ${excludeTestTenants('e."tenant_id"')}
      GROUP BY 1
      ORDER BY 1
      `,
      [grain, start, endExclusive],
    );

    return (rows as { periodStart: string; actualXp: string }[]).map((r) => ({
      periodStart: r.periodStart,
      actualXp: Number(r.actualXp) || 0,
    }));
  }

  /** Every goal row for a grain, keyed by periodStart (yyyy-mm-dd). Table is small — read whole. */
  async getGoalsByGrain(grain: XpGoalGrain): Promise<Map<string, number>> {
    const rows = await this.dataSource
      .getRepository(AnalyticsXpGoal)
      .find({ where: { grain } });
    return new Map(rows.map((r) => [r.periodStart, Number(r.targetXp)]));
  }
}
