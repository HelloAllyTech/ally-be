import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { getPlatformDataFloor } from '../util/data-floor.util';

/** One engine's average real cost across its completed fix sessions in the window. */
export interface FixSessionEngineCostRow {
  engine: string;
  avgCostUsd: number;
  sessionCount: number;
}

/**
 * "Same job, cheaper model, here's the delta" — average
 * `bug_hunt_runs.totalTokenCostUsd` per COMPLETED fix session, split by
 * engine.
 *
 * Deliberately reads `bug_hunt_runs` directly rather than `llm_usage` the way
 * `CodingAgentCostAnalyticsRepository` does: `totalTokenCostUsd` is already
 * the exact number the run-history table's own "Est. cost" column shows, so
 * this stays consistent with what an admin sees elsewhere rather than
 * re-deriving a second estimate that could disagree with it.
 *
 * `trigger = 'fix_session'` excludes sweeps (a different, broader kind of
 * run this comparison was never about) and `status = 'completed'` excludes
 * a run that got stuck, was skipped, or is still open — none of those have a
 * real, finished cost to compare. `engine IS NOT NULL` excludes runs from
 * before engine tracking existed, which would otherwise silently join
 * neither bucket.
 */
@Injectable()
export class FixSessionEngineCostAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Same measurement every sibling cost tab uses for its "all time" left edge. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getAvgCostByEngine(
    start: Date,
    end: Date,
  ): Promise<FixSessionEngineCostRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        r.engine                           AS "engine",
        AVG(r."totalTokenCostUsd")::numeric AS "avgCostUsd",
        COUNT(*)::int                       AS "sessionCount"
      FROM bug_hunt_runs r
      WHERE r.trigger = 'fix_session'
        AND r.status = 'completed'
        AND r.engine IS NOT NULL
        AND r."createdAt" >= $1
        AND r."createdAt" < $2
      GROUP BY r.engine
      ORDER BY r.engine
      `,
      [start, end],
    );

    return rows.map((r: Record<string, unknown>) => ({
      engine: r.engine as string,
      avgCostUsd: Number(r.avgCostUsd) || 0,
      sessionCount: Number(r.sessionCount) || 0,
    }));
  }
}
