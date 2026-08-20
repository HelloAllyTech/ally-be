import { Injectable } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import {
  QUALITY_INDEX_DIMENSIONS,
  QUALITY_INDEX_LABELS,
  QUALITY_INDEX_RAW_UNITS,
  QUALITY_INDEX_VERSION,
  QUALITY_INDEX_WEIGHTS,
  QualityIndexDimension,
  normaliseToIndexScale,
} from '../constants/quality-index.constants';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  DimensionBucketRow,
  QualityIndexAnalyticsRepository,
} from '../repository/quality-index-analytics.repository';
import { QualityThresholdRepository } from '../repository/quality-threshold.repository';

export interface QualityIndexPoint {
  bucket: string;
  /** 0-100, or null when no dimension had data in this bucket. */
  index: number | null;
  /** Per-dimension stack heights. Present layers sum to `index`. */
  contributions: Partial<Record<QualityIndexDimension, number>>;
  /** Each dimension's raw value in its own unit, for the tooltip. */
  raw: Partial<Record<QualityIndexDimension, number>>;
  /** Rows behind each dimension in this bucket. */
  n: Partial<Record<QualityIndexDimension, number>>;
  /** Dimensions with no data here — the reason `index` is a partial blend. */
  missing: QualityIndexDimension[];
}

export interface QualityIndexDimensionCoverage {
  dimension: QualityIndexDimension;
  label: string;
  unit: string;
  weight: number;
  /** Buckets in the window where this dimension had data. */
  bucketsCovered: number;
  /** Buckets in the window where ANY dimension had data. */
  bucketsTotal: number;
  /** False while the dimension is still normalised against shipped guesses. */
  calibrated: boolean;
  target: number;
  ceiling: number;
  sampleSize: number | null;
  measuredAt: Date | null;
}

export interface QualityIndexResult {
  /** Bump-on-definition-change stamp, rendered on the card. */
  version: string;
  /** True only when every dimension's anchors are measured, not placeholders. */
  calibrated: boolean;
  points: QualityIndexPoint[];
  coverage: QualityIndexDimensionCoverage[];
}

/**
 * Assembles the Roleplay Quality Index — one 0-100 line per bucket, with the
 * four weighted contributions that add up to it.
 *
 * ## Partial buckets are renormalised, never zero-filled
 *
 * The four dimensions have genuinely different coverage: drift v2 labels reach
 * only as far back as the backlog has been drained, language is pinned to its
 * own version, latency exists for every session with turn metrics. So most
 * buckets have some dimensions and not others.
 *
 * A missing dimension therefore contributes NOTHING and its weight is removed
 * from the denominator, rather than being scored 0. Treating absence as failure
 * is the same dilution bug the actor evaluation already had to fix with
 * `notApplicableGoals`: a session was dragged down by goals it never had the
 * chance to exercise, and the size of the drag varied with whatever happened to
 * be configured. Here it would mean the index fell hardest in exactly the months
 * where a judge had not yet run — reading as a quality collapse in the past,
 * caused entirely by our own backfill order.
 *
 * The cost is that the index is a blend of a varying set of dimensions, so
 * `missing` travels on every point and per-dimension coverage travels on the
 * result. That is the honest version of the same trade: the number is always a
 * blend of what we actually measured, and the card can say which.
 */
