import { Injectable, OnModuleInit } from '@nestjs/common';

import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';
import { QualityIndexAnalyticsRepository } from '../repository/quality-index-analytics.repository';
import { QualityThresholdRepository } from '../repository/quality-threshold.repository';
import {
  QUALITY_INDEX_CALIBRATION_GRAIN,
  QUALITY_INDEX_CALIBRATION_MIN_BUCKETS,
  QUALITY_INDEX_CALIBRATION_MIN_SAMPLE,
  QUALITY_INDEX_CALIBRATION_WINDOW_DAYS,
} from '../constants/quality-index.constants';

/**
 * Measures the Roleplay Quality Index's normalisation anchors from real traffic,
 * once per dimension, then stops.
 *
 * ## Why this exists at all
 *
 * The index needs FIXED anchors — 70 has to mean the same thing next quarter as
 * it does today — but anchors have to come from somewhere, and inventing them
 * ships a calibrated-looking chart built on guesses. So the release ships
 * placeholders and this measures the real ones in the only environment that has
 * the traffic to measure.
 *
 * ## Why a task rather than the migration that creates the table
 *
 * A migration runs exactly once, at deploy time, whatever the data happens to
 * look like at that moment. A quiet week or a judge backlog mid-drain would
 * freeze bad anchors permanently, and the only remedy would be another
 * migration. This instead retries every hour until each dimension clears its
 * floors, so calibration waits for the data rather than racing the deploy — and
 * it reuses `countableSessionPredicate` / `excludeTestTenants` / the judge pins
 * as CODE, rather than forking their SQL into a file nobody edits again.
 *
 * ## Why it is safe to leave running forever
 *
 * Each tick asks which dimensions are still placeholders. Once all four are
 * measured that query returns nothing and the tick ends without touching the
 * judge tables — no end date to set, nothing to remember to remove. The write
 * itself is guarded in SQL (`source = 'placeholder'` in the WHERE), so two
 * replicas cannot race to different anchors even if both got past the read.
 *
 * ## It is deliberately not idempotent-by-recompute
 *
 * A frozen anchor is never revisited. Re-measuring against a newer window would
 * silently redefine every point already on the chart — the exact failure the
 * fixed-threshold design exists to prevent. Changing an anchor is a human act:
 * edit the row, and bump `QUALITY_INDEX_VERSION` in the same commit.
 */
@Injectable()
export class QualityThresholdCalibrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    QualityThresholdCalibrationService.name,
  );

  constructor(
    private readonly indexRepo: QualityIndexAnalyticsRepository,
    private readonly thresholdRepo: QualityThresholdRepository,
  ) {}

  onModuleInit(): void {
    // Hourly, not 30min: this fires at most four useful times in the product's
    // life, and every other tick is one cheap read of a four-row table.
    scheduledTaskRegistry.register(
      'hourly',
      'quality-threshold-calibration',
      async () => {
        await this.calibrate();
      },
    );
  }

  /**
   * Attempt calibration for every dimension still on a placeholder.
   *
   * Never throws — it runs from the shared scheduler, where an escaping error
   * would take the rest of the tick's tasks with it. A dimension that cannot be
   * measured yet is logged at debug and retried next hour; one that fails
   * outright is logged as an error and does not stop its siblings.
   */
  async calibrate(): Promise<{ pending: number; frozen: number }> {
    let pending: Awaited<ReturnType<QualityThresholdRepository['findUncalibrated']>>;
    try {
      pending = await this.thresholdRepo.findUncalibrated();
    } catch (error) {
      this.logger.error(
        `[QUALITY_CALIBRATION] could not read thresholds: ${(error as Error)?.message}`,
      );
      return { pending: 0, frozen: 0 };
    }

    if (!pending.length) {
      // The steady state for the rest of the product's life.
      this.logger.debug(
        '[QUALITY_CALIBRATION] all dimensions calibrated; nothing to do.',
      );
      return { pending: 0, frozen: 0 };
    }

    let frozen = 0;
    for (const dimension of pending) {
      try {
        const measured = await this.indexRepo.measureDimension(
          dimension,
          QUALITY_INDEX_CALIBRATION_MIN_SAMPLE,
          QUALITY_INDEX_CALIBRATION_MIN_BUCKETS,
        );

        if (!measured) {
          // The normal state on a local or staging database, and on production
          // before a family's backlog has been drained far enough.
          this.logger.debug(
            `[QUALITY_CALIBRATION] ${dimension}: not enough eligible ` +
              `${QUALITY_INDEX_CALIBRATION_GRAIN}ly buckets in the last ` +
              `${QUALITY_INDEX_CALIBRATION_WINDOW_DAYS} days ` +
              `(need ${QUALITY_INDEX_CALIBRATION_MIN_BUCKETS} of ` +
              `>= ${QUALITY_INDEX_CALIBRATION_MIN_SAMPLE}); keeping placeholder.`,
          );
          continue;
        }

        const didFreeze = await this.thresholdRepo.freezeMeasured(
          dimension,
          measured.target,
          measured.ceiling,
          measured.sampleSize,
        );

        if (!didFreeze) {
          // Another replica won the race, or a human calibrated it by hand
          // between the read and the write. Either way the anchors are set and
          // this is not an error.
          this.logger.info(
            `[QUALITY_CALIBRATION] ${dimension}: already calibrated by another ` +
              `writer; leaving it alone.`,
          );
          continue;
        }

        frozen += 1;
        // Logged loudly and with the sample behind it: this is a one-way door,
        // and the numbers it froze are the ones every future reading of the
        // chart depends on.
        this.logger.info(
          `[QUALITY_CALIBRATION] ${dimension} FROZEN: target=${measured.target} ` +
            `ceiling=${measured.ceiling} from ${measured.buckets} ` +
            `${QUALITY_INDEX_CALIBRATION_GRAIN}ly buckets / ` +
            `${measured.sampleSize} rows. This anchor is now permanent — ` +
            `changing it requires editing the row and bumping ` +
            `QUALITY_INDEX_VERSION.`,
        );
      } catch (error) {
        this.logger.error(
          `[QUALITY_CALIBRATION] ${dimension} failed: ${(error as Error)?.message}`,
        );
      }
    }

    return { pending: pending.length, frozen };
  }
}
