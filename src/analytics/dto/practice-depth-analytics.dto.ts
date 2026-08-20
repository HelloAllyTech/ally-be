import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

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
