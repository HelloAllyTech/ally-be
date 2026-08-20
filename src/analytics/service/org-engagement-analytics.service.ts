import { Injectable } from '@nestjs/common';

import {
  OrgActivityPointDto,
  OrgEngagementQueryDto,
  OrgEngagementResponseDto,
  OrgFunnelStepDto,
} from '../dto/org-engagement-analytics.dto';
import {
  DEFAULT_ORG_ACTIVITY_WINDOW,
  ORG_ACTIVITY_MONTHS,
  ORG_LADDER_LEVELS,
  OrgEngagementAnalyticsRepository,
} from '../repository/org-engagement-analytics.repository';

/**
 * Org-level engagement for the Highlights "Orgs" sub-tab.
 *
 * Three panels off two queries: the ladder funnel, the "active recently"
 * headline, and the monthly activity trend behind it.
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

    const [funnelRow, activityRow, trendRows] = await Promise.all([
      this.repo.getFunnel(),
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
      levels: ORG_LADDER_LEVELS.map((l) => ({ ...l })),
      funnel: buildFunnel(funnelRow.orgs, funnelRow.atLevel),
      orgs: funnelRow.orgs,
      activityDays,
      activeOrgs: activityRow.activeOrgs,
      eligibleOrgs: activityRow.totalOrgs,
      activeSharePct: pct(activityRow.activeOrgs, activityRow.totalOrgs),
      activityTrend,
      scoping: {
        tenantId: null,
        unscopedSections: ['funnel', 'activeOrgs', 'activityTrend'],
      },
      computedAt: new Date().toISOString(),
    };
  }
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * The nested org funnel with both conversions attached.
 *
 * No minimum-group-size floor here, unlike the learner funnels: the population
 * being counted is ORGS, and an org is not a person. "2 of 40 orgs reached L3"
 * identifies a company, which is commercially sensitive but not personal data,
 * and it is precisely what an account review is for. The learner-level charts,
 * where a percentage over a handful of people names one of them, keep their floor.
 */
function buildFunnel(orgs: number, atLevel: number[]): OrgFunnelStepDto[] {
  const steps: OrgFunnelStepDto[] = [
    {
      id: 'orgs',
      label: 'Org created',
      orgs,
      ofPreviousPct: null,
      ofTopPct: orgs > 0 ? 100 : null,
    },
  ];

  ORG_LADDER_LEVELS.forEach((level, i) => {
    const atThisLevel = atLevel[i] ?? 0;
    const previous = steps[steps.length - 1].orgs;
    steps.push({
      id: level.id,
      label: level.label,
      orgs: atThisLevel,
      ofPreviousPct: pct(atThisLevel, previous),
      ofTopPct: pct(atThisLevel, orgs),
    });
  });

  return steps;
}
