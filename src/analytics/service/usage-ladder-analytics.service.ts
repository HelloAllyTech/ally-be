import { Injectable } from '@nestjs/common';

import {
  USAGE_LADDER_LEVELS,
  USAGE_LADDER_MIN_PERIODS,
  UsageLadderAnalyticsRepository,
  UsageLadderGrain,
} from '../repository/usage-ladder-analytics.repository';
import { PRIMARY_CERTIFICATION_LEVEL } from '../repository/certification-analytics.repository';
import {
  UsageLadderFunnelStepDto,
  UsageLadderPeriodDto,
  UsageLadderQueryDto,
  UsageLadderResponseDto,
} from '../dto/usage-ladder-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/** Months in one quarter — the only difference between the two grains here. */
const MONTHS_PER_QUARTER = 3;

/** Start of the calendar quarter containing `d`, 00:00 UTC on Jan/Apr/Jul/Oct 1. */
function startOfUtcQuarter(d: Date): Date {
  const month = d.getUTCMonth();
  return new Date(
    Date.UTC(d.getUTCFullYear(), month - (month % MONTHS_PER_QUARTER), 1),
  );
}

/** Truncate to the start of the period containing `d`, at the requested grain. */
function startOfPeriod(d: Date, grain: UsageLadderGrain): Date {
  return grain === 'quarter' ? startOfUtcQuarter(d) : startOfUtcMonth(d);
}

/** Step one period forward, at the requested grain. */
function addPeriods(d: Date, n: number, grain: UsageLadderGrain): Date {
  return addMonths(d, grain === 'quarter' ? n * MONTHS_PER_QUARTER : n);
}

/**
 * Learner progress up the usage ladder, shaped for the Highlights sub-tab.
 *
 * Turns two result sets — per-period crossings and an as-of-now standing — into
 * one dense axis carrying both a flow and a stock series, plus a funnel with its
 * conversions already computed, so the client does no calendar maths, no running
 * sums and no percentage arithmetic of its own. Four charts read this one
 * response and therefore cannot disagree with each other.
 *
 * The rules doing the work:
 *
 *  - **The axis is a real calendar.** Every period from the axis start to the
 *    current one is present, in order, even when nothing happened in it. An axis
 *    assembled from only the periods that had crossings invites the reader to
 *    compare two adjacent bars that are a year apart.
 *  - **The axis starts early enough to have a shape.** It runs from the first
 *    period any learner practised, so the cumulative curve starts at a true zero
 *    and the climb is visible, but never spans fewer than
 *    {@link USAGE_LADDER_MIN_PERIODS} periods — a young or quiet platform still
 *    gets a readable axis rather than two bars.
 *  - **The cumulative series is monotonic.** It is the running total of the
 *    crossings and a rung is never lost, so it can only rise or stay flat.
 *    Derived here from the same rows the bars use rather than queried separately,
 *    so the two series cannot come to disagree.
 *  - **Crossings before the axis are not dropped.** They are real attainments, so
 *    they seed the opening cumulative value; otherwise the stock line would start
 *    below the number of people who actually hold the rung.
 *  - **The current period is provisional.** More learners can still cross into
 *    it, so it is flagged rather than quietly mixed in with finished periods.
 *  - **The funnel is as-of-now, not as-of-the-axis.** "Who holds L3 today" is a
 *    question about today; putting it on the time axis would imply a history it
 *    does not have — that history is the cumulative series, which is already here.
 */
@Injectable()
export class UsageLadderAnalyticsService {
  constructor(private readonly repository: UsageLadderAnalyticsRepository) {}

