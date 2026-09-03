import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';

/**
 * The scoreboard: is Builder getting better?
 *
 * This is the benchmark, in production form. A replayable offline eval corpus
 * would be a different and larger thing; what makes this one worth having is
 * that the tasks are real builds and the ground truth is what humans actually
 * did with the pull requests — merged, closed, or merged after four rounds of
 * corrections.
 *
 * Deliberately few metrics. The temptation is to expose everything the tables
 * hold, but a dashboard nobody can read is a dashboard nobody checks: these are
 * the ones that move when Builder genuinely improves or regresses.
 *
 *  - **merge rate** — the only real definition of "it worked".
 *  - **fix runs per build** — how much correction the work needed after it was
 *    called finished. Falls when planning and verification get better.
 *  - **review comments per build** — how much human attention it costs.
 *  - **cost per merged build** — not cost per build: a cheap build nobody
 *    merges is not cheap, it is wasted.
 *  - **time to merge** — how long a human sat on it, which is a proxy for how
 *    reviewable the output was.
 *  - **failure tags** — where the losses come from, so effort has a target.
 *
 * All SQL, no new tables: the exemplar bank already holds every fact this
 * needs, and a metrics table would be a second copy to keep in step.
 */
@Injectable()
export class BuilderMetricsService {
  private readonly logger = LoggerService.getInstance(
    BuilderMetricsService.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  async scoreboard(windowDays = 30): Promise<BuilderScoreboard> {
    const days = Math.min(365, Math.max(7, Math.floor(windowDays) || 30));

    const [builds, trends, totals, tags] = await Promise.all([
      this.perBuild(days),
      this.weeklyTrends(days),
      this.totals(days),
      this.failureTagCounts(days),
    ]);

    return { windowDays: days, builds, trends, totals, failureTags: tags };
  }

  /**
   * Where a run's time and money actually go, per phase.
   *
   * The scoreboard answers "is Builder getting better"; this answers "and what
   * would make it faster". They are different questions and conflating them is
   * how you get a dashboard that shows a run took 48 minutes without a hint of
   * which 48.
   *
   * Reads `builder_build_runs.cost.phases`, which the runner writes as it goes.
   * Timings are nullable there — a run dispatched against an older workflow
   * reports cost with no durations — so every aggregate ignores nulls rather
   * than counting them as zero. A phase with no timings shows an invocation
   * count and no clock, which is the truth.
   */
  async pipelineHealth(windowDays = 30): Promise<BuilderPipelineHealth> {
    const days = Math.min(365, Math.max(7, Math.floor(windowDays) || 30));
    const [phases, gates, outcomes] = await Promise.all([
      this.phaseTimings(days),
      this.gatePassRates(days),
      this.runOutcomes(days),
    ]);
    return { windowDays: days, phases, gates, outcomes };
  }

  /**
   * One row per phase key (plan, code-1, verify-2, finalise, …).
   *
   * `apiMs` vs `wallMs` is the load-bearing pair: the gap between them is time
   * inside tool calls, which on the first real build was most of the coder's
   * wall clock and nearly all of it test suites the gate then ran again.
   */
  private async phaseTimings(days: number): Promise<BuilderPipelinePhase[]> {
    const rows = await this.dataSource.query(
      `
      SELECT phase.key                                        AS "phase",
             phase.value->>'model'                            AS "model",
             COUNT(*)::int                                    AS "invocations",
             ROUND(SUM((phase.value->>'usd')::numeric), 4)    AS "totalCostUsd",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY (phase.value->>'usd')::numeric
             )                                                AS "medianCostUsd",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY (phase.value->>'durationMs')::numeric
             )                                                AS "medianWallMs",
             PERCENTILE_CONT(0.95) WITHIN GROUP (
               ORDER BY (phase.value->>'durationMs')::numeric
             )                                                AS "p95WallMs",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY (phase.value->>'durationApiMs')::numeric
             )                                                AS "medianApiMs",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY (phase.value->>'numTurns')::numeric
             )                                                AS "medianTurns"
        FROM builder_build_runs run
        CROSS JOIN LATERAL jsonb_each(COALESCE(run.cost->'phases', '{}'::jsonb)) AS phase
       WHERE run."createdAt" >= NOW() - ($1 || ' days')::interval
       GROUP BY phase.key, phase.value->>'model'
       ORDER BY SUM((phase.value->>'usd')::numeric) DESC NULLS LAST
      `,
      [String(days)],
    );

    return rows.map((row: Record<string, any>) => ({
      phase: String(row.phase),
      model: row.model ?? null,
      invocations: Number(row.invocations ?? 0),
      totalCostUsd: this.numberOrNull(row.totalCostUsd),
      medianCostUsd: this.numberOrNull(row.medianCostUsd),
      medianWallMs: this.numberOrNull(row.medianWallMs),
      p95WallMs: this.numberOrNull(row.p95WallMs),
      medianApiMs: this.numberOrNull(row.medianApiMs),
      medianTurns: this.numberOrNull(row.medianTurns),
    }));
  }

  /**
   * How often the machine gate passes, per repo and check.
   *
   * Lint and typecheck failing often means the coder is shipping work it never
   * ran; tests failing often means the blast radius is wider than the plan saw.
   * They call for different fixes, so they are counted separately.
   */
  private async gatePassRates(days: number): Promise<BuilderPipelineGate[]> {
    const rows = await this.dataSource.query(
      `
      SELECT event.payload->>'repo'                           AS "repo",
             event.payload->>'kind'                           AS "kind",
             COUNT(*)::int                                    AS "results",
             SUM(CASE WHEN (event.payload->>'passed')::boolean
                      THEN 1 ELSE 0 END)::int                 AS "passed"
        FROM builder_build_events event
       WHERE event.type = 'gate_result'
         AND event."createdAt" >= NOW() - ($1 || ' days')::interval
         AND event.payload->>'repo' IS NOT NULL
       GROUP BY event.payload->>'repo', event.payload->>'kind'
       ORDER BY "repo", "kind"
      `,
      [String(days)],
    );

    return rows.map((row: Record<string, any>) => {
      const results = Number(row.results ?? 0);
      const passed = Number(row.passed ?? 0);
      return {
        repo: String(row.repo),
        kind: String(row.kind ?? 'unknown'),
        results,
        passed,
        passRate: results > 0 ? passed / results : null,
      };
    });
  }

  /** How runs end, by status and mode — the abandonment counter included. */
  private async runOutcomes(days: number): Promise<BuilderPipelineOutcome[]> {
    const rows = await this.dataSource.query(
      `
      SELECT run.status                                       AS "status",
             run.mode                                         AS "mode",
             COUNT(*)::int                                    AS "runs",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY run."runnerMinutes"
             )                                                AS "medianRunnerMinutes"
        FROM builder_build_runs run
       WHERE run."createdAt" >= NOW() - ($1 || ' days')::interval
       GROUP BY run.status, run.mode
       ORDER BY COUNT(*) DESC
      `,
      [String(days)],
    );

    return rows.map((row: Record<string, any>) => ({
      status: String(row.status),
      mode: String(row.mode),
      runs: Number(row.runs ?? 0),
      medianRunnerMinutes: this.numberOrNull(row.medianRunnerMinutes),
    }));
  }

  /**
   * `null` stays `null`.
   *
   * `Number(null)` is 0, and a phase with no recorded timing plotted as a
   * zero-second phase reads as "instant" rather than "not measured" — the same
   * trap that once made a week with nothing merged look like a cost win.
   */
  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * One row per archived build.
   *
   * Duration is measured from the session's first dispatch to its last run
   * completing — wall-clock the person actually waited, not the sum of run
   * times, which double-counts nothing useful and hides the pauses.
   */
  private async perBuild(days: number): Promise<BuilderScoreboardBuild[]> {
    const rows = await this.dataSource.query(
      `SELECT
         e."sessionId"                                   AS "sessionId",
         e.title                                         AS title,
         e.repos                                         AS repos,
         e."createdAt"                                   AS "createdAt",
         e.outcome                                       AS outcome,
         e."fixRunCount"                                 AS "fixRunCount",
         e."reviewCommentCount"                          AS "reviewCommentCount",
         e."ciFailureCount"                              AS "ciFailureCount",
         e."costUsd"                                     AS "costUsd",
         e."runnerMinutes"                               AS "runnerMinutes",
         e."timeToMergeHours"                            AS "timeToMergeHours",
         e."failureTags"                                 AS "failureTags",
         r.run_count                                     AS "runCount",
         EXTRACT(EPOCH FROM (r.last_completed - r.first_dispatched)) / 3600
                                                         AS "durationHours"
       FROM builder_exemplars e
       LEFT JOIN (
         SELECT "sessionId",
                COUNT(*)::int        AS run_count,
                MIN("dispatchedAt")  AS first_dispatched,
                MAX("completedAt")   AS last_completed
           FROM builder_build_runs
          GROUP BY "sessionId"
       ) r ON r."sessionId" = e."sessionId"
       WHERE e."createdAt" >= now() - ($1 || ' days')::interval
       ORDER BY e."createdAt" DESC`,
      [String(days)],
    );

    return rows.map((row: any) => ({
      sessionId: row.sessionId,
      title: row.title,
      repos: row.repos ?? [],
      createdAt: row.createdAt,
      outcome: row.outcome,
      runCount: Number(row.runCount ?? 0),
      fixRunCount: Number(row.fixRunCount ?? 0),
      reviewCommentCount: Number(row.reviewCommentCount ?? 0),
      ciFailureCount: Number(row.ciFailureCount ?? 0),
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
      runnerMinutes:
        row.runnerMinutes === null ? null : Number(row.runnerMinutes),
      durationHours:
        row.durationHours === null ? null : Number(row.durationHours),
      timeToMergeHours:
        row.timeToMergeHours === null ? null : Number(row.timeToMergeHours),
      failureTags: row.failureTags ?? [],
    }));
  }

  /**
   * The same measures by week, which is the only form in which they answer
   * the question. A merge rate of 60% is not information; a merge rate that
   * was 40% a month ago and is 60% now is.
   *
   * Medians rather than means throughout: one runaway build that cost $80
   * would drag a mean far enough to hide everything else.
   */
  private async weeklyTrends(days: number): Promise<BuilderScoreboardTrend[]> {
    const rows = await this.dataSource.query(
      `SELECT
         date_trunc('week', e."createdAt")                       AS "weekStart",
         COUNT(*)::int                                            AS builds,
         COUNT(*) FILTER (WHERE e.outcome IN ('merged', 'partially_merged'))::int
                                                                  AS merged,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e."costUsd")  AS "medianCostUsd",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e."fixRunCount")
                                                                  AS "medianFixRuns",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e."reviewCommentCount")
                                                                  AS "medianReviewComments",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e."timeToMergeHours")
                                                                  AS "medianTimeToMergeHours"
       FROM builder_exemplars e
       WHERE e."createdAt" >= now() - ($1 || ' days')::interval
       GROUP BY 1
       ORDER BY 1 ASC`,
      [String(days)],
    );

    return rows.map((row: any) => {
      const builds = Number(row.builds ?? 0);
      const merged = Number(row.merged ?? 0);
      return {
        weekStart: row.weekStart,
        builds,
        merged,
        mergeRate: builds ? Number((merged / builds).toFixed(3)) : 0,
        medianCostUsd:
          row.medianCostUsd === null ? null : Number(row.medianCostUsd),
        medianFixRuns:
          row.medianFixRuns === null ? null : Number(row.medianFixRuns),
        medianReviewComments:
          row.medianReviewComments === null
            ? null
            : Number(row.medianReviewComments),
        medianTimeToMergeHours:
          row.medianTimeToMergeHours === null
            ? null
            : Number(row.medianTimeToMergeHours),
      };
    });
  }

  private async totals(days: number): Promise<BuilderScoreboardTotals> {
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(*)::int                                            AS builds,
         COUNT(*) FILTER (WHERE outcome IN ('merged', 'partially_merged'))::int
                                                                  AS merged,
         COUNT(*) FILTER (WHERE outcome = 'closed_unmerged')::int  AS rejected,
         COUNT(*) FILTER (WHERE outcome IN ('failed', 'cancelled'))::int
                                                                  AS "neverShipped",
         COALESCE(SUM("costUsd"), 0)                              AS "totalCostUsd",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY "costUsd")    AS "medianCostUsd",
         -- Cost per *merged* build, not per build: a cheap build nobody
         -- merged is not cheap, it is wasted.
         COALESCE(SUM("costUsd") FILTER (
           WHERE outcome IN ('merged', 'partially_merged')
         ), 0)                                                    AS "mergedCostUsd"
       FROM builder_exemplars
       WHERE "createdAt" >= now() - ($1 || ' days')::interval`,
      [String(days)],
    );

    const builds = Number(row?.builds ?? 0);
    const merged = Number(row?.merged ?? 0);
    return {
      builds,
      merged,
      rejected: Number(row?.rejected ?? 0),
      neverShipped: Number(row?.neverShipped ?? 0),
      mergeRate: builds ? Number((merged / builds).toFixed(3)) : 0,
      totalCostUsd: Number(row?.totalCostUsd ?? 0),
      medianCostUsd:
        row?.medianCostUsd === null || row?.medianCostUsd === undefined
          ? null
          : Number(row.medianCostUsd),
      costPerMergedBuildUsd: merged
        ? Number((Number(row?.mergedCostUsd ?? 0) / merged).toFixed(2))
        : null,
    };
  }

  /** Where the losses come from, so effort has a target. */
  private async failureTagCounts(
    days: number,
  ): Promise<{ tag: string; count: number }[]> {
    const rows = await this.dataSource.query(
      `SELECT tag, COUNT(*)::int AS count
         FROM builder_exemplars e,
              jsonb_array_elements_text(COALESCE(e."failureTags", '[]'::jsonb)) AS tag
        WHERE e."createdAt" >= now() - ($1 || ' days')::interval
        GROUP BY tag
        ORDER BY count DESC`,
      [String(days)],
    );
    return rows.map((row: any) => ({
      tag: row.tag,
      count: Number(row.count),
    }));
  }
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

export interface BuilderScoreboardBuild {
  sessionId: string;
  title: string;
  repos: string[];
  createdAt: Date;
  outcome: string;
  runCount: number;
  fixRunCount: number;
  reviewCommentCount: number;
  ciFailureCount: number;
  costUsd: number | null;
  runnerMinutes: number | null;
  durationHours: number | null;
  timeToMergeHours: number | null;
  failureTags: string[];
}

export interface BuilderScoreboardTrend {
  weekStart: Date;
  builds: number;
  merged: number;
  mergeRate: number;
  medianCostUsd: number | null;
  medianFixRuns: number | null;
  medianReviewComments: number | null;
  medianTimeToMergeHours: number | null;
}

export interface BuilderScoreboardTotals {
  builds: number;
  merged: number;
  rejected: number;
  neverShipped: number;
  mergeRate: number;
  totalCostUsd: number;
  medianCostUsd: number | null;
  costPerMergedBuildUsd: number | null;
}

export interface BuilderScoreboard {
  windowDays: number;
  builds: BuilderScoreboardBuild[];
  trends: BuilderScoreboardTrend[];
  totals: BuilderScoreboardTotals;
  failureTags: { tag: string; count: number }[];
}

export interface BuilderPipelinePhase {
  phase: string;
  model: string | null;
  invocations: number;
  totalCostUsd: number | null;
  medianCostUsd: number | null;
  medianWallMs: number | null;
  p95WallMs: number | null;
  medianApiMs: number | null;
  medianTurns: number | null;
}

export interface BuilderPipelineGate {
  repo: string;
  kind: string;
  results: number;
  passed: number;
  passRate: number | null;
}

export interface BuilderPipelineOutcome {
  status: string;
  mode: string;
  runs: number;
  medianRunnerMinutes: number | null;
}

export interface BuilderPipelineHealth {
  windowDays: number;
  phases: BuilderPipelinePhase[];
  gates: BuilderPipelineGate[];
  outcomes: BuilderPipelineOutcome[];
}
