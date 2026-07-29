import { Injectable } from '@nestjs/common';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  ScribeAdoptionPointDto,
  ScribeAdoptionQueryDto,
  ScribeAdoptionResponseDto,
} from '../dto/scribe-adoption-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { ScribeAdoptionAnalyticsRepository } from '../repository/scribe-adoption-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/**
 * Scribe adoption for the Highlights tab: orgs and counsellors using the second
 * value stream, over time.
 *
 * Thin by design — the repository answers the question in two passes. What lives
 * here are the three rules a client must not be left to apply for itself:
 *
 *  - **Counts gap-fill to a real calendar.** Every bucket in the window is present
 *    with zeros. All three series are counts, so a zero is a measurement: "no org
 *    used Scribe that month" is precisely what an adoption chart has to be able to
 *    show, and a month assembled only from months with activity puts two points a
 *    quarter apart next to each other.
 *  - **Distinct counts are never summed.** The window totals come from their own
 *    pass, because an org that appears in three months is one customer and three
 *    org-months. Adding the bars up is the single most likely way this number gets
 *    reported wrong.
 *  - **The current bucket is not the headline.** "Orgs using Scribe now" is quoted
 *    from the latest COMPLETE bucket, because the one in progress can only rise and
 *    would otherwise report how far into the month we are.
 */
@Injectable()
export class ScribeAdoptionAnalyticsService {
  constructor(private readonly repository: ScribeAdoptionAnalyticsRepository) {}

  /** Bucket granularity per range; `all` and `12m` land on months. */
  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '30d') return 'day';
    if (range === '90d') return 'week';
    return 'month';
  }

  async getScribeAdoption(
    query: ScribeAdoptionQueryDto,
  ): Promise<ScribeAdoptionResponseDto> {
    // The data floor is one extra cheap query, and only for an all-time range —
    // which is this endpoint's default, so it is the common path.
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor: ScribeAdoptionAnalyticsService.defaultBucketFor,
      allTimeStart: needsFloor
        ? await this.repository.getDataFloor()
        : undefined,
    });
    const { start, endExclusive, bucket } = window;
    const tenantId = query.tenantId?.trim() || undefined;

    const [bucketRows, totals] = await Promise.all([
      this.repository.getAdoptionByBucket(
        start,
        endExclusive,
        bucket,
        tenantId,
      ),
      this.repository.getTotals(start, endExclusive, tenantId),
    ]);

    const byBucket = new Map(bucketRows.map((r) => [r.bucket, r]));
    const points: ScribeAdoptionPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((key) => {
      const row = byBucket.get(key);
      return {
        bucket: key,
        orgs: row?.orgs ?? 0,
        counsellors: row?.counsellors ?? 0,
        sessions: row?.sessions ?? 0,
      };
    });

    // The last bucket whose period has finished. `inProgressBucket` names the one
    // still accruing (null when the window ended in the past, in which case the
    // final bucket is complete).
    const latestComplete =
      [...points].reverse().find((p) => p.bucket !== window.inProgressBucket) ??
      null;

    return {
      window: describeWindow(window),
      points,
      summary: {
        orgs: totals.orgs,
        counsellors: totals.counsellors,
        sessions: totals.sessions,
        latestCompleteBucket: latestComplete?.bucket ?? null,
        // A real 0 when the latest complete bucket had no orgs; null only when
        // there is no complete bucket to quote at all.
        latestOrgs: latestComplete ? latestComplete.orgs : null,
      },
      // Every scribe aggregate resolves through chats.tenant_id, so a tenant
      // filter applies cleanly to all of them.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
