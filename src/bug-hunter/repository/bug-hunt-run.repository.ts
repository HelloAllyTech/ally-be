import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntTrigger } from '../enum/bug-hunt-run.enum';

/** One (day, trigger) cell of run spend — see `dailyTokens`. */
export interface DailyRunTokens {
  /** Calendar day, `YYYY-MM-DD`, in the database's clock (UTC). */
  day: string;
  trigger: BugHuntTrigger;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * Code-scope breadth, summed over the runs that reported it — the
   * `metadata.breadth` object a sweep posts after Discover (see
   * BugHunterTelemetryService.recordContext). `breadthRuns` says how many of
   * `runs` reported anything: telemetry shipped on 2026-09-23 and fix sessions
   * never post breadth, so a day can have runs and no breadth, which is "not
   * recorded", not zero.
   */
  breadthRuns: number;
  linesInScope: number;
  filesInScope: number;
  commits: number;
  deepRuns: number;
}

/** One model's share of the window's spend — see `tokensByModel`. */
export interface ModelTokens {
  model: string;
  provider: string;
  /** Distinct runs that used this model at all. */
  runs: number;
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache reads, a subset of `inputTokens`. */
  cacheReadTokens: number;
}

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
   * Tokens per calendar day and trigger — the operations panel's
   * "what the models cost me, day by day".
   *
   * Grouped by trigger rather than by phase because that is the only split
   * the table can honestly make: in Works-solo mode a sweep discovers,
   * verifies AND fixes in one run, so its tokens cannot be attributed to
   * finding versus fixing. The panel says so. Skipped runs spend nothing and
   * are left out, so a quiet night is a zero rather than a row.
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
        breadth_runs: string;
        lines_in_scope: string | null;
        files_in_scope: string | null;
        commits: string | null;
        deep_runs: string;
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
        )), 0) AS cost_usd,
        COUNT(*) FILTER (WHERE r.metadata ? 'breadth') AS breadth_runs,
        COALESCE(SUM(NULLIF(r.metadata->'breadth'->>'linesInScope', '')::numeric), 0) AS lines_in_scope,
        COALESCE(SUM(NULLIF(r.metadata->'breadth'->>'filesInScope', '')::numeric), 0) AS files_in_scope,
        COALESCE(SUM(NULLIF(r.metadata->'breadth'->>'commits', '')::numeric), 0) AS commits,
        COUNT(*) FILTER (WHERE (r.metadata->'breadth'->>'deep')::boolean IS TRUE) AS deep_runs
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
      breadthRuns: Number(row.breadth_runs ?? 0),
      linesInScope: Number(row.lines_in_scope ?? 0),
      filesInScope: Number(row.files_in_scope ?? 0),
      commits: Number(row.commits ?? 0),
      deepRuns: Number(row.deep_runs ?? 0),
    }));
  }

  /**
   * Tokens per model over the window, from the per-model `llm_usage` rows the
   * CI runner reports after each run (`BugHunterService.recordActualCost`).
   *
   * Read from `llm_usage` rather than `bug_hunt_runs.model`: a run's column
   * names the model it was DISPATCHED on, but one run spends across several —
   * the sweep on the default tier, escalations on the reasoning tier, and
   * subagents on whichever the engine chose — and only the usage rows carry
   * that split. Windowed on the run's own `createdAt` (not the usage row's),
   * so this and `dailyTokens` describe the same set of runs.
   */
  async tokensByModel(since: Date): Promise<ModelTokens[]> {
    const rows = await this.manager.query<
      Array<{
        model: string;
        provider: string;
        runs: string;
        input_tokens: string | null;
        output_tokens: string | null;
        cache_read_tokens: string | null;
      }>
    >(
      `
      SELECT
        lu.model AS model,
        lu.provider AS provider,
        COUNT(DISTINCT lu.metadata->>'runId') AS runs,
        COALESCE(SUM(lu."promptTokens"), 0) AS input_tokens,
        COALESCE(SUM(lu."completionTokens"), 0) AS output_tokens,
        COALESCE(SUM(lu."cachedTokens"), 0) AS cache_read_tokens
      FROM llm_usage lu
      JOIN bug_hunt_runs r ON r.id::text = lu.metadata->>'runId'
      WHERE lu.task = $2
        AND r."createdAt" >= $1
      GROUP BY 1, 2
      ORDER BY COALESCE(SUM(lu."promptTokens"), 0) + COALESCE(SUM(lu."completionTokens"), 0) DESC
      `,
      [since, LlmTask.BUG_HUNTER],
    );
    return rows.map((row) => ({
      model: row.model,
      provider: row.provider,
      runs: Number(row.runs),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    }));
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
