import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

import {
  ANALYTICS_RANGES,
  AnalyticsRange,
  AnalyticsScopingDto,
  AnalyticsWindowDto,
} from './platform-analytics.dto';
import { MAX_LEVEL } from 'src/progress/progress.constants';

/**
 * Grains this chart accepts — the shared `ANALYTICS_BUCKETS` plus `quarter`.
 * The level ladder is sparse at the top (see `LEVEL_THRESHOLDS`'s doc comment:
 * most of the platform sits at L1-L2 today), so a coarser read is often the
 * only one with anything to show past the first couple of levels. Declared
 * locally rather than added to the shared `ANALYTICS_BUCKETS` list, which
 * several other charts rely on staying at its current four values.
 */
export const XP_LEVEL_REACHED_BUCKETS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type XpLevelReachedBucketParam =
  (typeof XP_LEVEL_REACHED_BUCKETS)[number];

/**
 * Standard window query params, duplicated from `AnalyticsWindowQueryDto`
 * rather than extended from it: this endpoint's `bucket` accepts `quarter`,
 * which the shared DTO's `bucket` field does not, so the two types are not
 * compatible as a subclass override. `tenantId`/`compare` are dropped — this
 * chart is platform-wide only, see {@link XpLevelReachedResponseDto.scoping}.
 */
export class XpLevelReachedQueryDto {
  @ApiProperty({
    description: 'Rolling time window. Ignored when `from`/`to` are supplied.',
    enum: ANALYTICS_RANGES,
    default: '90d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Bucket granularity; defaults to the endpoint default for the range.',
    enum: XP_LEVEL_REACHED_BUCKETS,
    required: false,
  })
  @IsOptional()
  @IsIn(XP_LEVEL_REACHED_BUCKETS)
  bucket?: XpLevelReachedBucketParam;

  @ApiProperty({
    description:
      'Custom window start (yyyy-mm-dd, inclusive). Must be sent with `to`.',
    required: false,
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'from must be an ISO date (yyyy-mm-dd)' },
  )
  from?: string;

  @ApiProperty({
    description:
      'Custom window end (yyyy-mm-dd, INCLUSIVE). Must be sent with `from`.',
    required: false,
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'to must be an ISO date (yyyy-mm-dd)' },
  )
  to?: string;
}

/** One level's crossing count within one bucket. */
export class XpLevelReachedLevelCountDto {
  @ApiProperty({
    description:
      '1-indexed level number (1 = LEVEL_THRESHOLDS[0], the account default).',
  })
  level!: number;

  @ApiProperty({
    description:
      'Learners who FIRST reached this level during this bucket. For level 1 ' +
      '(threshold 0 XP) this is, in practice, learners earning their first-ever ' +
      'XP award in the bucket — every account already starts at level 1, so ' +
      'there is no later "crossing" into it from a ledger read; see the ' +
      'repository doc comment. Never fabricated as zero for the high levels: ' +
      "the platform's level curve is known to be mis-scaled today (most " +
      'learners sit at L1-L2), so an empty L8-L10 series is a fact about the ' +
      'population, not a bug.',
  })
  users!: number;
}

/** One bucket of the level-attainment series. */
export class XpLevelReachedPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      `Every level from 1 through ${MAX_LEVEL} (LEVEL_THRESHOLDS.length), in ` +
      'ascending order, whether or not any learner crossed it in this bucket — ' +
      'a chart control can always draw all series without checking which ones ' +
      'happen to have data this window.',
    type: [XpLevelReachedLevelCountDto],
  })
  levelCounts!: XpLevelReachedLevelCountDto[];
}

/**
 * Unique learners reaching each XP level for the first time, per bucket — the
 * flow behind the level ladder ("how many L3s did we produce this month"), as
 * distinct from a stock reading ("how many learners are at or past L3 right
 * now"), which this endpoint does not attempt.
 *
 * A learner who crosses several levels within one bucket is counted once in
 * EACH level's series — the series are nested, never stacked, matching
 * `UsageLadderAnalyticsRepository`'s funnel semantics for the same reason.
 */
export class XpLevelReachedResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis: a bucket with no crossings at any ' +
      'level is present with every `users` at 0, not omitted.',
    type: [XpLevelReachedPointDto],
  })
  points!: XpLevelReachedPointDto[];

  @ApiProperty({
    description:
      'Always platform-wide (tenantId null) — this chart has no tenant filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
