import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
/** One (day, trigger) cell of run spend — see `dailyTokens`. */
export interface DailyRunTokens {
  /** Calendar day, `YYYY-MM-DD`, in the database's clock (UTC). */
  day: string;
  trigger: BugHuntTrigger;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  /** The CLI's own figure where a run reported one, else the token estimate. */
  costUsd: number;
}

@Injectable()
export class BugHuntRunRepository extends Repository<BugHuntRun> {
  constructor(dataSource: DataSource) {
    super(BugHuntRun, dataSource.createEntityManager());
  }

  /** Run history, newest first — the admin tab's table. */
  /** Every run still marked RUNNING, oldest first — the reconcile task's input. */
  listRunning(): Promise<BugHuntRun[]> {
    return this.find({
      where: { status: BugHuntRunStatus.RUNNING },
      order: { createdAt: 'ASC' },
    });
  }

  listRecent(limit: number): Promise<BugHuntRun[]> {
    return this.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * Tokens and cost per calendar day and trigger — the Spend-over-time card
   * on Analytics → Bug Agent, which folds these day cells into days, weeks
   * or months on the client.
   *
   * Grouped by trigger rather than by phase because that is the only split
   * the table can honestly make: in Works-solo mode a sweep discovers,
   * verifies AND fixes in one run, so its tokens cannot be attributed to
   * finding versus fixing. Cost prefers the CLI's own figure over the token
   * estimate, which prices prompt-cache reads at full rate and overstates a
   * cache-heavy run. Skipped runs spend nothing and are left out, so a quiet
   * night is a zero rather than a row.
   */
  async dailyTokens(since: Date): Promise<DailyRunTokens[]> {
    const rows = await this.manager.query<
      Array<{
        day: string;
        trigger: BugHuntTrigger;
        runs: string;
        input_tokens: string | null;
        output_tokens: string | null;
        cost_usd: string | null;
      }>
    >(
      `
      SELECT
        to_char(r."createdAt", 'YYYY-MM-DD') AS day,
        r.trigger AS trigger,
        COUNT(*) AS runs,
        COALESCE(SUM(r."totalInputTokens"), 0) AS input_tokens,
        COALESCE(SUM(r."totalOutputTokens"), 0) AS output_tokens,
        COALESCE(SUM(COALESCE(
          NULLIF((r.metadata->>'cliReportedCostUsd'), '')::numeric,
          r."totalTokenCostUsd"
        )), 0) AS cost_usd
      FROM bug_hunt_runs r
      WHERE r."createdAt" >= $1
        AND r.status NOT IN ('skipped_disabled', 'skipped_quiet')
      GROUP BY 1, 2
      ORDER BY 1 ASC
      `,
      [since],
    );
    return rows.map((row) => ({
      day: row.day,
      trigger: row.trigger,
      runs: Number(row.runs),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
    }));
  }
  /**
   * How much of the repo runs in the window were shown, averaged over the runs
   * that said — see `BugHunterTelemetryService.recordContext`, which writes
   * `metadata.breadth`. Runs that never reported (older sweeps, fix sessions,
   * a sweep that died before Discover finished) are excluded from every
   * average rather than counted as zero, and `runsReporting` says how many
   * the averages stand on.
   */
  async breadthStats(since: Date): Promise<{
    runsReporting: number;
    avgFilesInScope: number | null;
    avgLinesInScope: number | null;
    avgCommits: number | null;
    avgPackChars: number | null;
    deepShare: number | null;
  }> {
    const [row] = await this.manager.query<
      Array<{
        runs: string;
        avg_files: string | null;
        avg_lines: string | null;
        avg_commits: string | null;
        avg_pack: string | null;
        deep_runs: string;
      }>
    >(
      `
      SELECT
        COUNT(*) AS runs,
        AVG(NULLIF(r.metadata->'breadth'->>'filesInScope', '')::numeric) AS avg_files,
        AVG(NULLIF(r.metadata->'breadth'->>'linesInScope', '')::numeric) AS avg_lines,
        AVG(NULLIF(r.metadata->'breadth'->>'commits', '')::numeric) AS avg_commits,
        AVG(NULLIF(r.metadata->'breadth'->>'packChars', '')::numeric) AS avg_pack,
        COUNT(*) FILTER (WHERE (r.metadata->'breadth'->>'deep')::boolean IS TRUE) AS deep_runs
      FROM bug_hunt_runs r
      WHERE r."createdAt" >= $1
        AND r.metadata ? 'breadth'
      `,
      [since],
    );

    const runs = Number(row?.runs ?? 0);
    const num = (value: string | null | undefined): number | null =>
      value === null || value === undefined ? null : Number(value);
    return {
      runsReporting: runs,
      avgFilesInScope: num(row?.avg_files),
      avgLinesInScope: num(row?.avg_lines),
      avgCommits: num(row?.avg_commits),
      avgPackChars: num(row?.avg_pack),
      deepShare: runs === 0 ? null : Number(row?.deep_runs ?? 0) / runs,
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
