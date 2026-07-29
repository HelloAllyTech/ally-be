import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Activation accepts the standard window params, but only ONE of the three shapes
 * it returns is windowed — `practisingLearners`. The funnel and the
 * time-to-first-practice distribution are lifetime properties of a person ("days
 * from signup to first practice" does not change because the date picker moved),
 * so they are all-time by construction and the response says so on each field.
 *
 * `compare` is inherited from {@link AnalyticsWindowQueryDto} and deliberately
 * IGNORED: a delta needs one comparable number per window, and the two headline
 * shapes here have no per-window value to compare. The surface states the period
 * rather than showing a change against a basis it does not have.
 *
 * Defaults to `range=all` with weekly buckets: activation is a slow quantity, and
 * a 30-day view of it is mostly the shape of the last month's hiring.
 */
export class ActivationQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the "people practising" series. */
export class PractisingLearnersPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Distinct people with at least one completed simulation in this bucket. ' +
      'Counted by who played the session, with no role filter — this is a count ' +
      'of people practising, not a share of the learner population, so a trainer ' +
      'rehearsing is somebody practising.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Completed simulations behind that headcount. The pair is the point: a ' +
      'bucket where sessions rose and learners did not is the same few people ' +
      'practising harder, which is a different result from reaching more people.',
  })
  sessions!: number;
}

/** Headline scalars for the activation panel. */
export class ActivationSummaryDto {
  @ApiProperty({
    description:
      'The most recent bucket that is NOT `window.inProgressBucket` — the ' +
      'latest period whose figure is final. Null when the window contains no ' +
      'complete bucket. The in-progress bucket is excluded deliberately: it can ' +
      'only rise, so quoting it as the latest value reads as a collapse.',
    nullable: true,
    type: String,
  })
  latestCompleteBucket!: string | null;

  @ApiProperty({
    description:
      'People practising in `latestCompleteBucket`; null when there is no ' +
      'complete bucket. Zero is a real measurement and is reported as zero.',
    nullable: true,
    type: Number,
  })
  latestPractisingLearners!: number | null;

  @ApiProperty({
    description:
      'ALL-TIME learner-role accounts in scope — the activation denominator, not ' +
      'a windowed figure. Windowing it would drop everyone who signed up before ' +
      'the window, which is most of the population, and inflate every rate below.',
  })
  registeredLearners!: number;

  @ApiProperty({
    description:
      'ALL-TIME learners with at least one completed simulation. The bands in ' +
      '`timeToFirstPractice` sum to this.',
  })
  activatedLearners!: number;

  @ApiProperty({
    description:
      '`activatedLearners / registeredLearners` as a percentage. Null when the ' +
      'population is below `minPopulationSize` — a rate over a handful of people ' +
      'names them, and it is not an estimate of anything either.',
    nullable: true,
    type: Number,
  })
  activationRatePct!: number | null;

  @ApiProperty({
    description:
      'Smallest population a RATE may be stated for. Below it the counts still ' +
      'stand and the percentages are suppressed. Echoed rather than left to the ' +
      'client to invent a second copy of.',
  })
  minPopulationSize!: number;
}

/** One stage of the activation funnel. */
export class ActivationFunnelStageDto {
  @ApiProperty({
    description:
      'Stable machine key — key colours and copy off this, never off `label`.',
    example: 'completedASim',
  })
  key!: string;

  @ApiProperty({ description: 'Admin-facing label', example: 'Completed one' })
  label!: string;

  @ApiProperty({
    description:
      'People who reached this stage, ALL TIME. Each stage is a subset of the ' +
      'one before it, so the series is non-increasing by construction.',
  })
  reached!: number;
}

/** The all-time activation funnel: accounts -> starts -> completions -> habit. */
export class ActivationFunnelDto {
  @ApiProperty({
    description:
      'What the first bar counts. A funnel with an unstated denominator is the ' +
      'quietest way to mislead: every percentage below it inherits the ' +
      'ambiguity, so the population is named on the panel.',
    example: 'learner-role accounts, test organisations excluded',
  })
  denominatorLabel!: string;

  @ApiProperty({
    description:
      'Stages in order, widest first. Order and labels come from the server so ' +
      'the client cannot re-order or re-word the definition of "activated".',
    type: [ActivationFunnelStageDto],
  })
  stages!: ActivationFunnelStageDto[];
}

