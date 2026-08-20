import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
import {
  QUALITY_INDEX_CALIBRATION_GRAIN,
  QUALITY_INDEX_CALIBRATION_WINDOW_DAYS,
  QUALITY_INDEX_HIGHER_IS_BETTER,
  QUALITY_INDEX_JUDGE_PINS,
  QUALITY_INDEX_SEVERITY_WEIGHT_SQL,
  QualityIndexDimension,
  resolveCalibrationPercentiles,
} from '../constants/quality-index.constants';
import { AnalyticsBucket } from './platform-analytics.repository';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/** One bucket's raw measurement for one dimension, before normalisation. */
export interface DimensionBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** The dimension's raw value in its own unit, or null if the bucket is empty. */
  raw: number | null;
  /** Rows behind the value — sessions, or turns for latency. */
  n: number;
}

/** What one calibration measurement yields for one dimension. */
export interface CalibrationMeasurement {
  target: number;
  ceiling: number;
  /** Eligible buckets the percentiles were interpolated across. */
  buckets: number;
  /** Total underlying rows across those buckets. */
  sampleSize: number;
}

/**
 * The four raw series behind the Roleplay Quality Index, and the calibration
 * measurement that anchors them.
 *
 * ## One builder, two callers
 *
 * The per-bucket series (what the chart plots) and the calibration percentiles
 * (what the chart is measured against) run the SAME per-dimension SQL, differing
 * only in grain and in what is done with the resulting rows. That is deliberate
 * and load-bearing: if calibration measured a slightly different population
 * than the chart plots — a different eligibility rule, a different judge pin —
 * every point would be scored against anchors drawn from a population it is not
 * part of, and nothing about the chart would look wrong.
 *
 * ## Eligibility, applied uniformly
 *
 * Every dimension joins `scenario_sessions` and applies BOTH
 * {@link countableSessionPredicate} and {@link excludeTestTenants}. The now-
 * retired `HighlightsAnalyticsRepository.getQualityTrendByBucket` did not join
 * for the actor dimension, filtering only on the details row's denormalised
 * tenant — which meant preview and seed-room sessions were in that chart. The
 * index does not inherit that.
 *
 * ## Judge pinning
 *
 * The drift and language dimensions are pinned to
 * {@link QUALITY_INDEX_JUDGE_PINS}. Unpinned, a rubric change would move the
 * index with nobody having practised differently; pinned, the cost is instead
 * that history reaches only as far as each family's backlog has been drained,
 * which the coverage figures make visible.
 */
