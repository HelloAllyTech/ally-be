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
