import { Injectable } from '@nestjs/common';

import {
  OrgActivityPointDto,
  OrgEngagementQueryDto,
  OrgEngagementResponseDto,
} from '../dto/org-engagement-analytics.dto';
import {
  DEFAULT_ORG_ACTIVITY_WINDOW,
  ORG_ACTIVITY_MONTHS,
  OrgEngagementAnalyticsRepository,
} from '../repository/org-engagement-analytics.repository';

/**
 * Org-level engagement for the Highlights "Orgs" sub-tab.
 *
 * Three readings off three queries: how many orgs there are, the "active
 * recently" headline, and the monthly activity trend behind it.
 *
 * Two things this service is careful about, both of which a client would
 * otherwise get wrong:
 *
 *  - **`tenantId` is ignored, loudly.** Every figure counts ORGS, so narrowing to
 *    one makes the question meaningless rather than answering it differently.
 *    Rather than quietly returning platform numbers under a filter that reads as
 *    though it applied, the sections are named in `scoping.unscopedSections` so
 *    the UI can badge them — the same contract the AI-cost panels use.
 *  - **The headline and the trend are different measurements.** The headline is a
 *    trailing window ending now; the trend is per calendar month. They are near
 *    neighbours, not the same number, and the response says so rather than
 *    letting a reader treat the last point as the headline.
 */
@Injectable()
export class OrgEngagementAnalyticsService {
  constructor(private readonly repo: OrgEngagementAnalyticsRepository) {}

  async getOrgEngagement(
    query: OrgEngagementQueryDto,
  ): Promise<OrgEngagementResponseDto> {
    const activityDays = query.activityDays ?? DEFAULT_ORG_ACTIVITY_WINDOW;

    const [orgs, activityRow, trendRows] = await Promise.all([
      this.repo.getOrgCount(),
      this.repo.getActivityWindow(activityDays),
      this.repo.getActivityByMonth(ORG_ACTIVITY_MONTHS),
    ]);

    const activityTrend: OrgActivityPointDto[] = trendRows.map((r) => ({
      month: r.month,
      activeOrgs: r.activeOrgs,
      totalOrgs: r.totalOrgs,
      activeSharePct: pct(r.activeOrgs, r.totalOrgs),
    }));

    return {
      orgs,
      activityDays,
      activeOrgs: activityRow.activeOrgs,
      eligibleOrgs: activityRow.totalOrgs,
      activeSharePct: pct(activityRow.activeOrgs, activityRow.totalOrgs),
      activityTrend,
      scoping: {
        tenantId: null,
        unscopedSections: ['orgs', 'activeOrgs', 'activityTrend'],
      },
      computedAt: new Date().toISOString(),
    };
  }
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
