import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
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

/**
 * Per-learner usage table (tenant-admin dashboard): one row per LEARNER-role
 * user, so an admin can see who is and isn't using Ally rather than only the
 * org-wide averages above it.
 */

export const LEARNER_USAGE_SORT_FIELDS = [
  'name',
  'email',
  'signupDate',
  'lastPracticeSessionAt',
  'roleplaySessionsStarted',
  'roleplaySessionsCompleted',
  'avgScore',
  'totalPracticeMinutes',
  'coursesAssigned',
  'coursesStarted',
  'coursesCompleted',
] as const;
export type LearnerUsageSortField = (typeof LEARNER_USAGE_SORT_FIELDS)[number];

export const LEARNER_USAGE_STATUSES = [
  'never_started',
  'active',
  'at_risk',
  'dormant',
] as const;
export type LearnerUsageStatus = (typeof LEARNER_USAGE_STATUSES)[number];

export class LearnerUsageQueryDto {
  @ApiProperty({
    description:
      'Time window for the period-scoped columns (roleplay sessions, avg score, practice minutes). Last-practice-session, signup date, and course columns are always all-time.',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description: 'Case-insensitive match against learner name or email',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    enum: LEARNER_USAGE_SORT_FIELDS,
    default: 'lastPracticeSessionAt',
    required: false,
  })
  @IsOptional()
  @IsIn(LEARNER_USAGE_SORT_FIELDS)
  sortBy?: LearnerUsageSortField;

  @ApiProperty({ enum: ['ASC', 'DESC'], default: 'ASC', required: false })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';

  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class LearnerUsageRowDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ description: 'Account creation date (all-time)' })
  signupDate!: Date;

  @ApiProperty({
    nullable: true,
    description:
      'Most recent roleplay session (all-time, not window-scoped); null if the learner has never started one',
  })
  lastPracticeSessionAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Days since lastPracticeSessionAt; null if the learner has never started a session',
  })
  daysSinceLastActivity!: number | null;

  @ApiProperty({
    enum: LEARNER_USAGE_STATUSES,
    description:
      'never_started (no sessions ever) / active (≤14 days) / at_risk (15–30 days) / dormant (>30 days)',
  })
  status!: LearnerUsageStatus;

  @ApiProperty({ description: 'Roleplay sessions started in the window' })
  roleplaySessionsStarted!: number;

  @ApiProperty({ description: 'Roleplay sessions completed in the window' })
  roleplaySessionsCompleted!: number;

  @ApiProperty({
    nullable: true,
    description:
      'roleplaySessionsCompleted / roleplaySessionsStarted as a percentage; null when nothing was started',
  })
  roleplayCompletionRatePct!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Avg composite score across completed sessions in the window',
  })
  avgScore!: number | null;

  @ApiProperty({ description: 'Practice minutes in the window' })
  totalPracticeMinutes!: number;

  @ApiProperty({ description: 'Track 2.0 enrollments (all-time)' })
  coursesAssigned!: number;

  @ApiProperty({ description: 'Enrollments with startedAt set (all-time)' })
  coursesStarted!: number;

  @ApiProperty({ description: 'Enrollments with completedAt set (all-time)' })
  coursesCompleted!: number;

  @ApiProperty({
    nullable: true,
    description:
      'coursesCompleted / coursesAssigned as a percentage; null when nothing is assigned',
  })
  courseCompletionRatePct!: number | null;
}

export class LearnerUsageResponseDto {
  @ApiProperty({
    enum: ANALYTICS_RANGES,
    description: 'Window applied to the period-scoped columns',
  })
  range!: AnalyticsRange;

  @ApiProperty({ type: [LearnerUsageRowDto] })
  data!: LearnerUsageRowDto[];

  @ApiProperty({
    description: 'Total learners matching the filter (for pagination)',
  })
  count!: number;
}
