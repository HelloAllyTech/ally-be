import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { AnalyticsQualityThreshold } from '../entity/analytics-quality-threshold.entity';
import {
  QUALITY_INDEX_DIMENSIONS,
  QUALITY_INDEX_PLACEHOLDER_THRESHOLDS,
  QualityIndexDimension,
} from '../constants/quality-index.constants';

/** A dimension's anchors, as the index service needs them. */
export interface ResolvedThreshold {
  dimension: QualityIndexDimension;
  target: number;
  ceiling: number;
  /** False while the row still holds the shipped guess. */
  calibrated: boolean;
  sampleSize: number | null;
  measuredAt: Date | null;
}

/**
 * Read/write access to the index's normalisation anchors.
 *
 * Two rules live here rather than in the calling service, because both are
 * about not lying to a reader and neither should depend on a caller remembering
 * them:
 *
 *  - A missing row falls back to the compiled placeholder and reports
 *    `calibrated: false`. The card must render on a database where the migration
 *    has run but a dimension row was somehow removed — but it must never
 *    present a guessed anchor as a measured one.
 *  - {@link freezeMeasured} writes ONLY rows still marked `placeholder`. Once an
 *    anchor is measured it is permanent: re-anchoring silently rewrites what
 *    every historical point on the chart meant, so it is a deliberate human act
 *    (edit the row, bump QUALITY_INDEX_VERSION), never a scheduler's.
 */
@Injectable()
export class QualityThresholdRepository {
  private readonly repo: Repository<AnalyticsQualityThreshold>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(AnalyticsQualityThreshold);
  }

  /**
   * Every dimension's anchors, placeholder-filled so the result is total. Order
   * follows QUALITY_INDEX_DIMENSIONS, which is the chart's stacking order.
   */
  async findAll(): Promise<ResolvedThreshold[]> {
    const rows = await this.repo.find();
    const byDimension = new Map(rows.map((r) => [r.dimension, r]));

    return QUALITY_INDEX_DIMENSIONS.map((dimension) => {
      const row = byDimension.get(dimension);
      if (!row) {
        const fallback = QUALITY_INDEX_PLACEHOLDER_THRESHOLDS[dimension];
        return {
          dimension,
          target: fallback.target,
          ceiling: fallback.ceiling,
          calibrated: false,
          sampleSize: null,
          measuredAt: null,
        };
      }
      return {
        dimension,
        target: Number(row.target),
        ceiling: Number(row.ceiling),
        calibrated: row.source === 'measured',
        sampleSize: row.sampleSize ?? null,
        measuredAt: row.measuredAt ?? null,
      };
    });
  }

  /** Dimensions still awaiting calibration. Empty means the task is done forever. */
  async findUncalibrated(): Promise<QualityIndexDimension[]> {
    const rows = await this.repo.find();
    const measured = new Set(
      rows.filter((r) => r.source === 'measured').map((r) => r.dimension),
    );
    return QUALITY_INDEX_DIMENSIONS.filter((d) => !measured.has(d));
  }

  /**
   * Freeze a measured pair, if and only if the row is still a placeholder.
   *
   * The `source = 'placeholder'` predicate is in the WHERE clause rather than
   * checked beforehand so that two concurrent app instances cannot both decide
   * a row is uncalibrated and race to write different anchors — the second
   * update matches nothing and reports it.
   *
   * Returns whether this call is the one that froze it.
   */
  async freezeMeasured(
    dimension: QualityIndexDimension,
    target: number,
    ceiling: number,
    sampleSize: number,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(AnalyticsQualityThreshold)
      .set({
        target,
        ceiling,
        sampleSize,
        source: 'measured',
        measuredAt: () => 'now()',
      })
      .where('dimension = :dimension', { dimension })
      .andWhere("source = 'placeholder'")
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
