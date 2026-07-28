import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
} from './platform-analytics.dto';

export class AnalyticsHighlightsQueryDto {
  @ApiProperty({ enum: ANALYTICS_RANGES, default: '30d', required: false })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Bucket granularity; defaults to the range default ' +
      '(30d -> day, 90d -> week, 12m -> month).',
    enum: ANALYTICS_BUCKETS,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_BUCKETS)
  bucket?: AnalyticsBucketParam;
}

/** KPI-strip scalars for the leadership Highlights tab. */
export class HighlightsSummaryDto {
  @ApiProperty({
    description: 'Distinct orgs with >=1 completed simulation in range',
  })
  activeOrgs!: number;

  @ApiProperty({ description: 'Completed simulations in range' })
  completedSimulations!: number;

  @ApiProperty({ description: 'Total minutes practiced in range' })
  practiceMinutes!: number;

  @ApiProperty({
    description: 'Mean composite evaluation score (0-100) in range',
    nullable: true,
    type: Number,
  })
  avgCompositeScore!: number | null;

  @ApiProperty({ description: 'Evaluated sessions backing the mean score' })
  evaluatedSessions!: number;

  @ApiProperty({
    description: 'Mean post-session learner rating in range',
    nullable: true,
    type: Number,
  })
  avgCsat!: number | null;

  @ApiProperty({ description: 'Learner rating responses in range' })
  csatResponses!: number;

  @ApiProperty({
    description:
      'completed / enrolled (%) for the enrollment cohort created in range',
    nullable: true,
    type: Number,
  })
  trackCompletionRatePct!: number | null;

  @ApiProperty({
    description: 'passed / graded quiz attempts (%) in range',
    nullable: true,
    type: Number,
  })
  quizPassRatePct!: number | null;

  @ApiProperty({
    description:
      'Estimated platform AI spend (USD) in range, priced at read time',
  })
  totalAiCostUsd!: number;

  @ApiProperty({
    description: 'totalAiCostUsd / completedSimulations',
    nullable: true,
    type: Number,
  })
  costPerCompletedSimUsd!: number | null;
}

export class TopOrgRowDto {
  @ApiProperty({ description: 'Raw scenario_sessions.tenant_id value' })
  tenantId!: string;

  @ApiProperty({
    description: 'Tenant name; falls back to the raw id when unresolvable',
  })
  tenantName!: string;

  @ApiProperty() completedSimulations!: number;
}

export class PracticeMinutesPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({ description: 'Minutes practiced in the bucket' })
  minutes!: number;
  @ApiProperty({ description: 'Distinct learners active in the bucket' })
  activeLearners!: number;
}

export class QualityTrendPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({
    description: 'Mean composite evaluation score (0-100)',
    nullable: true,
    type: Number,
  })
  avgCompositeScore!: number | null;
  @ApiProperty() evaluatedSessions!: number;
}

export class CsatTrendPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({
    description: 'Mean learner rating in the bucket',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;
  @ApiProperty() responses!: number;
}

export class TrackFunnelDto {
  @ApiProperty({ description: 'Enrollments created in range' })
  enrolled!: number;
  @ApiProperty({ description: 'Of those, enrollments with startedAt set' })
  started!: number;
  @ApiProperty({ description: 'Of those, enrollments with completedAt set' })
  completed!: number;
  @ApiProperty({ description: 'Graded quiz attempts in range' })
  quizAttempts!: number;
  @ApiProperty({ description: 'Graded quiz attempts that passed' })
  quizPassed!: number;
  @ApiProperty({ nullable: true, type: Number })
  quizPassRatePct!: number | null;
}

export class CostPerSimPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({ description: 'Estimated AI spend (USD) in the bucket' })
  estimatedCostUsd!: number;
  @ApiProperty() completedSimulations!: number;
  @ApiProperty({
    description: 'estimatedCostUsd / completedSimulations; null when 0 sims',
    nullable: true,
    type: Number,
  })
  costPerSimUsd!: number | null;
  @ApiProperty({
    description: 'AI calls in the bucket with no pricing entry (cost 0)',
  })
  unpricedCalls!: number;
}

/**
 * Leadership "Highlights" aggregates. Only the metrics NOT already served by
 * `/v1/analytics/overview` or `/v1/analytics/scribe/overview` live here; the
 * frontend composes all three responses into one tab.
 */
export class AnalyticsHighlightsResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;

  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: string;

  @ApiProperty({ type: HighlightsSummaryDto })
  summary!: HighlightsSummaryDto;

  @ApiProperty({ type: [TopOrgRowDto] })
  topOrgs!: TopOrgRowDto[];

  @ApiProperty({
    type: [PracticeMinutesPointDto],
    description: 'Gap-filled to a contiguous bucket axis',
  })
  practiceMinutes!: PracticeMinutesPointDto[];

  @ApiProperty({
    type: [QualityTrendPointDto],
    description: 'Sparse — buckets with no evaluated sessions are absent',
  })
  qualityTrend!: QualityTrendPointDto[];

  @ApiProperty({
    type: [CsatTrendPointDto],
    description: 'Sparse — buckets with no ratings are absent',
  })
  csatTrend!: CsatTrendPointDto[];

  @ApiProperty({ type: TrackFunnelDto })
  trackFunnel!: TrackFunnelDto;

  @ApiProperty({
    type: [CostPerSimPointDto],
    description: 'Gap-filled to a contiguous bucket axis',
  })
  costPerSim!: CostPerSimPointDto[];
}
