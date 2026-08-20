import { ApiProperty } from '@nestjs/swagger';

import {
  ANALYTICS_BUCKETS,
  ANALYTICS_RANGES,
  AnalyticsBucketParam,
  AnalyticsRange,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';
import { COST_AREAS } from '../repository/roleplay-cost-analytics.repository';

export class RoleplayCostQueryDto extends AnalyticsWindowQueryDto {}

/** Spend in one bucket, split the two ways a reader asks for. */
export class CostBreakdownDto {
  @ApiProperty({ description: 'Live roleplay: agent turns, STT and TTS' })
  roleplay!: number;

  @ApiProperty({ description: 'Post-session evaluation, summary, memory fold' })
  feedback!: number;

  @ApiProperty({ description: 'Track quiz grading' })
  quiz!: number;

  @ApiProperty({ description: 'Language-model calls across all three areas' })
  llm!: number;

  @ApiProperty({ description: 'Speech-to-text across all three areas' })
  stt!: number;

  @ApiProperty({ description: 'Text-to-speech across all three areas' })
  tts!: number;
}

/**
 * One bucket of the unit-cost trend.
 *
 * `costPer10MinUsd` is the headline: learner-attributable AI spend divided by
 * practice minutes, scaled to ten minutes. It is null in a bucket with no practice
 * — dividing by zero minutes is not a cost of zero, it is not a cost at all.
 *
 * `excludedCostUsd` is the platform's other AI spend in the same bucket (judges,
 * studio authoring, copilot, translation, internal tooling). It is reported rather
 * than hidden so nobody reads the unit cost as the whole AI bill; it is excluded
 * from the ratio rather than shared out, because it is not caused by a learner
 * practising and would make the unit cost spike in a week when nobody practised
 * but somebody authored ten scenarios.
 */
export class RoleplayCostPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;

  @ApiProperty({ description: 'Practice minutes in the bucket' })
  practiceMinutes!: number;

  @ApiProperty({
    description: 'Learner-attributable AI spend in the bucket, USD',
  })
  attributableCostUsd!: number;

  @ApiProperty({
    description:
      'Estimated USD per 10 minutes of practice; null with no practice',
    nullable: true,
    type: Number,
  })
  costPer10MinUsd!: number | null;

  @ApiProperty({
    type: CostBreakdownDto,
    description: 'The same `attributableCostUsd`, split by area and by service',
  })
  breakdown!: CostBreakdownDto;

  @ApiProperty({
    description:
      'Platform AI spend in the bucket NOT caused by a learner practising, USD',
  })
  excludedCostUsd!: number;

  @ApiProperty({
    description:
      'Attributable calls whose model/provider has no pricing entry. They ' +
      'contribute $0, so this bucket UNDERSTATES real spend by an unknown ' +
      'amount whenever this is non-zero — surfaces must say so rather than ' +
      'presenting the figure as complete.',
  })
  unpricedCalls!: number;
}

export class RoleplayCostResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;

  @ApiProperty({ enum: ANALYTICS_BUCKETS }) bucket!: AnalyticsBucketParam;

  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'Minutes the unit cost is quoted per (10)',
  })
  perMinutes!: number;

  @ApiProperty({
    description: 'Area keys, in display order',
    enum: COST_AREAS,
    isArray: true,
  })
  areas!: string[];

  @ApiProperty({
    description: 'Area key -> admin-facing label',
    type: Object,
  })
  areaLabels!: Record<string, string>;

  @ApiProperty({
    type: [RoleplayCostPointDto],
    description:
      'Gap-filled to a contiguous bucket axis. Costs are real zeros in a quiet ' +
      'bucket (no calls means no spend), but `costPer10MinUsd` is NULL there — ' +
      'a ratio with no denominator is not zero.',
  })
  points!: RoleplayCostPointDto[];

  @ApiProperty({
    description: 'Whole-window USD per 10 minutes; null with no practice',
    nullable: true,
    type: Number,
  })
  overallCostPer10MinUsd!: number | null;

  @ApiProperty({ description: 'Whole-window attributable spend, USD' })
  totalAttributableCostUsd!: number;

  @ApiProperty({ description: 'Whole-window non-learner spend, USD' })
  totalExcludedCostUsd!: number;

  @ApiProperty({ description: 'Whole-window practice minutes' })
  totalPracticeMinutes!: number;

  @ApiProperty({
    description: 'Whole-window attributable calls with no pricing entry',
  })
  totalUnpricedCalls!: number;

  @ApiProperty({
    description:
      'Every figure here is an ESTIMATE: cost is derived at read time from a ' +
      'hand-maintained pricing table, ignores prompt-cache discounts and ' +
      'negotiated rates, and is not a billed amount.',
  })
  estimateNote!: string;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
