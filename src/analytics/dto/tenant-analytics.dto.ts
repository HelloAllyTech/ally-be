import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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
  'lastActivityAt',
  'status',
  'roleplaySessionsStarted',
  'roleplaySessionsCompleted',
  'avgScore',
  'totalPracticeMinutes',
  'roleplayPointsPerMinute',
  'coursesAssigned',
  'coursesStarted',
  'coursesCompleted',
  'level',
  'totalXp',
  'itemsCompleted',
  'itemsCompletedPct',
  'quizzesPassed',
  'avgQuizScorePct',
  'readWatchCompleted',
  'reflectionCompleted',
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
      'Time window for the period-scoped columns (roleplay sessions, avg score, practice minutes). Last-activity, signup date, level/XP, course and course-item columns are always all-time.',
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
    description:
      "Status facet; omitted means every status. Accepts a comma-separated list (`?status=dormant,never_started`) or a repeated param — RTK Query's fetchBaseQuery comma-joins arrays, so the frontend sends the former. Applied in SQL, so `count` reflects the filter.",
    enum: LEARNER_USAGE_STATUSES,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    const parts = Array.isArray(value) ? value : String(value).split(',');
    // A trailing/empty value means "no filter" rather than "match nothing".
    return parts.map((v: string) => String(v).trim()).filter(Boolean);
  })
  @IsArray()
  @IsIn(LEARNER_USAGE_STATUSES, { each: true })
  status?: LearnerUsageStatus[];

  @ApiProperty({
    enum: LEARNER_USAGE_SORT_FIELDS,
    default: 'lastActivityAt',
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
      'Last sign of life anywhere — the later of lastPracticeSessionAt and the most recent course activity. This is what status is derived from.',
  })
  lastActivityAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Days since lastActivityAt; null if the learner has never done anything',
  })
  daysSinceLastActivity!: number | null;

  @ApiProperty({
    enum: LEARNER_USAGE_STATUSES,
    description:
      'never_started (nothing ever) / active (≤14 days) / at_risk (15–30 days) / dormant (>30 days), measured on lastActivityAt',
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

  @ApiProperty({
    nullable: true,
    description:
      "Composite score summed over the window's completed sessions divided by those practice minutes. Null when the window holds no measurable practice time (never 0). Can be negative — composite scores go below zero.",
  })
  roleplayPointsPerMinute!: number | null;

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

  @ApiProperty({ description: 'Level ladder position, 1-10 (all-time)' })
  level!: number;

  @ApiProperty({ description: 'Lifetime XP (all-time)' })
  totalXp!: number;

  @ApiProperty({
    description:
      'Course items across every enrolled course, locked ones included (all-time)',
  })
  itemsTotal!: number;

  @ApiProperty({ description: 'Course items completed (all-time)' })
  itemsCompleted!: number;

  @ApiProperty({
    nullable: true,
    description:
      'itemsCompleted / itemsTotal as a percentage; null when nothing is enrolled',
  })
  itemsCompletedPct!: number | null;

  @ApiProperty({ description: 'Quiz items passed (all-time)' })
  quizzesPassed!: number;

  @ApiProperty({
    description:
      'Quiz items with at least one graded attempt — the denominator behind avgQuizScorePct',
  })
  quizzesAttempted!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Avg of the latest graded attempt per quiz item, so repeat failures show; null when nothing is graded',
  })
  avgQuizScorePct!: number | null;

  @ApiProperty({ description: 'ARTICLE + VIDEO items completed (all-time)' })
  readWatchCompleted!: number;

  @ApiProperty({
    description:
      'JOURNAL + ANNOTATED_ARTIFACT + GAME items completed (all-time)',
  })
  reflectionCompleted!: number;
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

/**
 * Per-course usage table (tenant-admin dashboard): one row per Track 2.0
 * course visible to the tenant. Deliberately all-time throughout — see
 * {@link TenantAnalyticsRepository.getCourseUsageRows} for why.
 */

export const COURSE_USAGE_SORT_FIELDS = [
  'title',
  'status',
  'totalItems',
  'learnersStarted',
  'learnersAtLeast50',
  'learnersCompleted100',
  'avgCompletionDays',
  'medianCompletionDays',
  'avgScore',
  'lastEnrollmentAt',
] as const;
export type CourseUsageSortField = (typeof COURSE_USAGE_SORT_FIELDS)[number];

export class CourseUsageQueryDto {
  @ApiProperty({
    description: 'Case-insensitive match against course title',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    enum: COURSE_USAGE_SORT_FIELDS,
    default: 'learnersStarted',
    required: false,
  })
  @IsOptional()
  @IsIn(COURSE_USAGE_SORT_FIELDS)
  sortBy?: CourseUsageSortField;

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

export class CourseUsageRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: 'ACTIVE' | 'ARCHIVED';
  @ApiProperty() totalItems!: number;

  @ApiProperty({
    description:
      'Tenant\'s total learner headcount (all-time) — not a per-course assignment count. Track 2.0 has no per-learner "assigned but not started" event, so every active catalog course is implicitly available to every learner in a tenant that has it enabled.',
  })
  learnersAssigned!: number;

  @ApiProperty({
    description: 'Distinct learners who have enrolled (all-time)',
  })
  learnersStarted!: number;

  @ApiProperty({
    nullable: true,
    description:
      'learnersAtLeast50 / learnersStarted as a percentage; null when nothing was started',
  })
  startedRatePct!: number | null;

  @ApiProperty({
    description:
      'Learners with completedItems / totalItems >= 50% (includes full completers)',
  })
  learnersAtLeast50!: number;

  @ApiProperty({
    nullable: true,
    description:
      'learnersAtLeast50 / learnersStarted as a percentage; null when nothing was started',
  })
  completion50PlusRatePct!: number | null;

  @ApiProperty({ description: 'Learners who reached 100% completion' })
  learnersCompleted100!: number;

  @ApiProperty({
    nullable: true,
    description:
      'learnersCompleted100 / learnersStarted as a percentage; null when nothing was started',
  })
  completion100RatePct!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Avg days from startedAt to completedAt, over 100%-completers only; null when none have completed',
  })
  avgCompletionDays!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Median days from startedAt to completedAt, over 100%-completers only; null when none have completed',
  })
  medianCompletionDays!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Avg score across graded items for this course; null when nothing is scored',
  })
  avgScore!: number | null;

  @ApiProperty({
    description:
      'Enrolled, not yet 100% complete, with activity in the last 14 days',
  })
  inProgressActive!: number;

  @ApiProperty({
    description:
      'Enrolled, not yet 100% complete, with no activity in the last 14 days (or never active beyond enrollment)',
  })
  inProgressStalled!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Most recent enrollment date (all-time); null if never enrolled',
  })
  lastEnrollmentAt!: Date | null;
}

export class CourseUsageResponseDto {
  @ApiProperty({ type: [CourseUsageRowDto] })
  data!: CourseUsageRowDto[];

  @ApiProperty({
    description: 'Total courses matching the filter (for pagination)',
  })
  count!: number;
}