@Injectable()
export class QualityIndexAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    QualityIndexAnalyticsService.name,
  );

  constructor(
    private readonly repo: QualityIndexAnalyticsRepository,
    private readonly thresholdRepo: QualityThresholdRepository,
  ) {}

  async getQualityIndex(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<QualityIndexResult> {
    const thresholds = await this.thresholdRepo.findAll();
    const thresholdByDimension = new Map(
      thresholds.map((t) => [t.dimension, t]),
    );

    // Four independent aggregates over four different tables — no ordering
    // dependency between them, so they go out together.
    const series = await Promise.all(
      QUALITY_INDEX_DIMENSIONS.map(async (dimension) => ({
        dimension,
        rows: await this.repo.getDimensionSeries(
          dimension,
          start,
          end,
          bucket,
          tenantId,
        ),
      })),
    );

    const byBucket = new Map<
      string,
      Partial<Record<QualityIndexDimension, DimensionBucketRow>>
    >();
    for (const { dimension, rows } of series) {
      for (const row of rows) {
        const existing = byBucket.get(row.bucket) ?? {};
        existing[dimension] = row;
        byBucket.set(row.bucket, existing);
      }
    }

    const buckets = [...byBucket.keys()].sort();
    const covered = new Map<QualityIndexDimension, number>();

    const points: QualityIndexPoint[] = buckets.map((bucketKey) => {
      const perDimension = byBucket.get(bucketKey) ?? {};
      const contributions: Partial<Record<QualityIndexDimension, number>> = {};
      const raw: Partial<Record<QualityIndexDimension, number>> = {};
      const n: Partial<Record<QualityIndexDimension, number>> = {};
      const missing: QualityIndexDimension[] = [];

      // Pass one: normalise what is present and total the live weights, so the
      // renormalisation denominator is known before any contribution is scaled.
      const scored: Array<{
        dimension: QualityIndexDimension;
        score: number;
        weight: number;
      }> = [];
      let liveWeight = 0;

      for (const dimension of QUALITY_INDEX_DIMENSIONS) {
        const row = perDimension[dimension];
        const threshold = thresholdByDimension.get(dimension);
        if (!row || row.raw === null || !threshold) {
          missing.push(dimension);
          continue;
        }

        const score = normaliseToIndexScale(
          row.raw,
          threshold.target,
          threshold.ceiling,
        );
        if (score === null) {
          // Degenerate anchors — reported as uncovered rather than as a score.
          missing.push(dimension);
          continue;
        }

        raw[dimension] = row.raw;
        n[dimension] = row.n;
        covered.set(dimension, (covered.get(dimension) ?? 0) + 1);

        const weight = QUALITY_INDEX_WEIGHTS[dimension];
        scored.push({ dimension, score, weight });
        liveWeight += weight;
      }

      if (!scored.length || liveWeight === 0) {
        return { bucket: bucketKey, index: null, contributions, raw, n, missing };
      }

      // Pass two: scale each contribution by the LIVE weight total, so the
      // present layers sum exactly to the index line even when a dimension is
      // absent. Rounded to one decimal, then the index is taken as the sum of
      // the rounded layers rather than rounded separately — otherwise the stack
      // and the line disagree by a tenth and the chart looks broken.
      let index = 0;
      for (const { dimension, score, weight } of scored) {
        const contribution =
          Math.round(((weight * score) / liveWeight) * 10) / 10;
        contributions[dimension] = contribution;
        index += contribution;
      }

      return {
        bucket: bucketKey,
        index: Math.round(index * 10) / 10,
        contributions,
        raw,
        n,
        missing,
      };
    });

    const coverage: QualityIndexDimensionCoverage[] =
      QUALITY_INDEX_DIMENSIONS.map((dimension) => {
        const threshold = thresholdByDimension.get(dimension);
        return {
          dimension,
          label: QUALITY_INDEX_LABELS[dimension],
          unit: QUALITY_INDEX_RAW_UNITS[dimension],
          weight: QUALITY_INDEX_WEIGHTS[dimension],
          bucketsCovered: covered.get(dimension) ?? 0,
          bucketsTotal: buckets.length,
          calibrated: threshold?.calibrated ?? false,
          target: threshold?.target ?? 0,
          ceiling: threshold?.ceiling ?? 0,
          sampleSize: threshold?.sampleSize ?? null,
          measuredAt: threshold?.measuredAt ?? null,
        };
      });

    const calibrated = coverage.every((c) => c.calibrated);
    if (!calibrated) {
      // Worth a log line, not just a UI caveat: an uncalibrated index on
      // production means the release shipped and the task has not yet had the
      // data to anchor it.
      this.logger.debug(
        `[QUALITY_INDEX] serving with placeholder anchors for: ` +
          coverage
            .filter((c) => !c.calibrated)
            .map((c) => c.dimension)
            .join(', '),
      );
    }

    return {
      version: QUALITY_INDEX_VERSION,
      calibrated,
      points,
      coverage,
    };
  }
}
