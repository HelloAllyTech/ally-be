import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';

@Injectable()
export class BugHuntRunRepository extends Repository<BugHuntRun> {
  constructor(dataSource: DataSource) {
    super(BugHuntRun, dataSource.createEntityManager());
  }

  /** Run history, newest first — the admin tab's table. */
  listRecent(limit: number): Promise<BugHuntRun[]> {
    return this.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * What every run in the window actually cost, and how many there were.
   *
   * Server-side and un-truncated, which is the point of it. The tab's existing
   * scorecard sums cost in the browser over `listRecent`'s newest 50, so a
   * 30-day total silently becomes a floor the moment the platform runs more
   * than 50 shifts a month — five repos nightly plus fix sessions passes that
   * in under two weeks, and it under-reports precisely when the agent has been
   * busiest.
   *
   * `cliReportedCostUsd` is preferred over `totalTokenCostUsd` for the same
   * reason `RunHistoryTable.formatCost` prefers it: the token estimate prices
   * prompt-cache reads at full rate and overstates a cache-heavy run.
   */
  async costInWindow(since: Date): Promise<{
    costUsd: number;
    runs: number;
    /** Fix-session runs only — the denominator for cost per merged fix. */
    fixSessionRuns: number;
    fixSessionCostUsd: number;
  }> {
    const [row] = await this.manager.query<
      Array<{
        cost_usd: string | null;
        runs: string;
        fix_runs: string;
        fix_cost_usd: string | null;
      }>
    >(
      `
      SELECT
        COALESCE(SUM(COALESCE(
          NULLIF((r.metadata->>'cliReportedCostUsd'), '')::numeric,
          r."totalTokenCostUsd"
        )), 0) AS cost_usd,
        COUNT(*) AS runs,
        COUNT(*) FILTER (WHERE r.trigger = 'fix_session') AS fix_runs,
        COALESCE(SUM(COALESCE(
          NULLIF((r.metadata->>'cliReportedCostUsd'), '')::numeric,
          r."totalTokenCostUsd"
        )) FILTER (WHERE r.trigger = 'fix_session'), 0) AS fix_cost_usd
      FROM bug_hunt_runs r
      WHERE r."createdAt" >= $1
        AND r.status NOT IN ('skipped_disabled', 'skipped_quiet')
      `,
      [since],
    );

    return {
      costUsd: Number(row?.cost_usd ?? 0),
      runs: Number(row?.runs ?? 0),
      fixSessionRuns: Number(row?.fix_runs ?? 0),
      fixSessionCostUsd: Number(row?.fix_cost_usd ?? 0),
    };
  }

  /**
   * `costInWindow`'s same figures, plus a per-status count, bucketed by
   * calendar week — the raw material for cost, fix-throughput, and
   * reliability trend charts. One query rather than three: cost, the
   * fix-session-run denominator (for escalation/fallback rates), and
   * completion-status counts (for run-completion-rate) all group on the same
   * (week, trigger, status) cells.
   */
  async weeklyRunStats(
    start: Date,
    end: Date,
  ): Promise<
    Array<{
      week: Date;
      trigger: string;
      status: string;
      runs: number;
      costUsd: number;
    }>
  > {
    const rows = await this.manager.query<
      Array<{
        week: Date;
        trigger: string;
        status: string;
        runs: string;
        cost_usd: string | null;
      }>
    >(
      `
      SELECT
        date_trunc('week', r."createdAt") AS week,
        r.trigger AS trigger,
        r.status AS status,
        COUNT(*) AS runs,
        COALESCE(SUM(COALESCE(
          NULLIF((r.metadata->>'cliReportedCostUsd'), '')::numeric,
          r."totalTokenCostUsd"
        )), 0) AS cost_usd
      FROM bug_hunt_runs r
      WHERE r."createdAt" >= $1
        AND r."createdAt" < $2
        AND r.status NOT IN ('skipped_disabled', 'skipped_quiet')
      GROUP BY week, r.trigger, r.status
      ORDER BY week
      `,
      [start, end],
    );
    return rows.map((row) => ({
      week: row.week,
      trigger: row.trigger,
      status: row.status,
      runs: Number(row.runs),
      costUsd: Number(row.cost_usd ?? 0),
    }));
  }

  /**
   * Bug Hunter's own first run — the "all time" floor for its trend charts.
   * Deliberately not the platform-wide `getPlatformDataFloor` (which measures
   * from the first `users`/`scenario_sessions` row): that predates Bug Hunter
   * entirely, which would stretch an all-time window back through years of
   * guaranteed-empty weeks.
   */
  async getDataFloor(): Promise<Date> {
    const [row] = await this.manager.query<Array<{ floor: Date | null }>>(
      `SELECT MIN("createdAt") AS floor FROM bug_hunt_runs`,
    );
    return row?.floor ?? new Date();
  }

  /**
   * The last COMPLETED run for a repo, regardless of trigger — the nightly
   * sweep's diff-scoping reads its `createdAt` as "changed since here" so a
   * skipped/failed run never resets the diff window back to the beginning.
   */
  findLastCompleted(repo: string): Promise<BugHuntRun | null> {
    return this.findOne({
      where: { repo, status: 'completed' as BugHuntRun['status'] },
      order: { createdAt: 'DESC' },
    });
  }
}
