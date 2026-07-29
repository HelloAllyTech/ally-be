import { Injectable } from '@nestjs/common';
import {
  OrgHealthOrgDto,
  OrgHealthQueryDto,
  OrgHealthResponseDto,
} from '../dto/org-health-analytics.dto';
import { MIN_ORG_GROUP_SIZE } from '../repository/highlights-analytics.repository';
import {
  ORG_HEALTH_ACTIVITY_DAYS,
  ORG_HEALTH_TREND_WEEKS,
  OrgHealthAnalyticsRepository,
} from '../repository/org-health-analytics.repository';
import {
  addDays,
  isoDate,
  startOfUtcDay,
  startOfUtcWeekMonday,
} from '../util/analytics-window.util';

const MS_PER_DAY = 86_400_000;

/** Utilisation carries one decimal; the underlying figures are whole credits. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The account-management agenda: which customers are fading, which are near their
 * ceiling.
 *
 * Thin by design — the repository answers the question in two passes. What lives
 * here is everything that turns two result sets into an agenda, and each of those
 * decisions is a house rule rather than a convenience:
 *
 *  - **The order IS the product.** Rows are sorted longest-silence-first, then the
 *    orgs that never started (largest first). A table sorted by size puts the
 *    healthy accounts at the top and buries the churning ones on page two, which
 *    is the opposite of what this surface is for. Sorting is done once here so
 *    every client's agenda reads the same way.
 *  - **One x-axis for every sparkline.** The 12 ISO week starts are generated once
 *    and every row's `trend` is index-aligned to them, zero-filled. Sparklines are
 *    only comparable down a column if they cover the same weeks; a row drawn from
 *    its own weeks is a chart that lies about when the activity happened.
 *  - **A rate over nothing is not zero.** `creditUtilisationPct` is null when the
 *    limit is 0. "No limit configured" rendered as 0% utilisation puts every
 *    unconfigured org at the comfortable end of the chart — the one place a reader
 *    will not look.
 *  - **Below the floor the row stays and the rates go.** An org with fewer than
 *    {@link MIN_ORG_GROUP_SIZE} learners keeps every count (an account manager has
 *    to see that the account exists) and loses its percentages, which over three
 *    learners describe three identifiable people.
 *  - **Dormant is a residual of a stated population.** `dormantOrgs` is
 *    `orgs - activeOrgs` rather than its own count, so the two always add up to the
 *    denominator printed beside them.
 */
@Injectable()
export class OrgHealthAnalyticsService {
  constructor(private readonly repository: OrgHealthAnalyticsRepository) {}

  async getOrgHealth(query: OrgHealthQueryDto): Promise<OrgHealthResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const now = new Date();
    const todayStart = startOfUtcDay(now);
    // Exclusive upper bound = start of tomorrow, so all of today counts — the same
    // convention resolveAnalyticsWindow uses for the windowed endpoints.
    const endExclusive = addDays(todayStart, 1);
    const last28Start = addDays(endExclusive, -ORG_HEALTH_ACTIVITY_DAYS);
    const prev28Start = addDays(last28Start, -ORG_HEALTH_ACTIVITY_DAYS);

    // The shared sparkline axis: 12 ISO weeks ending with the current (partial)
    // one. Generated before the query so the window asked for and the axis drawn
    // are the same object.
    const currentWeek = startOfUtcWeekMonday(todayStart);
    const trendStart = addDays(currentWeek, -7 * (ORG_HEALTH_TREND_WEEKS - 1));
    const trendBuckets: string[] = [];
    for (let i = 0; i < ORG_HEALTH_TREND_WEEKS; i++) {
      trendBuckets.push(isoDate(addDays(trendStart, 7 * i)));
    }

    const [rows, trendRows] = await Promise.all([
      this.repository.getOrgRows(last28Start, prev28Start, tenantId),
      this.repository.getWeeklyTrend(trendStart, endExclusive, tenantId),
    ]);

    // tenantId -> bucket -> count. Sparse in, dense out.
    const trendByOrg = new Map<string, Map<string, number>>();
    for (const row of trendRows) {
      const byBucket =
        trendByOrg.get(row.tenantId) ?? new Map<string, number>();
      byBucket.set(row.bucket, row.count);
      trendByOrg.set(row.tenantId, byBucket);
    }

    const orgs: OrgHealthOrgDto[] = rows
      .map((row) => {
        const belowFloor = row.learners < MIN_ORG_GROUP_SIZE;
        const byBucket = trendByOrg.get(row.tenantId);
        const daysSinceLastCompleted = row.lastCompletedAt
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - row.lastCompletedAt.getTime()) / MS_PER_DAY,
              ),
            )
          : null;

        return {
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          code: row.code,
          learners: row.learners,
          activeLearners28d: row.activeLearners28d,
          completedSimulations: row.completedSimulations,
          completedLast28d: row.completedLast28d,
          completedPrev28d: row.completedPrev28d,
          lastCompletedAt: row.lastCompletedAt
            ? row.lastCompletedAt.toISOString()
            : null,
          daysSinceLastCompleted,
          trend: trendBuckets.map((b) => byBucket?.get(b) ?? 0),
          creditLimit: row.creditLimit,
          consumedCredits: row.consumedCredits,
          // Null over a zero limit (unset is not 0% used) and null below the
          // group-size floor.
          creditUtilisationPct:
            row.creditLimit > 0 && !belowFloor
              ? round1((row.consumedCredits / row.creditLimit) * 100)
              : null,
          creditsUnset: row.learnersWithCreditLimit === 0,
          belowFloor,
        };
      })
      .sort(needsAttentionFirst);

    const activeOrgs = orgs.filter((o) => o.completedLast28d > 0).length;

    return {
      orgs,
      trendBuckets,
      summary: {
        orgs: orgs.length,
        activeOrgs,
        // A residual of the population above it, so the two cannot disagree.
        dormantOrgs: Math.max(0, orgs.length - activeOrgs),
        learners: orgs.reduce((sum, o) => sum + o.learners, 0),
      },
      minGroupSize: MIN_ORG_GROUP_SIZE,
      // Every figure on this surface is per-org by construction, so there is
      // nothing that has to stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * "Needs attention first": orgs that HAVE been active, longest silence at the top;
 * then the orgs that never started, largest first.
 *
 * The two groups are ordered on different keys because they are different problems.
 * A quiet account that used to practise is a retention problem measured in days of
 * silence. An account that has never completed a simulation has no silence to
 * measure — its urgency is how many learners are sitting behind an unused licence,
 * so size is the key there. Name is the final tie-break so the agenda does not
 * reshuffle between two identical requests.
 */
function needsAttentionFirst(a: OrgHealthOrgDto, b: OrgHealthOrgDto): number {
  const aEverActive = a.daysSinceLastCompleted !== null;
  const bEverActive = b.daysSinceLastCompleted !== null;
  if (aEverActive !== bEverActive) return aEverActive ? -1 : 1;

  if (aEverActive && bEverActive) {
    const silence =
      (b.daysSinceLastCompleted as number) -
      (a.daysSinceLastCompleted as number);
    if (silence !== 0) return silence;
  }

  if (b.learners !== a.learners) return b.learners - a.learners;
  return a.tenantName.localeCompare(b.tenantName);
}
