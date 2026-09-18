import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';

/** Period grains the Goals chart supports. No day/week — a goal is set per calendar month, quarter or year. */
export const XP_GOAL_GRAINS = ['month', 'quarter', 'year'] as const;
export type XpGoalGrain = (typeof XP_GOAL_GRAINS)[number];

export class GoalsXpQueryDto {
  @ApiProperty({
    description: 'Period grain to group by.',
    enum: XP_GOAL_GRAINS,
    default: 'month',
    required: false,
  })
  @IsOptional()
  @IsIn(XP_GOAL_GRAINS)
  grain?: XpGoalGrain;
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
  @ApiProperty({ enum: XP_GOAL_GRAINS })
  grain!: XpGoalGrain;

  @ApiProperty({
    type: [GoalsXpPointDto],
    description:
      'Oldest first, one point per period from the platform data floor ' +
      'through the furthest period with a recorded goal (native, or for ' +
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
