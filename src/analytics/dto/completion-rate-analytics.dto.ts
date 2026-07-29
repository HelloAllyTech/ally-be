import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Standard window params. Defaults to `range=all` with monthly buckets: a
 * completion RATE needs a decent denominator per point, and a daily rate over a
 * handful of launches is mostly sampling noise drawn as a trend. Ask for a finer
 * `bucket` explicitly when the volume supports it.
 *
 * `compare` is inherited and ignored — this surface returns no deltas.
 */
export class CompletionRateQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the completion-rate series. */
export class CompletionRatePointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Countable simulations LAUNCHED in this bucket — the denominator. Preview ' +
      'and seed rooms are excluded: a rehearsal a trainer closed on purpose is ' +
      'not a learner giving up.',
  })
  started!: number;

  @ApiProperty({
    description:
      'Of those launches, the ones that reached COMPLETED — whenever they ' +
      'finished. Both figures are attributed to the LAUNCH bucket, so this is a ' +
      'cohort measure: a session begun in January and finished in February counts ' +
      'in January. Splitting the attribution would mix two populations and let a ' +
      'bucket exceed 100% whenever a backlog cleared.',
  })
  completed!: number;

  @ApiProperty({
    description:
      '`started - completed`, clamped at zero — launches with no completion. In ' +
      'the in-progress bucket this includes sessions that are simply still ' +
      'running, so the newest point understates completion; see ' +
      '`window.inProgressBucket`.',
  })
  abandoned!: number;

  @ApiProperty({
    description:
      '`completed / started` as a percentage, or NULL when nothing was launched. ' +
      'A rate over a zero denominator is undefined, not 0% — a fabricated zero ' +
      'draws a crash in completion where there was simply no activity. Emit a gap.',
    nullable: true,
    type: Number,
  })
  completionRatePct!: number | null;
}

/** Whole-window totals. */
export class CompletionRateSummaryDto {
  @ApiProperty({ description: 'Countable simulations launched in the window' })
  started!: number;

  @ApiProperty({ description: 'Of those, the ones that completed' })
  completed!: number;

  @ApiProperty({ description: '`started - completed`, clamped at zero' })
  abandoned!: number;

  @ApiProperty({
    description:
      'Window rate, computed from the summed counts rather than by averaging ' +
      'the per-bucket rates: a mean of rates weights a quiet week the same as a ' +
      'busy one. Null when nothing was launched in the window.',
    nullable: true,
    type: Number,
  })
  completionRatePct!: number | null;
}

/**
 * Do the simulations learners start actually finish?
 *
 * Completion counts alone cannot separate "fewer people practised" from "the same
 * people kept dropping out half way". This endpoint keeps the denominator so the
 * two are distinguishable.
 */
export class CompletionRateResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Oldest first, on a gap-free axis so the x-axis is a real calendar: a ' +
      'bucket with no launches is present with zero counts and a NULL rate. The ' +
      'counts are facts about that period; the rate is undefined, and a chart ' +
      'that plots it as 0% shows a collapse that did not happen.',
    type: [CompletionRatePointDto],
  })
  points!: CompletionRatePointDto[];

  @ApiProperty({ type: CompletionRateSummaryDto })
  summary!: CompletionRateSummaryDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'sessions carry a tenant, so the whole chart honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
