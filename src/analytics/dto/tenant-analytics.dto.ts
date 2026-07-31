import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ANALYTICS_RANGES, AnalyticsRange } from './platform-analytics.dto';

/**
 * DTOs for the tenant-scoped Organization Metrics dashboard (helpline
 * dashboard, tenant admins). The response is deliberately shaped as a
 * `summary` block plus per-metric trends so new organization metrics can be
 * added as extra fields without breaking existing clients.
 */

export class OrganizationMetricsQueryDto {
  @ApiProperty({
    description: 'Time window for the organization metrics',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

export class OrganizationMetricsSummaryDto {
  @ApiProperty({
    description: 'Simulations completed across the organization in the window',
  })
  simulationsCompleted!: number;

  @ApiProperty({
    description: 'Users who completed at least one simulation in the window',
  })
  activeUsers!: number;

  @ApiProperty({
    description: 'New learner accounts created in the window',
  })
  newLearnersOnboarded!: number;

  @ApiProperty({
    description:
      'All-time learner headcount as of now (point-in-time, not window-scoped)',
  })
  totalRegisteredLearners!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Completed sessions / active learners in the window; null when there were no active learners',
  })
  avgSessionsPerActiveLearner!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Avg minutes of practice per active learner in the window (from session durations with recorded call time); null when there were no active learners',
  })
  avgPracticeMinutesPerLearner!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Mean days from account creation to first completed session, over learners onboarded in the window who have had one; null when none have yet',
  })
  avgDaysToFirstSession!: number | null;

  @ApiProperty({
    description:
      'Sample size (n) backing avgDaysToFirstSession — learners onboarded in the window who have had a first session',
  })
  learnersWithFirstSessionCount!: number;
}

export class OrganizationMetricsSimulationUsageDto {
  @ApiProperty() scenarioId!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Completed sessions in the window' })
  sessionCount!: number;
}

export class OrganizationMetricsTrendPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({ description: 'Metric value for this bucket' })
  count!: number;
}

export class OrganizationMetricsResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES })
  range!: AnalyticsRange;

  @ApiProperty({ description: 'Bucket granularity (day / week / month)' })
  bucket!: string;

  @ApiProperty({ type: OrganizationMetricsSummaryDto })
  summary!: OrganizationMetricsSummaryDto;

  @ApiProperty({
    type: [OrganizationMetricsTrendPointDto],
    description: 'Simulations completed per bucket (zero-filled)',
  })
  simulationsCompletedTrend!: OrganizationMetricsTrendPointDto[];

  @ApiProperty({
    type: [OrganizationMetricsTrendPointDto],
    description: 'Users with >=1 completed simulation per bucket (zero-filled)',
  })
  activeUsersTrend!: OrganizationMetricsTrendPointDto[];

  @ApiProperty({
    type: [OrganizationMetricsTrendPointDto],
    description: 'New learners onboarded per bucket (zero-filled)',
  })
  newLearnersOnboardedTrend!: OrganizationMetricsTrendPointDto[];

  @ApiProperty({
    type: [OrganizationMetricsSimulationUsageDto],
    description:
      'Top scenarios by completed-session count in the window, most-used first',
  })
  mostUsedSimulations!: OrganizationMetricsSimulationUsageDto[];
}
