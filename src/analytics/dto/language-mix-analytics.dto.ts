import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Standard window params. Defaults to `range=all` with monthly buckets: a mix is a
 * composition, and a composition over a handful of sessions is noise — one learner
 * choosing Tamil moves a daily bar by twenty points. Ask for a finer `bucket`
 * explicitly when the volume supports it.
 *
 * `compare` is inherited and ignored — this surface returns no deltas.
 */
export class LanguageMixQueryDto extends AnalyticsWindowQueryDto {}

/** One (bucket, language) cell of the mix. */
export class LanguageMixPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description: 'Series label — one of the response `labels`',
    example: 'Hindi',
  })
  label!: string;

  @ApiProperty({
    description: 'Completed sessions in this bucket and language',
  })
  sessions!: number;
}

/** The denominator a 100%-stacked chart hides. */
export class LanguageMixBucketTotalDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Completed sessions in the bucket across every label, including Other and ' +
      'Unknown. Zero where nothing was completed — a count, so zero is a fact.',
  })
  sessions!: number;
}

/** Whole-window totals for the mix. */
export class LanguageMixSummaryDto {
  @ApiProperty({
    description: 'Completed sessions in the window, across every language',
  })
  totalSessions!: number;

  @ApiProperty({
    description:
      'Distinct resolvable languages in the window — counted BEFORE the tail is ' +
      'pooled, so "12 languages, 8 series" is visible rather than hidden by the ' +
      'trimming. Excludes Unknown, which is an absence of data, not a language.',
  })
  distinctLanguages!: number;

  @ApiProperty({
    description:
      'Sessions with no resolvable language. Reported as its own figure because ' +
      'it measures the instrumentation, not the learners: a rising Unknown share ' +
      'means the mix itself is becoming less trustworthy.',
  })
  unknownSessions!: number;
}

/**
 * Which languages practice happens in, and how that mix moves over time.
 *
 * Shaped for a 100%-stacked chart, with the two things such a chart cannot say for
 * itself travelling alongside it: the absolute denominator per bucket
 * (`bucketTotals`) and the size of the pooled tail (`labels` + `maxSeries`). A
 * stacked share chart with no denominator will happily show a language "growing"
 * through a month in which practice halved.
 */
export class LanguageMixResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Series labels in stacking/legend order: named languages first, ranked by ' +
      'their total over the whole window (not per bucket — a legend that reorders ' +
      'itself between buckets makes a stacked chart unreadable), then "Other", then ' +
      '"Unknown". Both residual labels come last when present, so the eye reads the ' +
      'real categories first and the tail stays visually where the reader expects ' +
      'the leftovers.',
    type: [String],
    example: ['English', 'Hindi', 'Tamil', 'Other', 'Unknown'],
  })
  labels!: string[];

  @ApiProperty({
    description:
      'Long form, one row per (bucket, label) with at least one session. Rows with ' +
      'no sessions are omitted rather than sent as zeros: this is a composition, and ' +
      'a zero-height band carries no information while multiplying the payload by ' +
      'the number of series. The calendar comes from `bucketTotals`, which is dense.',
    type: [LanguageMixPointDto],
  })
  points!: LanguageMixPointDto[];

  @ApiProperty({
    description:
      'Completed sessions per bucket, oldest first, on a gap-free axis. This is the ' +
      'denominator a 100%-stacked chart hides, and it must travel with the shares: ' +
      'without it a bucket of four sessions and a bucket of four hundred look ' +
      'identical, and every share is read as equally solid.',
    type: [LanguageMixBucketTotalDto],
  })
  bucketTotals!: LanguageMixBucketTotalDto[];

  @ApiProperty({ type: LanguageMixSummaryDto })
  summary!: LanguageMixSummaryDto;

  @ApiProperty({
    description:
      'The categorical-colour ceiling, and the maximum length of `labels`. The tail ' +
      'beyond it is pooled into "Other" SERVER-side so the client cannot invent a ' +
      'ninth colour, and so two clients cannot disagree about where the tail begins.',
    example: 8,
  })
  maxSeries!: number;

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