/** One band of the time-to-first-practice distribution. */
export class TimeToFirstPracticeBandDto {
  @ApiProperty({ description: 'Admin-facing label', example: '4–7' })
  label!: string;

  @ApiProperty({
    description: 'Inclusive lower bound, whole days after signup',
  })
  minDays!: number;

  @ApiProperty({
    description:
      'INCLUSIVE upper bound; null for the open-ended top band. Inclusive on ' +
      'both ends because the quantity is a count of calendar days, so "4–7" ' +
      'means 4, 5, 6 or 7 — see `boundsNote`.',
    nullable: true,
    type: Number,
  })
  maxDays!: number | null;
}

/** One point of the cumulative activation curve. */
export class TimeToFirstPracticeCumulativePointDto {
  @ApiProperty({ description: 'Days since signup, inclusive threshold' })
  days!: number;

  @ApiProperty({
    description: 'Learners who had completed their first simulation by then',
  })
  activated!: number;

  @ApiProperty({
    description:
      'Share of `registeredLearners`, percent. Null below ' +
      '`summary.minPopulationSize`. The denominator is the WHOLE population, ' +
      'including learners who never practised — a conversion curve over only the ' +
      'converted always reaches 100% and says nothing.',
    nullable: true,
    type: Number,
  })
  activatedPct!: number | null;
}

/** How long learners take to get started, and how many never do. */
export class TimeToFirstPracticeDto {
  @ApiProperty({
    description:
      'Bands, fastest first, inclusive on both bounds. Index-aligned with ' +
      '`learnersByBand`. Excludes the never-practised group — see ' +
      '`neverPractised`.',
    type: [TimeToFirstPracticeBandDto],
  })
  bands!: TimeToFirstPracticeBandDto[];

  @ApiProperty({
    description:
      'Learners in each band, index-aligned with `bands`. Counts, never shares: ' +
      'the client divides by whichever denominator it is showing, so the chart ' +
      'and the table share one set of numerators.',
    type: [Number],
    example: [64, 38, 12, 9, 4],
  })
  learnersByBand!: number[];

  @ApiProperty({
    description:
      'The residual group: learners who have never completed a simulation. A ' +
      'learner with no completed session has no first-practice date, so this ' +
      'group can only be `registeredLearners - activatedLearners` (clamped at ' +
      'zero) rather than something the session table can be asked for. Returned ' +
      'rather than left to the client so the two cannot disagree.',
  })
  neverPractised!: number;

  @ApiProperty({
    description:
      'The bound convention, for display on the panel. An ambiguous banded axis ' +
      'is read wrongly with complete confidence, because nothing on the chart ' +
      'contradicts the convention the reader assumed.',
  })
  boundsNote!: string;

  @ApiProperty({
    description:
      'Cumulative activation curve for the drill-down: what share had practised ' +
      'within N days of signing up. Non-decreasing in `activated`.',
    type: [TimeToFirstPracticeCumulativePointDto],
  })
  cumulative!: TimeToFirstPracticeCumulativePointDto[];
}

/**
 * Learner activation: how much of the population gets started, how long it takes
 * them, and whether the number of people practising is growing.
 *
 * Three shapes, one response, because they are only interpretable together — a
 * funnel with no timing cannot say whether a stage is a loss or a lag, and a
 * timing distribution with no funnel cannot say how many people it describes.
 */
export class ActivationResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description:
      'The resolved window, for on-surface labelling and exports. It applies to ' +
      '`practisingLearners` only; `summary.registeredLearners`, ' +
      '`summary.activatedLearners`, `funnel` and `timeToFirstPractice` are ' +
      'ALL-TIME by construction.',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'People practising per bucket, oldest first, on a gap-free axis: a bucket ' +
      'where nobody practised is present with real zeros, because these are ' +
      'counts and "nobody practised that week" is a fact rather than a missing ' +
      'measurement. Bucketed on when each session STARTED — this series counts ' +
      'people showing up, so a session running past midnight belongs to the day ' +
      'it began.',
    type: [PractisingLearnersPointDto],
  })
  practisingLearners!: PractisingLearnersPointDto[];

  @ApiProperty({ type: ActivationSummaryDto })
  summary!: ActivationSummaryDto;

  @ApiProperty({ type: ActivationFunnelDto })
  funnel!: ActivationFunnelDto;

  @ApiProperty({ type: TimeToFirstPracticeDto })
  timeToFirstPractice!: TimeToFirstPracticeDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'both the learner population and the sessions carry a tenant, so every ' +
      'figure here honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
