import { Injectable } from '@nestjs/common';
import {
  COHORT_ACTIVITY_THRESHOLDS,
  CohortActivityRow,
  CohortAnalyticsRepository,
  MIN_COHORT_SIZE,
} from '../repository/cohort-analytics.repository';
import {
  CohortRetentionCellDto,
  CohortRetentionQueryDto,
  CohortRetentionResponseDto,
  CohortRetentionRowDto,
} from '../dto/cohort-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/** Whole months from `from` to `to`, both first-of-month UTC dates. */
function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

/**
 * Monthly cohort retention for the Highlights tab.
 *
 * Shapes the repository's two result sets into a dense triangle the client can
 * render without doing calendar maths of its own. Three rules do all the work,
 * and each is a data-visualisation house rule rather than a convenience:
 *
 *  - **Zero is a measurement; absent is not.** A month a cohort could have been
 *    active in but wasn't gets a real zero — "nobody practised" is a fact. A
 *    month that has not happened yet is simply absent, so the triangle's empty
 *    corner cannot be misread as a collapse to 0%.
 *  - **The current month is provisional.** It is still accruing minutes, so its
 *    cells are flagged and the client renders them as incomplete instead of
 *    letting a half-finished month read as a drop.
 *  - **Small cohorts show n, not a rate.** Below {@link MIN_COHORT_SIZE} the
 *    percentages are suppressed by the client on the `belowFloor` flag.
 *
 * Month 0 is never returned: the signup month IS the cohort, anchored at 100% by
 * definition, and measuring it would put an activation rate and a retention rate
 * on the same axis under the same name.
 */
@Injectable()
export class CohortAnalyticsService {
  constructor(private readonly repository: CohortAnalyticsRepository) {}

  async getCohortRetention(
    query: CohortRetentionQueryDto,
  ): Promise<CohortRetentionResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const [sizes, activity] = await Promise.all([
      this.repository.getCohortSizes(tenantId),
      this.repository.getCohortActivity(tenantId),
    ]);

    const currentMonth = startOfUtcMonth(new Date());
    const currentMonthIso = isoDate(currentMonth);

    // cohortMonth -> monthIndex -> counts. Built once so the per-cohort loop
    // below is a lookup rather than a scan per cell.
    const byCohort = new Map<string, Map<number, CohortActivityRow>>();
    for (const row of activity) {
      const cells =
        byCohort.get(row.cohortMonth) ?? new Map<number, CohortActivityRow>();
      cells.set(row.monthIndex, row);
      byCohort.set(row.cohortMonth, cells);
    }

    const sizeByMonth = new Map(sizes.map((s) => [s.cohortMonth, s.learners]));

    const cohorts: CohortRetentionRowDto[] = [];
    if (sizes.length > 0) {
      // Run the axis from the first signup month to the current one, filling
      // signup-less months with a zero cohort. A calendar with holes in it
      // invites the reader to compare two adjacent rows that are a year apart.
      const first = new Date(`${sizes[0].cohortMonth}T00:00:00.000Z`);
      const span = Math.max(0, monthsBetween(first, currentMonth));

      for (let i = 0; i <= span; i++) {
        const cohortDate = addMonths(first, i);
        const cohortMonth = isoDate(cohortDate);
        const learners = sizeByMonth.get(cohortMonth) ?? 0;
        const cellsByIndex = byCohort.get(cohortMonth);

        // Only months that have actually elapsed can carry a cell. The current
        // month counts: it has started, it is just not finished.
        const elapsed = monthsBetween(cohortDate, currentMonth);
        const cells: CohortRetentionCellDto[] = [];
        for (let index = 1; index <= elapsed; index++) {
          const activityMonth = isoDate(addMonths(cohortDate, index));
          const measured = cellsByIndex?.get(index);
          cells.push({
            monthIndex: index,
            activityMonth,
            activeByThreshold:
              measured?.activeByThreshold ??
              COHORT_ACTIVITY_THRESHOLDS.map(() => 0),
            partial: activityMonth === currentMonthIso,
          });
        }

        cohorts.push({
          cohortMonth,
          learners,
          belowFloor: learners > 0 && learners < MIN_COHORT_SIZE,
          cells: learners > 0 ? cells : [],
        });
      }
    }

    return {
      thresholds: [...COHORT_ACTIVITY_THRESHOLDS],
      minCohortSize: MIN_COHORT_SIZE,
      currentMonth: currentMonthIso,
      cohorts,
      // Both the population (users) and the activity (user_daily_scores) carry
      // a tenant, so unlike cost or org-count there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
