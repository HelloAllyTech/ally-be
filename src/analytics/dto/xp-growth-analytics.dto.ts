import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Standard window params. Defaults to `range=all` with monthly buckets — a
 * cumulative curve is a history, and its shape is the only interesting thing
 * about it. `compare` is inherited and ignored: this surface returns no deltas.
 */
export class XpGrowthQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the XP series. */
export class XpGrowthPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'XP awarded in this bucket, summed from the ledger. The CHANGE — the ' +
      'only part of a cumulative chart that can go down, and the reason it is ' +
      'returned alongside the running total.',
  })
  xpEarned!: number;

  @ApiProperty({
    description:
      'Lifetime XP across the whole platform as at the end of this bucket: ' +
      '`summary.baselineXp` plus every bucket up to and including this one. ' +
      'Monotonic by construction, and a true lifetime figure even when the ' +
      'window starts after the platform did — the baseline is what stops a ' +
      'narrowed window from restarting the curve at zero.',
  })
  cumulativeXp!: number;

  @ApiProperty({
    description:
      'Distinct learners who earned any XP in this bucket. Carried so a rising ' +
      'curve can be read: slope from more learners is a different fact about ' +
      'the product than slope from the same learners earning more.',
  })
  earners!: number;
}

/** Whole-window totals. */
export class XpGrowthSummaryDto {
  @ApiProperty({
    description:
      'XP awarded strictly BEFORE the window — the opening value of the ' +
      'cumulative curve. Measured for every window including all-time, rather ' +
      'than assumed to be zero there: an all-time window starts at the ' +
      'platform data floor (first user or session), and an award dated before ' +
      'the earliest surviving row of either would otherwise be dropped from ' +
      'the chart AND left out of the total.',
  })
  baselineXp!: number;

  @ApiProperty({ description: 'XP awarded within the window' })
  xpEarnedInWindow!: number;

  @ApiProperty({
    description:
      'Lifetime platform XP at the end of the window (`baselineXp + ' +
      'xpEarnedInWindow`). Includes the still-accruing bucket, so it is an ' +
      'as-of-now total rather than the last point plotted.',
  })
  cumulativeXp!: number;

  @ApiProperty({
    description:
      'Distinct learners who earned any XP in the window. Counted over the ' +
      'whole window rather than summed from the buckets — a learner active in ' +
      'three months is one learner, and adding the per-bucket counts would ' +
      'triple them.',
  })
  earners!: number;
}

/**
 * How much XP the platform has awarded, and how that total has grown.
 *
 * Read from `xp_events`, the append-only ledger, which is the record: a
 * session's XP contribution cannot be rebuilt from detection rows after the
 * fact, so the totals here are never re-derived from source data.
 *
 * Two things about the history this cannot fix, and states rather than hides:
 * XP was seeded from historical activity when the Progress dashboard launched,
 * and that backfill deliberately awarded neither the streak multiplier (the
 * live streak on each past day is not reconstructable) nor skill personal bests
 * (they need per-session ordering of scores that were re-derived since). So
 * pre-launch XP is a floor: the same activity today earns somewhat more. The
 * curve's LEVEL is therefore not comparable across the launch boundary; its
 * shape is.
 */
export class XpGrowthResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis: a bucket in which nobody earned ' +
      'anything is present with `xpEarned: 0` and carries the running total ' +
      'forward unchanged. Both are facts about that period, so neither is ' +
      'null — this series has no ratio to leave undefined.',
    type: [XpGrowthPointDto],
  })
  points!: XpGrowthPointDto[];

  @ApiProperty({ type: XpGrowthSummaryDto })
  summary!: XpGrowthSummaryDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'every XP event carries a tenant, so the whole chart honours the filter. ' +
      'Test organisations are excluded from every figure regardless.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
