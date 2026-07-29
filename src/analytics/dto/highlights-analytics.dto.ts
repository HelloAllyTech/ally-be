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

  @ApiProperty({
    description:
      'Mean length of one completed simulation, in minutes, over the whole ' +
      'range. Computed over the raw sessions, not re-averaged from the buckets.',
    nullable: true,
    type: Number,
  })
  avgPlayTimeMinutes!: number | null;

  @ApiProperty({
    description: 'Timed sessions backing the mean session length',
  })
  playTimeSessions!: number;
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

/**
 * How long one simulation lasts, per bucket. Median and p95 travel with the
 * mean because session length is skewed — an average with no distribution
 * behind it is a half-truth.
 *
 * The three figures are NULL in a bucket with no completed, timed session.
 * Null rather than absent, and null rather than zero: absent would collapse the
 * x-axis so a quiet fortnight rendered as two adjacent days, and zero would
 * draw a crash in session length where there was simply nobody practising.
 * `sessions` is a count, so its zero is a real zero.
 */
export class PlayTimePointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({
    description: 'Mean session length (minutes); null if nothing was timed',
    nullable: true,
    type: Number,
  })
  avgMinutes!: number | null;
  @ApiProperty({
    description: 'Median session length (minutes); null if nothing was timed',
    nullable: true,
    type: Number,
  })
  medianMinutes!: number | null;
  @ApiProperty({
    description: 'p95 session length (minutes); null if nothing was timed',
    nullable: true,
    type: Number,
  })
  p95Minutes!: number | null;
  @ApiProperty({ description: 'Timed sessions behind this bucket' })
  sessions!: number;
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
    type: [PlayTimePointDto],
    description:
      'On the contiguous bucket axis, but gap-filled with NULLs rather than ' +
      'zeros: an average has no meaningful zero, and a bucket with no session ' +
      'has no value. The axis stays a real calendar; the line breaks.',
  })
  playTime!: PlayTimePointDto[];

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
