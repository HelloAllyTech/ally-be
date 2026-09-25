import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';

/** Grains a goal can be set at — one row per calendar month, quarter or year. */
export const XP_GOAL_GRAINS = ['month', 'quarter', 'year'] as const;
export type XpGoalGrain = (typeof XP_GOAL_GRAINS)[number];

/**
 * Grains the chart can be grouped by. Wider than {@link XP_GOAL_GRAINS}: at
 * day, week and all-time there is no goal to compare against, so those come
 * back as actual XP only (`goalXp: null` on every point).
 */
export const XP_CHART_GRAINS = [
  'day',
  'week',
  ...XP_GOAL_GRAINS,
  'all',
] as const;
export type XpChartGrain = (typeof XP_CHART_GRAINS)[number];

/** A chart grain that can be bucketed by `date_trunc` (everything but 'all'). */
export type XpBucketGrain = Exclude<XpChartGrain, 'all'>;

export const isXpGoalGrain = (grain: XpChartGrain): grain is XpGoalGrain =>
  (XP_GOAL_GRAINS as readonly string[]).includes(grain);

export class GoalsXpQueryDto {
  @ApiProperty({
    description:
      'Period grain to group by. Goals exist only at month/quarter/year; ' +
      'day, week and all return actual XP only.',
    enum: XP_CHART_GRAINS,
    default: 'month',
    required: false,
  })
  @IsOptional()
  @IsIn(XP_CHART_GRAINS)
  grain?: XpChartGrain;
}

/** One period's actual XP earned against its goal, if one has been set. */
export class GoalsXpPointDto {
  @ApiProperty({ description: 'Period start (yyyy-mm-dd)' })
  periodStart!: string;

  @ApiProperty({
    description:
      'Human label for the period, e.g. "Jan 2026", "Q1 2026", "2026"',
  })
  periodLabel!: string;

  @ApiProperty({
    description: 'XP earned in this period, summed from xp_events',
  })
  actualXp!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Target XP for this period, or null when no goal row exists for it. ' +
      'Never fabricated as 0 — a missing goal is a fact, not an empty target.',
  })
  goalXp!: number | null;

  @ApiProperty({
    description: 'False when this period has no row in analytics_xp_goals.',
  })
  hasGoal!: boolean;

  @ApiProperty({
    description:
      'True for the period containing today. Still accruing, so its actual ' +
      'figure can only rise and is not a fair comparison against a completed period.',
  })
  inProgress!: boolean;

  @ApiProperty({
    description:
      "True for a period after today's. Nothing has happened yet, so " +
      '`actualXp` is a true zero rather than a measured figure — shown only ' +
      'when the period has a goal set, as an upcoming target.',
  })
  upcoming!: boolean;
}

export class GoalsXpResponseDto {
  @ApiProperty({ enum: XP_CHART_GRAINS })
  grain!: XpChartGrain;

  @ApiProperty({
    type: [GoalsXpPointDto],
    description:
      'Oldest first, one point per period from the fixed April 2026 chart ' +
      'floor through the furthest period with a recorded goal (native, or for ' +
      'quarter/year derived from fully-covered constituent months) — at ' +
      "least through today's in-progress period, further still when a " +
      'future goal has been set.',
  })
  points!: GoalsXpPointDto[];

  @ApiProperty({
    type: AnalyticsScopingDto,
    description:
      'Always platform-wide (tenantId null) — Goals has no tenant filter.',
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
