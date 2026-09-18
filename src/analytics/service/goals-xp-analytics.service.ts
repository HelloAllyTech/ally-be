import { Injectable } from '@nestjs/common';

import { GoalsXpAnalyticsRepository } from '../repository/goals-xp-analytics.repository';
import {
  GoalsXpPointDto,
  GoalsXpQueryDto,
  GoalsXpResponseDto,
  XpGoalGrain,
} from '../dto/goals-xp-analytics.dto';
import { isoDate } from '../util/analytics-window.util';

const DEFAULT_GRAIN: XpGoalGrain = 'month';

/**
 * Month/quarter/year bucketing that platform-analytics.dto's ANALYTICS_BUCKETS
 * does not cover (no 'quarter' there). Kept local to this endpoint rather than
 * added to the shared bucket type, which several other charts rely on.
 */
function truncToGrain(d: Date, grain: XpGoalGrain): Date {
  if (grain === 'year') return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  if (grain === 'quarter') {
    const quarter = Math.floor(d.getUTCMonth() / 3);
    return new Date(Date.UTC(d.getUTCFullYear(), quarter * 3, 1));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function nextPeriod(d: Date, grain: XpGoalGrain): Date {
  if (grain === 'year') return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
  if (grain === 'quarter') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function periodLabel(d: Date, grain: XpGoalGrain): string {
  if (grain === 'year') return String(d.getUTCFullYear());
  if (grain === 'quarter') {
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  }
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

function generatePeriodStarts(
  start: Date,
  endExclusive: Date,
  grain: XpGoalGrain,
): Date[] {
  const periods: Date[] = [];
  for (let cur = start; cur < endExclusive; cur = nextPeriod(cur, grain)) {
    periods.push(cur);
  }
  return periods;
}

/**
 * Sums `monthGoals` into quarter/year buckets, but only for a bucket whose
 * every constituent month has a goal row — a partial quarter/year is reported
 * as no goal at all rather than a summed figure that understates the real
 * target. Same "never fabricate a target" rule as `goalXp` itself.
 */
function deriveGrainGoals(
  monthGoals: Map<string, number>,
  grain: Exclude<XpGoalGrain, 'month'>,
): Map<string, number> {
  const derived = new Map<string, number>();
  const buckets = new Map<string, Date>();
  for (const iso of monthGoals.keys()) {
    const bucketStart = truncToGrain(new Date(`${iso}T00:00:00Z`), grain);
    buckets.set(isoDate(bucketStart), bucketStart);
  }

  for (const [bucketIso, bucketStart] of buckets) {
    let sum = 0;
    let complete = true;
    for (
      let cur = bucketStart;
      cur < nextPeriod(bucketStart, grain);
      cur = nextPeriod(cur, 'month')
    ) {
      const monthGoal = monthGoals.get(isoDate(cur));
      if (monthGoal === undefined) {
        complete = false;
        break;
      }
      sum += monthGoal;
    }
    if (complete) derived.set(bucketIso, sum);
  }

  return derived;
}

/**
 * Actual XP earned vs. a goal, per month/quarter/year.
 *
 * Goals are read-only here — see {@link AnalyticsXpGoal} for why they are set
 * by migration rather than through this API. A period with no goal row comes
 * back with `goalXp: null`, not 0, so the chart can render an explicit
 * "no goal set" placeholder rather than a fabricated target.
 */
@Injectable()
export class GoalsXpAnalyticsService {
  constructor(private readonly repository: GoalsXpAnalyticsRepository) {}

  async getGoalsXp(query: GoalsXpQueryDto): Promise<GoalsXpResponseDto> {
    const grain = query.grain ?? DEFAULT_GRAIN;

    const dataFloor = await this.repository.getDataFloor();
    const now = new Date();
    const start = truncToGrain(dataFloor, grain);
    const currentPeriodStart = truncToGrain(now, grain);

    const goals = await this.getGoalsForGrain(grain);

    const currentPeriodIso = isoDate(currentPeriodStart);
    let furthestGoalIso = currentPeriodIso;
    for (const iso of goals.keys()) {
      if (iso > furthestGoalIso) furthestGoalIso = iso;
    }
    const furthestGoalStart = truncToGrain(
      new Date(`${furthestGoalIso}T00:00:00Z`),
      grain,
    );
    const endExclusive = nextPeriod(furthestGoalStart, grain);

    const actualRows = await this.repository.getActualXpByPeriod(
      grain,
      start,
      endExclusive,
    );
    const actualByPeriod = new Map(
      actualRows.map((r) => [r.periodStart, r.actualXp]),
    );

    const points: GoalsXpPointDto[] = generatePeriodStarts(
      start,
      endExclusive,
      grain,
    ).map((periodStart) => {
      const iso = isoDate(periodStart);
      const goalXp = goals.get(iso) ?? null;
      return {
        periodStart: iso,
        periodLabel: periodLabel(periodStart, grain),
        actualXp: actualByPeriod.get(iso) ?? 0,
        goalXp,
        hasGoal: goalXp !== null,
        inProgress: iso === currentPeriodIso,
        upcoming: iso > currentPeriodIso,
      };
    });

    return {
      grain,
      points,
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: now.toISOString(),
    };
  }

  /**
   * Goal rows for `grain`. For quarter/year, native rows (if any are ever
   * seeded) win over goals derived by summing constituent months — see
   * {@link deriveGrainGoals}.
   */
  private async getGoalsForGrain(
    grain: XpGoalGrain,
  ): Promise<Map<string, number>> {
    if (grain === 'month') {
      return this.repository.getGoalsByGrain('month');
    }

    const [monthGoals, nativeGoals] = await Promise.all([
      this.repository.getGoalsByGrain('month'),
      this.repository.getGoalsByGrain(grain),
    ]);
    return new Map([...deriveGrainGoals(monthGoals, grain), ...nativeGoals]);
  }
}
