import { Injectable } from '@nestjs/common';

import {
  XP_BY_TENANT_MAX_SEGMENTS,
  XpByTenantAnalyticsRepository,
  XpByTenantRow,
} from '../repository/xp-by-tenant-analytics.repository';
import {
  XpByTenantQueryDto,
  XpByTenantResponseDto,
  XpByTenantSegmentDto,
  XpByTenantWindow,
} from '../dto/xp-by-tenant-analytics.dto';
import { addDays, isoDate, startOfUtcDay } from '../util/analytics-window.util';

const DEFAULT_WINDOW: XpByTenantWindow = '90d';

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
 * Total XP earned per tenant within a trailing window, as one stacked bar.
 *
 * Deliberately simpler than the shared `resolveAnalyticsWindow`: this chart has
 * no bucket/grain, only a trailing period ending today, so it resolves its own
 * small window directly off `startOfUtcDay`/`addDays` rather than pulling in
 * machinery (custom `from`/`to`, `previousWindow`, bucket labels) this endpoint
 * has no use for.
 */
@Injectable()
export class XpByTenantAnalyticsService {
  constructor(private readonly repository: XpByTenantAnalyticsRepository) {}

  async getXpByTenant(
    query: XpByTenantQueryDto,
  ): Promise<XpByTenantResponseDto> {
    const window = query.window ?? DEFAULT_WINDOW;
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);

    const start =
      window === 'all'
        ? await this.repository.getDataFloor()
        : addDays(todayStart, -(WINDOW_DAYS[window] - 1));

    const rows = await this.repository.getXpByTenant(start, endExclusive);
    const { segments, otherXp, totalXp } = this.capSegments(rows);

    return {
      window: {
        window,
        from: isoDate(start),
        to: isoDate(addDays(endExclusive, -1)),
        label: WINDOW_LABEL[window],
        allTime: window === 'all',
      },
      segments,
      otherXp,
      totalXp,
      computedAt: now.toISOString(),
    };
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
