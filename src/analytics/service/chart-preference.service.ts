import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ChartPreferencesResponseDto,
  SaveChartPreferencesDto,
} from '../dto/chart-preference.dto';
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
} from '../dto/platform-analytics.dto';
import { AnalyticsChartPreference } from '../entity/analytics-chart-preference.entity';

/**
 * A reader's saved per-chart window and grain.
 *
 * The Highlights tab has no page-level date range — each chart owns its own
 * controls — and that only pays off if the choice survives a reload.
 *
 * Two decisions worth naming:
 *
 *  - **Saving is an upsert per chart, never a replace-all.** A client that knows
 *    only about the tab currently on screen must not be able to wipe the saved
 *    state of every other tab by saving its own. Deleting a preference is
 *    therefore explicit: send `range: null, bucket: null` to clear one.
 *  - **Reads are permissive, writes are strict.** A stored value that is no longer
 *    a legal range or grain is dropped on the way out rather than 500-ing the
 *    whole dashboard: chart ids and enum values are client-owned, and a row can
 *    outlive a rename. The write path validates through the DTO, so nothing
 *    illegal gets in from here on.
 */
@Injectable()
export class ChartPreferenceService {
  constructor(
    @InjectRepository(AnalyticsChartPreference)
    private readonly repository: Repository<AnalyticsChartPreference>,
  ) {}

  async getForUser(userId: number): Promise<ChartPreferencesResponseDto> {
    const rows = await this.repository.find({
      where: { userId },
      order: { chartId: 'ASC' },
    });

    return {
      preferences: rows
        .map((row) => ({
          chartId: row.chartId,
          range: asRange(row.range),
          bucket: asBucket(row.bucket),
        }))
        // A row whose BOTH values failed validation carries no information; it
        // would arrive as a preference that sets nothing and confuse the client
        // into thinking a chart was pinned.
        .filter((pref) => pref.range !== null || pref.bucket !== null),
    };
  }

  /**
   * Upsert each preference for this user.
   *
   * `orUpdate` on the (userId, chartId) unique index rather than a
   * find-then-save: two tabs open in one browser can both save on unmount, and a
   * read-modify-write would race into a duplicate-key error on whichever lost.
   *
   * Returns the full saved set, so the client can reconcile in one round trip
   * instead of re-fetching.
   */
  async saveForUser(
    userId: number,
    dto: SaveChartPreferencesDto,
  ): Promise<ChartPreferencesResponseDto> {
    if (dto.preferences.length > 0) {
      await this.repository
        .createQueryBuilder()
        .insert()
        .into(AnalyticsChartPreference)
        .values(
          dto.preferences.map((pref) => ({
            userId,
            chartId: pref.chartId,
            range: pref.range ?? null,
            bucket: pref.bucket ?? null,
          })),
        )
        .orUpdate(['range', 'bucket'], ['userId', 'chartId'])
        .execute();
    }

    return this.getForUser(userId);
  }
}

/**
 * Narrow a stored string to a legal range, or null.
 *
 * The cast to the union happens only after the value has been checked against the
 * live list, so a range retired in a later release reads as "no preference"
 * instead of being handed to a chart that cannot honour it.
 */
function asRange(value?: string | null): AnalyticsRange | null {
  const ranges: readonly string[] = ANALYTICS_RANGES;
  return value && ranges.includes(value) ? (value as AnalyticsRange) : null;
}

function asBucket(value?: string | null): AnalyticsBucketParam | null {
  const buckets: readonly string[] = ANALYTICS_BUCKETS;
  return value && buckets.includes(value)
    ? (value as AnalyticsBucketParam)
    : null;
}
