import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import {
  ANALYTICS_BUCKETS,
  AnalyticsBucketParam,
  AnalyticsRange,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
  ANALYTICS_RANGES,
} from './platform-analytics.dto';

/**
 * The stickiness funnel is all-time by construction: "did they ever come back"
 * cannot be asked of a window without reporting every recent signup as churned.
 * So this endpoint takes only a tenant, never a range.
 */
export class StickinessQueryDto {
  @ApiProperty({
    description: 'Narrow to a single tenant (uuid or code).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** The qualifying-session trend is a normal windowed time series. */
export class QualifiedSessionsQueryDto extends AnalyticsWindowQueryDto {}

/**
 * One rung of the stickiness funnel.
 *
 * `step` is a count of qualifying days: step 1 is "practised at all", step 2 is
 * "came back once", and so on. Rungs are NESTED — each counts learners with AT
 * LEAST that many qualifying days — so the series can only narrow.
 *
 * `ofPreviousPct` is the number that says whether people come back; `ofTopPct` is
 * the number that says how rare deep engagement is. Both are given because a
 * funnel read with only one invites the reader to compute the other wrongly. Both
 * are null when their denominator is below the response's `minPopulation`, or
 * zero: a percentage of three people names one of them, and "0% of nobody"
 * reports a failure that did not happen.
 */
export class StickinessStepDto {
  @ApiProperty({ description: 'Minimum qualifying days for this rung' })
  step!: number;

  @ApiProperty({ description: 'Admin-facing label, e.g. "Came back twice"' })
  label!: string;

  @ApiProperty({ description: 'Learners with at least `step` qualifying days' })
  learners!: number;

  @ApiProperty({
    description: 'learners / previous rung (%); null on the first rung',
    nullable: true,
    type: Number,
  })
  ofPreviousPct!: number | null;

  @ApiProperty({
    description: 'learners / first rung (%)',
    nullable: true,
    type: Number,
  })
  ofTopPct!: number | null;
}

// ── Practice spacing (EFF-51, AAQ-224) ──────────────────────────────────────
// Additive block on GET practice-stickiness, read by Highlights → Usage.

/** One band of the gap histogram. */
export class StickinessSpacingBandDto {
  @ApiProperty({
    description: 'Stable key',
    enum: ['0-1', '2-6', '7-13', '14-29', '30+'],
  })
  band!: string;

  @ApiProperty({ description: 'Axis label, e.g. "2–6 days"' })
  label!: string;

  @ApiProperty({ description: 'Smallest gap in the band, whole days' })
  minDays!: number;

  @ApiProperty({
    description:
      'Largest gap in the band, whole days; null for the open 30+ band',
    nullable: true,
    type: Number,
  })
  maxDays!: number | null;

  @ApiProperty({ description: 'Gaps in the band. Always present.' })
  gaps!: number;

  @ApiProperty({
    description:
      'gaps / totalGaps (%), 1 dp. Null below `minGapSample` gaps in total — ' +
      'a share of a handful of gaps is one learner’s habit.',
    nullable: true,
    type: Number,
  })
  sharePct!: number | null;

  @ApiProperty({
    description:
      'Distinct learners with at least one gap in the band (a learner can ' +
      'appear in several bands). Count only.',
  })
  learners!: number;
}

export class StickinessSpacingDto {
  @ApiProperty({
    description:
      'Always `all`: spacing is all-time, like the funnel beside it. A window ' +
      'would cut every gap that straddles its edge and report recent ' +
      'learners as having none.',
    enum: ['all'],
  })
  window!: 'all';

  @ApiProperty({
    description:
      'Days between consecutive countable sessions of the same learner, ' +
      'banded. A gap is WHOLE days elapsed from one session’s start to the ' +
      'next’s, so 0 = within 24 hours (back-to-back sessions in one sitting ' +
      'land here: the 0–1 band is massed practice). Every gap counts, so ' +
      'learners who practise more contribute more gaps — the KPI below is ' +
      'per learner for that reason.',
    type: [StickinessSpacingBandDto],
  })
  bands!: StickinessSpacingBandDto[];

  @ApiProperty({
    description: 'Gaps across every learner — the share denominator',
  })
  totalGaps!: number;

  @ApiProperty({
    description:
      'Fewest gaps the band shares are stated from (`MIN_SCORE_SAMPLE_SIZE`).',
  })
  minGapSample!: number;

  @ApiProperty({
    description:
      'Learners (the funnel’s population) with at least one countable session',
  })
  learnersWithSessions!: number;

  @ApiProperty({
    description:
      'Active learners: at least 2 countable sessions, so at least one gap. ' +
      'The KPI’s denominator.',
  })
  activeLearners!: number;

  @ApiProperty({
    description: 'The KPI threshold on a learner’s median gap, in days',
    example: 7,
  })
  targetDays!: number;

  @ApiProperty({
    description:
      'Active learners whose MEDIAN gap is at most `targetDays`. Count, always present.',
  })
  learnersWithinTarget!: number;

  @ApiProperty({
    description:
      'KPI: learnersWithinTarget / activeLearners (%), 1 dp — the share of ' +
      'active learners who typically come back within a week. Null below ' +
      '`minLearners` active learners.',
    nullable: true,
    type: Number,
  })
  withinTargetPct!: number | null;

  @ApiProperty({
    description:
      'Median, across active learners, of each learner’s own median gap (days). ' +
      'One value per learner so a heavy practiser counts once. Null below ' +
      '`minLearners`.',
    nullable: true,
    type: Number,
  })
  medianGapDays!: number | null;

  @ApiProperty({
    description:
      'Fewest active learners the KPI and the median are stated for ' +
      '(`MIN_COHORT_SIZE`, the same privacy floor as the funnel’s shares).',
  })
  minLearners!: number;

  @ApiProperty({
    description:
      'Source line for the card: what a gap is, the population, and the ' +
      'caveat (spacing is chosen by the learner; this describes rhythm, it ' +
      'does not show that spacing helps).',
    type: () => FoundationalSkillsProvenanceDto,
  })
  provenance!: FoundationalSkillsProvenanceDto;
}

export class StickinessResponseDto {
  @ApiProperty({
    description:
      'Minutes of practice in a DAY that make it count toward a rung. A day ' +
      'total, not a single session: two short attempts on one day qualify.',
  })
  qualifyingMinutes!: number;

  @ApiProperty({
    type: [StickinessStepDto],
    description: 'Nested funnel, first rung first',
  })
  steps!: StickinessStepDto[];

  @ApiProperty({
    description:
      'Learners past the last explicit rung — the tail, so the funnel still ' +
      'reconciles with the population without an axis nobody can read.',
  })
  beyondLastStep!: number;

  @ApiProperty({
    description:
      'Median qualifying days among learners who have at least one. Null when ' +
      'nobody qualifies. The funnel shows the shape; this is the one-number ' +
      'summary a KPI tile can carry.',
    nullable: true,
    type: Number,
  })
  medianActiveDays!: number | null;

  @ApiProperty({
    description:
      'Fewest learners a percentage may be stated for. Below it the client must ' +
      'show counts only — the server has already nulled the shares.',
  })
  minPopulation!: number;

  @ApiProperty({
    description:
      'Practice spacing (AAQ-224): gaps between consecutive countable sessions, ' +
      'all-time, over the same learners as the funnel. Shares and the KPI are ' +
      'floored server-side; counts always travel.',
    type: () => StickinessSpacingDto,
  })
  spacing!: StickinessSpacingDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}

/**
 * One bucket of the qualifying-session trend.
 *
 * `qualifiedSessions` is the answer to "how many real practice sessions did we
 * run"; `completedSessions` is there so a fall can be read. A drop in qualifying
 * sessions means something different when total sessions fell with it (a quieter
 * platform) than when they did not (sessions getting shorter, or failing early),
 * and the share is the only way to tell which happened.
 */
export class QualifiedSessionPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;

  @ApiProperty({ description: 'Completed sessions of >= qualifyingMinutes' })
  qualifiedSessions!: number;

  @ApiProperty({ description: 'All completed, timed sessions in the bucket' })
  completedSessions!: number;

  @ApiProperty({
    description:
      'qualifiedSessions / completedSessions (%); null in a bucket with no ' +
      'completed session, where the share is undefined rather than zero.',
    nullable: true,
    type: Number,
  })
  qualifiedSharePct!: number | null;
}

export class QualifiedSessionsResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;

  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({ description: 'Minutes that make a session count' })
  qualifyingMinutes!: number;

  @ApiProperty({
    type: [QualifiedSessionPointDto],
    description:
      'Gap-filled to a contiguous bucket axis with real zeros — a count has a ' +
      'meaningful zero, and "no session ran that week" is a fact.',
  })
  points!: QualifiedSessionPointDto[];

  @ApiProperty({ description: 'Qualifying sessions across the whole window' })
  totalQualifiedSessions!: number;

  @ApiProperty({ description: 'Completed sessions across the whole window' })
  totalCompletedSessions!: number;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
