import { Injectable } from '@nestjs/common';
import {
  MIN_USAGE_POPULATION,
  MonthlyLearnerCountRow,
  USAGE_LEVEL_BANDS,
  USAGE_LEVEL_MONTHS,
  USAGE_LEVEL_ZERO_BAND_LABEL,
  UsageLevelAnalyticsRepository,
} from '../repository/usage-level-analytics.repository';
import {
  UsageLevelMonthDto,
  UsageLevelQueryDto,
  UsageLevelResponseDto,
} from '../dto/usage-level-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/**
 * Monthly usage-level distribution for the Highlights tab.
 *
 * Shapes three result sets into one dense monthly axis so the client renders it
 * without doing calendar maths or cumulative sums of its own. The rules doing the
 * work are data-visualisation house rules rather than conveniences:
 *
 *  - **The axis is a real calendar.** Every month from the window start to the
 *    current one is present, in order, even if nothing happened in it. A month
 *    list assembled from the months that happened to have activity invites the
 *    reader to compare two adjacent bars that are a quarter apart.
 *  - **Zero is a measurement; a zero denominator is not.** A month where nobody
 *    practised gets real zeros. A month before the population existed has no
 *    denominator, so its share is undefined rather than zero — it is returned
 *    with zeros and the client drops it instead of drawing a bar for nobody.
 *  - **The current month is provisional.** It is still accruing minutes, so every
 *    learner in it is banded lower than they will finish. It is flagged rather
 *    than quietly mixed in with the completed months.
 *  - **Numerators once, denominators twice.** The bands are counted a single
 *    time; the two denominators travel alongside them so the client can switch
 *    definition without a refetch and the two can never end up dividing
 *    different numerators.
 */
@Injectable()
export class UsageLevelAnalyticsService {
  constructor(private readonly repository: UsageLevelAnalyticsRepository) {}

  async getUsageLevels(
    query: UsageLevelQueryDto,
  ): Promise<UsageLevelResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const currentMonth = startOfUtcMonth(new Date());
    const firstMonth = addMonths(currentMonth, -USAGE_LEVEL_MONTHS);
    // Exclusive: the start of next month, so all of the current month counts.
    const endExclusive = addMonths(currentMonth, 1);

    const [bandRows, signups, firstPractice] = await Promise.all([
      this.repository.getMonthlyBandCounts(firstMonth, endExclusive, tenantId),
      this.repository.getLearnerSignupsByMonth(tenantId),
      this.repository.getFirstPracticeMonths(tenantId),
    ]);

    const bandsByMonth = new Map(bandRows.map((r) => [r.month, r]));
    const currentMonthIso = isoDate(currentMonth);

    const months: UsageLevelMonthDto[] = [];
    for (let i = 0; i <= USAGE_LEVEL_MONTHS; i++) {
      const monthDate = addMonths(firstMonth, i);
      const month = isoDate(monthDate);
      const measured = bandsByMonth.get(month);

      months.push({
        month,
        learnersByBand:
          measured?.learnersByBand ?? USAGE_LEVEL_BANDS.map(() => 0),
        activeLearners: measured?.activeLearners ?? 0,
        // Both denominators are "by the END of this month", so they include
        // everyone who joined or activated during it — the same period the band
        // counts cover.
        registeredLearners: cumulativeThrough(signups, month),
        activatedLearners: cumulativeThrough(firstPractice, month),
        partial: month === currentMonthIso,
      });
    }

    return {
      bands: USAGE_LEVEL_BANDS.map((b) => ({ ...b })),
      zeroBandLabel: USAGE_LEVEL_ZERO_BAND_LABEL,
      completeMonths: USAGE_LEVEL_MONTHS,
      minPopulationSize: MIN_USAGE_POPULATION,
      currentMonth: currentMonthIso,
      months,
      // Both the population (users) and the activity (user_daily_scores) carry a
      // tenant, so unlike AI cost or org counts there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * Learners counted in every month up to and including `month`.
 *
 * The repository returns these keyed on the month they happened in, ALL TIME, and
 * the running total is what makes a denominator. Summed here rather than in SQL
 * because the rows are per-month and few, and because the same helper then serves
 * both denominators identically — two window functions would be two chances for
 * them to differ.
 */
function cumulativeThrough(
  rows: MonthlyLearnerCountRow[],
  month: string,
): number {
  return rows.reduce(
    (sum, r) => (r.month <= month ? sum + r.learners : sum),
    0,
  );
}