  async getUsageLadder(
    query: UsageLadderQueryDto,
  ): Promise<UsageLadderResponseDto> {
    const grain: UsageLadderGrain = query.grain ?? 'month';
    const tenantId = query.tenantId?.trim() || undefined;

    const [periodRows, funnelRow, firstActivityPeriod] = await Promise.all([
      this.repository.getAttainmentByPeriod(grain, tenantId),
      this.repository.getFunnel(tenantId),
      this.repository.getFirstActivityPeriod(grain, tenantId),
    ]);

    const currentPeriod = startOfPeriod(new Date(), grain);
    const currentPeriodIso = isoDate(currentPeriod);
    const startPeriod = resolveStartPeriod(
      currentPeriod,
      grain,
      firstActivityPeriod,
      periodRows[0]?.period,
    );
    const startPeriodIso = isoDate(startPeriod);

    const byPeriod = new Map(
      periodRows.map((r) => [r.period, r.newlyReachedByLevel]),
    );

    // Crossings that predate the axis seed the cumulative line's opening value.
    const cumulative = USAGE_LADDER_LEVELS.map(() => 0);
    for (const row of periodRows) {
      if (row.period >= startPeriodIso) continue;
      row.newlyReachedByLevel.forEach((n, i) => {
        cumulative[i] += n;
      });
    }

    const periods: UsageLadderPeriodDto[] = [];
    for (
      let cursor = startPeriod;
      isoDate(cursor) <= currentPeriodIso;
      cursor = addPeriods(cursor, 1, grain)
    ) {
      const period = isoDate(cursor);
      const newlyReached =
        byPeriod.get(period) ?? USAGE_LADDER_LEVELS.map(() => 0);
      newlyReached.forEach((n, i) => {
        cumulative[i] += n;
      });
      periods.push({
        period,
        newlyReached: [...newlyReached],
        cumulative: [...cumulative],
        partial: period === currentPeriodIso,
      });
    }

    return {
      grain,
      levels: USAGE_LADDER_LEVELS.map((l) => ({ ...l })),
      periods,
      currentPeriod: currentPeriodIso,
      funnel: buildFunnel(funnelRow.accounts, funnelRow.everReachedByLevel),
      accounts: funnelRow.accounts,
      certificationMinMinutes: PRIMARY_CERTIFICATION_LEVEL.minMinutes,
      // Both the population (users) and the activity (user_daily_scores) carry a
      // tenant, so nothing here has to stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * The nested funnel with both conversions attached.
 *
 * `ofPreviousPct` is null on the top row — there is nothing before "account
 * created" to convert from — and both percentages are null when their denominator
 * is zero rather than being reported as 0%: "0% of nobody reached L1" states a
 * failure that did not happen.
 */
function buildFunnel(
  accounts: number,
  everReachedByLevel: number[],
): UsageLadderFunnelStepDto[] {
  const pct = (numerator: number, denominator: number): number | null =>
    denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

  const steps: UsageLadderFunnelStepDto[] = [
    {
      id: 'accounts',
      label: 'Account created',
      learners: accounts,
      ofPreviousPct: null,
      ofTopPct: accounts > 0 ? 100 : null,
    },
  ];

  USAGE_LADDER_LEVELS.forEach((level, i) => {
    const learners = everReachedByLevel[i] ?? 0;
    const previous = steps[steps.length - 1].learners;
    steps.push({
      id: level.id,
      label: level.label,
      learners,
      ofPreviousPct: pct(learners, previous),
      ofTopPct: pct(learners, accounts),
    });
  });

  return steps;
}

/**
 * Where the axis begins: the earlier of the first practice period and the first
 * crossing period, pulled back far enough to span the minimum number of periods,
 * and never later than that minimum.
 *
 * The first crossing is checked as well as the first practice period because the
 * two can disagree — a tenant filter narrows the population while historical rows
 * are unaffected — and an axis starting after a crossing would drop a bar the
 * cumulative line still counts.
 */
function resolveStartPeriod(
  currentPeriod: Date,
  grain: UsageLadderGrain,
  firstActivityPeriod: string | null,
  firstCrossingPeriod?: string,
): Date {
  const minimumStart = addPeriods(
    currentPeriod,
    -(USAGE_LADDER_MIN_PERIODS[grain] - 1),
    grain,
  );
  const candidates = [firstActivityPeriod, firstCrossingPeriod].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  if (candidates.length === 0) return minimumStart;

  const earliest = candidates.reduce((a, b) => (a < b ? a : b));
  const earliestDate = new Date(`${earliest}T00:00:00.000Z`);
  if (Number.isNaN(earliestDate.getTime())) return minimumStart;

  return earliestDate < minimumStart
    ? startOfPeriod(earliestDate, grain)
    : minimumStart;
}
