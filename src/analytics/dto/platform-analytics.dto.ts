import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Supported time windows for the super-admin analytics overview.
 * - 30d / 90d  -> weekly buckets
 * - 12m        -> monthly buckets
 */
export const ANALYTICS_RANGES = ['30d', '90d', '12m'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Bucket granularities a client may explicitly request for a trend. */
export const ANALYTICS_BUCKETS = ['day', 'week', 'month'] as const;
export type AnalyticsBucketParam = (typeof ANALYTICS_BUCKETS)[number];

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

export class VoiceLatencyQueryDto {
  @ApiProperty({
    description: 'Time window for the voice-to-voice latency trend',
    enum: ANALYTICS_RANGES,
    default: '90d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Bucket granularity. Defaults to the range default ' +
      '(30d -> day, 90d -> week, 12m -> month) when omitted.',
    enum: ANALYTICS_BUCKETS,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_BUCKETS)
  bucket?: AnalyticsBucketParam;
}

export class VoiceLatencyPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      "How the metric was produced: 'pipeline' (live agent, full breakdown) " +
      "or 'transcript' (historical, derived from message timings)",
  })
  source!: string;

  @ApiProperty({ description: 'Turns aggregated into this bucket' })
  turns!: number;

  @ApiProperty({ description: 'Mean voice-to-voice latency (ms)' })
  avgMs!: number;

  @ApiProperty({ description: 'Median (p50) voice-to-voice latency (ms)' })
  p50Ms!: number;

  @ApiProperty({ description: 'p95 voice-to-voice latency (ms)' })
  p95Ms!: number;
}

export class VoiceLatencyResponseDto {
  @ApiProperty({
    description: 'Time window the trend was computed over',
    enum: ANALYTICS_RANGES,
  })
  range!: AnalyticsRange;

  @ApiProperty({
    description: 'Bucket granularity (day / week / month) for this range',
  })
  bucket!: string;

  @ApiProperty({
    description: 'Latency target line for reference (ms)',
  })
  targetMs!: number;

  @ApiProperty({
    description:
      'Per-bucket, per-source latency points (sorted by bucket then source). ' +
      'Buckets with no turns are omitted — latency has no meaningful zero.',
    type: [VoiceLatencyPointDto],
  })
  points!: VoiceLatencyPointDto[];
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
