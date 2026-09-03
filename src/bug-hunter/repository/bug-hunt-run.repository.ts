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
        AND r.status <> 'skipped_disabled'
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
