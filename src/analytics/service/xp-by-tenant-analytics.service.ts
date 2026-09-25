import { Injectable } from '@nestjs/common';

import {
  XP_BY_TENANT_MAX_SEGMENTS,
  XpByTenantAnalyticsRepository,
  XpByTenantPeriodRow,
  XpByTenantRow,
} from '../repository/xp-by-tenant-analytics.repository';
import {
  XpByTenantBucketGrain,
  XpByTenantGrain,
  XpByTenantPointDto,
  XpByTenantQueryDto,
  XpByTenantResponseDto,
  XpByTenantSegmentDto,
  XpByTenantWindow,
} from '../dto/xp-by-tenant-analytics.dto';
import {
  addDays,
  bucketDisplayLabel,
  generateBucketLabels,
  isoDate,
  startOfUtcDay,
  truncToBucket,
} from '../util/analytics-window.util';

const DEFAULT_WINDOW: XpByTenantWindow = '90d';
const DEFAULT_GRAIN: XpByTenantGrain = 'all';

const WINDOW_DAYS: Record<Exclude<XpByTenantWindow, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

const WINDOW_LABEL: Record<XpByTenantWindow, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 365 days',
  all: 'All time',
};

/**
 * Total XP earned per tenant within a trailing window — one stacked bar for
 * the whole window, or one per day/week/month/quarter/year.
 *
 * Deliberately simpler than the shared `resolveAnalyticsWindow`: this chart's
 * window is only a trailing period ending today, so it resolves its own small
 * window directly off `startOfUtcDay`/`addDays` rather than pulling in
 * machinery (custom `from`/`to`, `previousWindow`) this endpoint has no use for.
 */
@Injectable()
export class XpByTenantAnalyticsService {
  constructor(private readonly repository: XpByTenantAnalyticsRepository) {}

  async getXpByTenant(
    query: XpByTenantQueryDto,
  ): Promise<XpByTenantResponseDto> {
    const window = query.window ?? DEFAULT_WINDOW;
    const grain = query.grain ?? DEFAULT_GRAIN;
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);

    const start =
      window === 'all'
        ? await this.repository.getDataFloor()
        : addDays(todayStart, -(WINDOW_DAYS[window] - 1));

    const [rows, periodRows] = await Promise.all([
      this.repository.getXpByTenant(start, endExclusive),
      grain === 'all'
        ? Promise.resolve<XpByTenantPeriodRow[]>([])
        : this.repository.getXpByTenantByPeriod(grain, start, endExclusive),
    ]);
    const { segments, otherXp, totalXp } = this.capSegments(rows);

    const points: XpByTenantPointDto[] =
      grain === 'all'
        ? [
            {
              periodStart: isoDate(start),
              periodLabel: WINDOW_LABEL.all,
              segments: segments.map((s) => ({ ...s })),
              otherXp,
              totalXp,
              inProgress: false,
            },
          ]
        : this.buildPoints(
            grain,
            start,
            endExclusive,
            todayStart,
            segments,
            periodRows,
          );

    return {
      window: {
        window,
        from: isoDate(start),
        to: isoDate(addDays(endExclusive, -1)),
        label: WINDOW_LABEL[window],
        allTime: window === 'all',
      },
      grain,
      segments,
      otherXp,
      totalXp,
      points,
      computedAt: now.toISOString(),
    };
  }

  /**
   * One zero-filled point per period. The named set is the WHOLE-window top N
   * (`segments`), not re-ranked per period: a tenant keeps one band — and one
   * colour — across every bar, and "Other tenants" means the same orgs in each.
   * A tenant that led a single month but not the window reads as part of Other
   * that month; the cost of a per-period ranking would be a legend that
   * reshuffles bar to bar, which is worse.
   */
  private buildPoints(
    grain: XpByTenantBucketGrain,
    start: Date,
    endExclusive: Date,
    todayStart: Date,
    segments: XpByTenantSegmentDto[],
    periodRows: XpByTenantPeriodRow[],
  ): XpByTenantPointDto[] {
    const named = new Map(segments.map((s, i) => [s.tenantId, i]));
    const byPeriod = new Map<string, XpByTenantPeriodRow[]>();
    for (const r of periodRows) {
      const list = byPeriod.get(r.periodStart) ?? [];
      list.push(r);
      byPeriod.set(r.periodStart, list);
    }
    const currentPeriod = isoDate(truncToBucket(todayStart, grain));

    return generateBucketLabels(start, endExclusive, grain).map((iso) => {
      const pointSegments: XpByTenantPointDto['segments'] = [];
      let pointOther = 0;
      for (const r of byPeriod.get(iso) ?? []) {
        const idx = named.get(r.tenantId);
        if (idx === undefined) {
          pointOther += r.xp;
        } else {
          pointSegments.push({
            tenantId: r.tenantId,
            tenantName: segments[idx].tenantName,
            xp: r.xp,
          });
        }
      }
      pointSegments.sort(
        (a, b) => named.get(a.tenantId)! - named.get(b.tenantId)!,
      );
      const pointTotal =
        pointSegments.reduce((sum, s) => sum + s.xp, 0) + pointOther;

      return {
        periodStart: iso,
        periodLabel: bucketDisplayLabel(new Date(`${iso}T00:00:00Z`), grain),
        segments: pointSegments,
        otherXp: pointOther,
        totalXp: pointTotal,
        inProgress: iso === currentPeriod,
      };
    });
  }

  /**
   * Top N tenants by XP, remainder rolled into one "Other tenants" total — the
   * same cap-and-roll-up shape as `RoadmapDeliveryAnalyticsService`'s owner
   * bands, so a long tail of small orgs cannot turn the bar into an unreadable
   * legend. `rows` already arrives highest-XP-first from the repository.
   *
   * Rolled up only when the tail is more than one tenant: with exactly one org
   * over the cap, an "Other tenants" segment would name that single org less
   * clearly than its own name would — so the cap effectively becomes
   * `MAX_SEGMENTS + 1` in that one case.
   */
  private capSegments(rows: XpByTenantRow[]): {
    segments: XpByTenantSegmentDto[];
    otherXp: number;
    totalXp: number;
  } {
    const totalXp = rows.reduce((sum, r) => sum + r.xp, 0);

    if (rows.length <= XP_BY_TENANT_MAX_SEGMENTS + 1) {
      return { segments: rows, otherXp: 0, totalXp };
    }

    const segments = rows.slice(0, XP_BY_TENANT_MAX_SEGMENTS);
    const tail = rows.slice(XP_BY_TENANT_MAX_SEGMENTS);
    const otherXp = tail.reduce((sum, r) => sum + r.xp, 0);
    return { segments, otherXp, totalXp };
  }
}