@Injectable()
export class QualityIndexAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Whitelist guard — bucket reaches an interpolated position. */
  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    const allowed: AnalyticsBucket[] = ['day', 'week', 'month', 'year'];
    return allowed.includes(bucket) ? bucket : 'month';
  }

  /**
   * Per-bucket raw values for one dimension.
   *
   * Buckets with no eligible rows are ABSENT rather than zero: an average or a
   * rate has no meaningful zero, and gap-filling a quiet week with 0 would draw
   * a catastrophic quality collapse out of nobody having practised.
   */
  async getDimensionSeries(
    dimension: QualityIndexDimension,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<DimensionBucketRow[]> {
    const grain = this.resolveBucket(bucket);
    const params: unknown[] = [start, end];
    const sql = this.dimensionSql(dimension, grain, params, tenantId);

    const rows = await this.dataSource.query(sql, params);
    return (rows as Array<{ bucket: string; raw: string | null; n: string }>)
      .map((r) => ({
        bucket: r.bucket,
        raw: r.raw === null ? null : Number(r.raw),
        n: Number(r.n) || 0,
      }))
      .filter((r) => r.raw !== null && Number.isFinite(r.raw as number));
  }

  /**
   * Measure a dimension's anchors from the trailing window, at the fixed
   * calibration grain.
   *
   * Percentiles are taken across BUCKET values, not across underlying rows,
   * because a bucket value is what the chart plots — anchoring on the spread of
   * individual sessions would describe a distribution the chart never shows.
   *
   * Buckets thinner than `minSample` are dropped before the percentiles are
   * taken, so a two-session week cannot become the anchor that defines 0.
   * Returns null when too few eligible buckets remain to interpolate a decile,
   * which is the signal to leave the placeholder in place and retry later.
   */
  async measureDimension(
    dimension: QualityIndexDimension,
    minSample: number,
    minBuckets: number,
  ): Promise<CalibrationMeasurement | null> {
    const end = new Date();
    const start = new Date(
      end.getTime() -
        QUALITY_INDEX_CALIBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const params: unknown[] = [start, end];
    const inner = this.dimensionSql(
      dimension,
      QUALITY_INDEX_CALIBRATION_GRAIN as AnalyticsBucket,
      params,
      undefined,
    );

    const { target, ceiling } = resolveCalibrationPercentiles(
      QUALITY_INDEX_HIGHER_IS_BETTER[dimension],
    );
    params.push(minSample);
    const minSampleParam = `$${params.length}`;
    params.push(target);
    const targetParam = `$${params.length}`;
    params.push(ceiling);
    const ceilingParam = `$${params.length}`;

    const rows = await this.dataSource.query(
      `WITH series AS (${inner}),
            eligible AS (
              SELECT raw, n FROM series
               WHERE raw IS NOT NULL AND n >= ${minSampleParam}
            )
       SELECT percentile_cont(${targetParam}) WITHIN GROUP (ORDER BY raw) AS target,
              percentile_cont(${ceilingParam}) WITHIN GROUP (ORDER BY raw) AS ceiling,
              COUNT(*)::int AS buckets,
              COALESCE(SUM(n), 0)::int AS "sampleSize"
         FROM eligible`,
      params,
    );

    const row = (
      rows as Array<{
        target: string | null;
        ceiling: string | null;
        buckets: number;
        sampleSize: number;
      }>
    )[0];
    if (!row || Number(row.buckets) < minBuckets) return null;
    if (row.target === null || row.ceiling === null) return null;

    const measured = {
      target: Number(row.target),
      ceiling: Number(row.ceiling),
      buckets: Number(row.buckets),
      sampleSize: Number(row.sampleSize),
    };
    // Degenerate anchors would make every bucket either 0 or 100. Refusing to
    // freeze them is better than freezing a scale with no resolution.
    if (measured.target === measured.ceiling) return null;
    return measured;
  }

  /**
   * Per-dimension SQL, returning `(bucket, raw, n)` ordered by bucket.
   *
   * Appends its own bind values to `params`, so callers may push further
   * placeholders AFTER calling this and must not renumber what it produced.
   * `$1` is the window start and `$2` the window end by contract.
   */
  private dimensionSql(
    dimension: QualityIndexDimension,
    grain: AnalyticsBucket,
    params: unknown[],
    tenantId?: string,
  ): string {
    switch (dimension) {
      case 'actorComposite':
        return this.actorCompositeSql(grain, params, tenantId);
      case 'driftRate':
        return this.driftRateSql(grain, params, tenantId);
      case 'languageErrors':
        return this.languageErrorsSql(grain, params, tenantId);
      case 'responseLatency':
        return this.responseLatencySql(grain, params, tenantId);
    }
  }

  /**
   * Tenant narrowing, appended only when asked. Returns a SQL fragment (possibly
   * empty) and pushes its bind value.
   */
  private tenantClause(
    column: string,
    params: unknown[],
    tenantId?: string,
  ): string {
    if (!tenantId) return '';
    params.push(tenantId);
    return ` AND ${scopeToTenant(column, `$${params.length}`)}`;
  }

  /** Mean actor-goal composite per bucket. Native 0-100, higher is better. */
  private actorCompositeSql(
    grain: AnalyticsBucket,
    params: unknown[],
    tenantId?: string,
  ): string {
    params.push(ActorEvaluationStatus.COMPLETED);
    const statusParam = `$${params.length}`;
    const tenant = this.tenantClause('s."tenant_id"', params, tenantId);

    // Bucketed on when the JUDGMENT landed, not when the session ran: the
    // judgment is the measurement, and a backlog drain would otherwise
    // retroactively rewrite months that were already read and discussed.
    return `
      SELECT to_char(date_trunc('${grain}', COALESCE(d."evaluatedAt", d."createdAt")), 'YYYY-MM-DD') AS bucket,
             round(avg(d."compositeScore")::numeric, 2)::float AS raw,
             COUNT(*)::int AS n
        FROM scenario_session_details d
        JOIN scenario_sessions s ON s.id = d."scenarioSessionId"
       WHERE d."evaluationStatus" = ${statusParam}
         AND d."compositeScore" IS NOT NULL
         AND COALESCE(d."evaluatedAt", d."createdAt") >= $1
         AND COALESCE(d."evaluatedAt", d."createdAt") < $2
         AND ${countableSessionPredicate('s')}
         AND ${excludeTestTenants('s."tenant_id"')}${tenant}
       GROUP BY 1
       ORDER BY 1 ASC`;
  }

  /**
   * Share of judged sessions that drifted out of character, per bucket. Lower is
   * better.
   *
   * `sessionDrifted` is a session-level verdict denormalised onto every turn
   * row, so both numerator and denominator count DISTINCT sessions — counting
   * rows would weight a long session more heavily than a short one, turning the
   * rate into a turn-weighted quantity that no other tab reports.
   */
  private driftRateSql(
    grain: AnalyticsBucket,
    params: unknown[],
    tenantId?: string,
  ): string {
    params.push(QUALITY_INDEX_JUDGE_PINS.drift.judgeModel);
    const modelParam = `$${params.length}`;
    params.push(QUALITY_INDEX_JUDGE_PINS.drift.judgePromptVersion);
    const versionParam = `$${params.length}`;
    const tenant = this.tenantClause('s."tenant_id"', params, tenantId);

    return `
      SELECT to_char(date_trunc('${grain}', j."occurredAt"), 'YYYY-MM-DD') AS bucket,
             round((100.0 * COUNT(DISTINCT CASE WHEN j."sessionDrifted" THEN j."scenarioSessionId" END)
                    / NULLIF(COUNT(DISTINCT j."scenarioSessionId"), 0))::numeric, 2)::float AS raw,
             COUNT(DISTINCT j."scenarioSessionId")::int AS n
        FROM turn_drift_judgment j
        JOIN scenario_sessions s ON s.id = j."scenarioSessionId"
       WHERE j."occurredAt" >= $1
         AND j."occurredAt" < $2
         AND j."judgeModel" = ${modelParam}
         AND j."judgePromptVersion" = ${versionParam}
         AND ${countableSessionPredicate('s')}
         AND ${excludeTestTenants('s."tenant_id"')}${tenant}
       GROUP BY 1
       ORDER BY 1 ASC`;
  }

  /**
   * Severity-weighted language errors per 100 judged turns, per bucket. Lower is
   * better.
   *
   * Numerator and denominator come from different tables and are joined on the
   * bucket, not on the session: `language_judgment_sessions` is the denominator
   * of record precisely because a clean session produces no annotation rows at
   * all, so an inner join would silently drop every session with zero errors and
   * make the platform look worse the better it got.
   *
   * `n` is judged TURNS rather than sessions — it is the actual denominator of
   * the rate, and the sample floor should apply to the quantity the rate is
   * over.
   */
  private languageErrorsSql(
    grain: AnalyticsBucket,
    params: unknown[],
    tenantId?: string,
  ): string {
    params.push(QUALITY_INDEX_JUDGE_PINS.language.judgeModel);
    const modelParam = `$${params.length}`;
    params.push(QUALITY_INDEX_JUDGE_PINS.language.judgePromptVersion);
    const versionParam = `$${params.length}`;
    const annTenant = this.tenantClause('sa."tenant_id"', params, tenantId);
    const sessTenant = this.tenantClause('ss."tenant_id"', params, tenantId);

    return `
      WITH num AS (
        SELECT date_trunc('${grain}', a."occurredAt") AS bucket,
               SUM(${QUALITY_INDEX_SEVERITY_WEIGHT_SQL}) AS weighted
          FROM language_error_annotations a
          JOIN scenario_sessions sa ON sa.id = a."scenarioSessionId"
         WHERE a."occurredAt" >= $1
           AND a."occurredAt" < $2
           AND a."judgeModel" = ${modelParam}
           AND a."judgePromptVersion" = ${versionParam}
           AND a."conditionedOut" = false
           AND ${countableSessionPredicate('sa')}
           AND ${excludeTestTenants('sa."tenant_id"')}${annTenant}
         GROUP BY 1
      ), den AS (
        SELECT date_trunc('${grain}', l."occurredAt") AS bucket,
               SUM(l."turnsJudged") AS turns
          FROM language_judgment_sessions l
          JOIN scenario_sessions ss ON ss.id = l."scenarioSessionId"
         WHERE l."occurredAt" >= $1
           AND l."occurredAt" < $2
           AND l."judgeModel" = ${modelParam}
           AND l."judgePromptVersion" = ${versionParam}
           AND ${countableSessionPredicate('ss')}
           AND ${excludeTestTenants('ss."tenant_id"')}${sessTenant}
         GROUP BY 1
      )
      SELECT to_char(den.bucket, 'YYYY-MM-DD') AS bucket,
             round((100.0 * COALESCE(num.weighted, 0)
                    / NULLIF(den.turns, 0))::numeric, 2)::float AS raw,
             den.turns::int AS n
        FROM den
        LEFT JOIN num ON num.bucket = den.bucket
       ORDER BY 1 ASC`;
  }

  /**
   * Median response latency per bucket, in milliseconds. Lower is better.
   *
   * Median rather than mean: a single 30-second outlier — a stalled TTS call, a
   * reconnect — drags a mean far enough to redraw the bucket, and the reader's
   * question here is what a typical turn felt like.
   *
   * Restricted to `source = 'pipeline'` — the agent's own live measurement. The
   * table deliberately keeps a second `'transcript'` row per turn, derived from
   * message timings, and the entity is explicit that dashboards must not mix
   * the two: they are different measurements of the same turn, so pooling them
   * would both double-count and blend two accuracies into one percentile.
   */
  private responseLatencySql(
    grain: AnalyticsBucket,
    params: unknown[],
    tenantId?: string,
  ): string {
    const tenant = this.tenantClause('s."tenant_id"', params, tenantId);

    return `
      SELECT to_char(date_trunc('${grain}', m."occurredAt"), 'YYYY-MM-DD') AS bucket,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m."responseLatencyMs")::numeric, 0)::float AS raw,
             COUNT(*)::int AS n
        FROM scenario_session_turn_metrics m
        JOIN scenario_sessions s ON s.id = m."scenarioSessionId"
       WHERE m."occurredAt" >= $1
         AND m."occurredAt" < $2
         AND m."responseLatencyMs" IS NOT NULL
         AND m."source" = 'pipeline'
         AND ${countableSessionPredicate('s')}
         AND ${excludeTestTenants('s."tenant_id"')}${tenant}
       GROUP BY 1
       ORDER BY 1 ASC`;
  }
}
