import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Supported time windows for the super-admin analytics overview.
 * - 30d / 90d  -> weekly buckets
 * - 12m        -> monthly buckets
 */
export const ANALYTICS_RANGES = ['30d', '90d', '12m'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export class AnalyticsOverviewQueryDto {
  @ApiProperty({
    description: 'Time window for the analytics overview',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

export class AnalyticsSummaryDto {
  @ApiProperty({ description: 'Total registered users on the platform' })
  totalUsers!: number;

  @ApiProperty({ description: 'Distinct users active in the last 30 days' })
  activeUsers30d!: number;

  @ApiProperty({ description: 'Simulations completed in the current ISO week' })
  simsThisWeek!: number;

  @ApiProperty({
    description:
      'Retention rate (%) — returning active users ÷ all active users over the last 30 days',
  })
  retentionRatePct!: number;
}

export class UserGrowthPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  date!: string;

  @ApiProperty({ description: 'New users registered in this bucket' })
  newUsers!: number;

  @ApiProperty({
    description: 'Cumulative users up to and including this bucket',
  })
  cumulativeUsers!: number;
}

export class ActiveUsersPointDto {
  @ApiProperty({ description: 'Day (ISO yyyy-mm-dd)' })
  date!: string;

  @ApiProperty({ description: 'Daily active users' })
  dau!: number;

  @ApiProperty({ description: 'Weekly active users (trailing 7 days)' })
  wau!: number;

  @ApiProperty({ description: 'Monthly active users (trailing 30 days)' })
  mau!: number;
}

export class SimulationsCompletedPointDto {
  @ApiProperty({ description: 'ISO week start date (yyyy-mm-dd)' })
  weekStart!: string;

  @ApiProperty({ description: 'Number of simulations completed in the week' })
  count!: number;
}

export class RetentionPointDto {
  @ApiProperty({ description: 'ISO week start date (yyyy-mm-dd)' })
  weekStart!: string;

  @ApiProperty({
    description: 'Active users whose account was created in this week',
  })
  newUsers!: number;

  @ApiProperty({ description: 'Active users whose account predates this week' })
  returningUsers!: number;
}

export class UsersByRolePointDto {
  @ApiProperty({ description: 'Role / group name (e.g. SUPER_ADMIN, LEARNER)' })
  role!: string;

  @ApiProperty({ description: 'Distinct users in this role' })
  count!: number;
}

export class AnalyticsOverviewResponseDto {
  @ApiProperty({ type: AnalyticsSummaryDto })
  summary!: AnalyticsSummaryDto;

  @ApiProperty({ type: [UserGrowthPointDto] })
  userGrowth!: UserGrowthPointDto[];

  @ApiProperty({ type: [ActiveUsersPointDto] })
  activeUsers!: ActiveUsersPointDto[];

  @ApiProperty({ type: [SimulationsCompletedPointDto] })
  simulationsCompleted!: SimulationsCompletedPointDto[];

  @ApiProperty({ type: [RetentionPointDto] })
  retention!: RetentionPointDto[];

  @ApiProperty({ type: [UsersByRolePointDto] })
  usersByRole!: UsersByRolePointDto[];
}
