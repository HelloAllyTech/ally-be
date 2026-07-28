import { ApiProperty } from '@nestjs/swagger';
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsRange,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Window/compare/tenant params come from the shared base; the bucket default
 * for this endpoint is 30d -> day, 90d -> week, 12m -> month.
 */
export class AnalyticsHighlightsQueryDto extends AnalyticsWindowQueryDto {}

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
    description:
      'Calls whose model has no pricing entry. They contribute $0, so ' +
      '`totalAiCostUsd` understates real spend by an unknown amount whenever ' +
      'this is non-zero — surfaces must say so rather than present the total ' +
      'as complete.',
  })
  unpricedCalls!: number;

  @ApiProperty({
    description: 'totalAiCostUsd / completedSimulations',
    nullable: true,
    type: Number,
  })
  costPerCompletedSimUsd!: number | null;
}

/**
 * The tail of orgs too small to name, aggregated. Keeps the total honest without
 * re-identifying the learners in a two-person org (see MIN_ORG_GROUP_SIZE).
 */
export class TopOrgsBelowFloorDto {
  @ApiProperty({ description: 'Orgs below the minimum group size' })
  orgs!: number;

  @ApiProperty({ description: 'Their combined completed simulations' })
  completedSimulations!: number;
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

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: HighlightsSummaryDto })
  summary!: HighlightsSummaryDto;

  @ApiProperty({
    type: HighlightsSummaryDto,
    nullable: true,
    description:
      'Same aggregates over the equal-length preceding window, present only ' +
      'when `compare=prev`. This is the basis a KPI delta is stated against — ' +
      'without it the UI must show the bare number, not a change.',
  })
  previous!: HighlightsSummaryDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Label for `previous`, e.g. "previous 30 days"',
  })
  previousLabel!: string | null;

  @ApiProperty({
    type: [TopOrgRowDto],
    description:
      'Named orgs at or above the minimum group size, descending. The rest are ' +
      'aggregated into `topOrgsBelowFloor`.',
  })
  topOrgs!: TopOrgRowDto[];

  @ApiProperty({ type: TopOrgsBelowFloorDto })
  topOrgsBelowFloor!: TopOrgsBelowFloorDto;

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
