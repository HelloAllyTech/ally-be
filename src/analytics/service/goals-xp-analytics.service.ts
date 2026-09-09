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
    const endExclusive = nextPeriod(currentPeriodStart, grain);

    const [actualRows, goals] = await Promise.all([
      this.repository.getActualXpByPeriod(grain, start, endExclusive),
      this.repository.getGoalsByGrain(grain),
    ]);
    const actualByPeriod = new Map(
      actualRows.map((r) => [r.periodStart, r.actualXp]),
    );

    const currentPeriodIso = isoDate(currentPeriodStart);
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
      };
    });

    return {
      grain,
      points,
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: now.toISOString(),
    };
  }
}
