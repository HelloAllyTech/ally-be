import { ApiProperty } from '@nestjs/swagger';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Same window params as every other trend endpoint, with two different defaults:
 * `range=all` and `bucket=month`.
 *
 * All-time by default because both series need a sample to say anything — a
 * percentile wants ~20 evaluated sessions per bucket and a top-2-box share wants
 * enough responses that one grumpy learner does not move it — and a 30-day
 * default would open the card on a run of suppressed cells and read as "no
 * data". Monthly by default for the same reason: it is the grain at which most
 * buckets clear the floor. Both remain the reader's choice.
 */
export class QualityDistributionQueryDto extends AnalyticsWindowQueryDto {}

/**
 * One bucket of the quality distribution.
 *
 * Median + p25/p75 rather than a mean: a mean composite score of 68 is the same
 * number whether everyone scored 68 or half the platform scored 40 and half 95,
 * and only the second is a training problem with somewhere to aim. The median
 * says where the typical session sits; the band says how much of a claim that is.
 */
export class QualityBucketPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Median composite score (0-100). Null when `evaluatedSessions` is below ' +
      '`minSampleSize` — the count still travels so the surface can say ' +
      '"n = 4 · need 20" rather than showing a blank cell with no reason.',
    nullable: true,
    type: Number,
  })
  median!: number | null;

  @ApiProperty({
    description: '25th percentile composite score; null below the floor',
    nullable: true,
    type: Number,
  })
  p25!: number | null;

  @ApiProperty({
    description: '75th percentile composite score; null below the floor',
    nullable: true,
    type: Number,
  })
  p75!: number | null;

  @ApiProperty({
    description:
      'Evaluated sessions behind this bucket. Always present, whatever the ' +
      'percentiles do.',
  })
  evaluatedSessions!: number;
}

/**
 * One bucket of the satisfaction stack: three counts of people, plus the two
 * shares those counts support.
 *
 * Counts rather than a mean rating, because a 1-5 rating is ordinal: its
 * arithmetic mean is a number with no unit, and "4.1" is the same figure for a
 * contented population and for a bimodal split of delight and disgust. The
 * response rate travels alongside because a rise in the "high" share that is
 * really a collapse in responses is otherwise indistinguishable from good news.
 */
export class SatisfactionBucketPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({ description: 'Responses rating the session 1 or 2' })
  low!: number;

  @ApiProperty({
    description:
      'Responses rating the session 3. Kept as its own band rather than folded ' +
      'into either side — a neutral rating is not a complaint, and counting it ' +
      'as one inflates the problem while counting it as a success hides one.',
  })
  mid!: number;

  @ApiProperty({ description: 'Responses rating the session 4 or 5' })
  high!: number;

  @ApiProperty({ description: 'Responses in this bucket (low + mid + high)' })
  responses!: number;

  @ApiProperty({
    description:
      'Mean of the raw 1-5 ratings in this bucket, to 2 dp; `responses` is the ' +
      'count it is based on. Null when there were no responses. Read it beside ' +
      'the bands, not instead of them: a mean hides whether a 3.8 is all-4s or ' +
      'a split of delight and disgust.',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;

  @ApiProperty({
    description:
      'Top-2-box share: `high / responses` as a percentage. Null when there ' +
      'were no responses — a share of nothing is not zero percent.',
    nullable: true,
    type: Number,
  })
  top2BoxPct!: number | null;

  @ApiProperty({
    description:
      'Completed sessions in this bucket — the response-rate denominator. ' +
      'Preview and seed rooms are excluded (they can never produce a rating, so ' +
      'counting them would report a falling response rate whenever somebody ' +
      'tested a scenario). Sessions are timestamped by end time and ratings by ' +
      'answer time, so at DAY grain a session rated just after midnight lands ' +
      'in the next bucket and the rate can exceed 100%; it is not clamped, ' +
      'because clamping hides a boundary effect behind a number that looks exact.',
  })
  completedSessions!: number;

  @ApiProperty({
    description:
      '`responses / completedSessions` as a percentage; null when no sessions ' +
      'completed in the bucket.',
    nullable: true,
    type: Number,
  })
  responseRatePct!: number | null;
}

/** One tag on a low or neutral rating — a row of the complaint pareto. */
export class LowRatingTagDto {
  @ApiProperty({
    description:
      'Tag as the learner picked it, or "Other" for the pooled tail beyond the ' +
      'top rows.',
  })
  tag!: string;

  @ApiProperty({ description: 'Low/neutral-rated responses carrying this tag' })
  count!: number;
}

/** Whole-window figures — the KPI strip above the two charts. */
export class QualityDistributionSummaryDto {
  @ApiProperty({ description: 'Evaluated sessions in the window' })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Median composite score across the window, computed over the raw ' +
      'sessions (a median of per-bucket medians is not a median of anything). ' +
      'Null below `minSampleSize`.',
    nullable: true,
    type: Number,
  })
  medianScore!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  p25!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  p75!: number | null;

  @ApiProperty({ description: 'Rating responses in the window' })
  responses!: number;

  @ApiProperty({
    description:
      'Mean of every raw 1-5 rating in the window, to 2 dp, computed over the ' +
      'ratings themselves rather than averaged from the buckets. Null with no ' +
      'responses.',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;

  @ApiProperty({ description: 'Responses rating 1-2' })
  low!: number;

  @ApiProperty({ description: 'Responses rating 3' })
  mid!: number;

  @ApiProperty({ description: 'Responses rating 4-5' })
  high!: number;

  @ApiProperty({
    description: '`high / responses` as a percentage; null with no responses',
    nullable: true,
    type: Number,
  })
  top2BoxPct!: number | null;

  @ApiProperty({
    description: 'Completed sessions in the window (preview/seed excluded)',
  })
  completedSessions!: number;

  @ApiProperty({
    description:
      '`responses / completedSessions` as a percentage; null when no sessions ' +
      'completed. This is the number that says how much the satisfaction ' +
      'reading is worth — a 90% top-2-box on a 4% response rate is a statement ' +
      'about who answers surveys.',
    nullable: true,
    type: Number,
  })
  responseRatePct!: number | null;

  @ApiProperty({
    description:
      'Low/neutral-rated responses that carried at least one tag — the tag ' +
      "pareto's OWN denominator. Not all low ratings (most carry no tag) and " +
      'not all responses: without it, "unrealistic persona · 42" could be 42 of ' +
      '50 complaints or 42 of 4,000.',
  })
  taggedLowRatings!: number;
}

// ── Satisfaction by practice ordinal (EFF-70, AAQ-229) ──────────────────────
// Additive block, read by Highlights → Quality & sentiment. ALL-TIME whatever
// `range`/`from`/`to` say: the x-axis is the learner's own Nth rated session.

export class SatisfactionOrdinalProvenanceDto {
  @ApiProperty() derivation!: string;
  @ApiProperty() note!: string;
}

/** Ratings at one ordinal, for one population. */
export class SatisfactionOrdinalCellDto {
  @ApiProperty({
    description:
      'Ratings at this ordinal — one per learner, since each learner has one ' +
      'Nth rated session. Always present.',
  })
  ratings!: number;

  @ApiProperty({
    description: 'Mean 1-5 rating, 2 dp. Null below `minSampleSize` ratings.',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;

  @ApiProperty({
    description:
      'Share of ratings that are 4 or 5 (%), 1 dp — the top-2-box reading the ' +
      'satisfaction bars use. Null below `minSampleSize` ratings.',
    nullable: true,
    type: Number,
  })
  highSharePct!: number | null;
}

export class SatisfactionOrdinalPointDto {
  @ApiProperty({
    description:
      "The learner's Nth RATED session, ordered by session start (1 = the " +
      'first session they rated). Sessions they did not rate are not counted, ' +
      'so ordinal 3 is the third rating, not the third session.',
  })
  ordinal!: number;

  @ApiProperty({
    description: 'Every learner who reached this ordinal',
    type: () => SatisfactionOrdinalCellDto,
  })
  all!: SatisfactionOrdinalCellDto;

  @ApiProperty({
    description:
      'Only learners with at least `experiencedMinRatings` rated sessions in ' +
      'total — a fixed panel through ordinal `experiencedMinRatings`. The ' +
      'survivorship control: learners who keep rating may be the satisfied ' +
      'ones, so if only `all` rises, what moved is who is still answering.',
    type: () => SatisfactionOrdinalCellDto,
  })
  experienced!: SatisfactionOrdinalCellDto;
}

export class SatisfactionByOrdinalDto {
  @ApiProperty({
    description:
      'Always `all`: this block ignores the endpoint window. Say "all time" on ' +
      'the card.',
    enum: ['all'],
  })
  window!: 'all';

  @ApiProperty({ description: 'Last ordinal on the axis', example: 12 })
  maxOrdinal!: number;

  @ApiProperty({
    description:
      'Rated sessions a learner needs to be in the `experienced` panel',
    example: 6,
  })
  experiencedMinRatings!: number;

  @ApiProperty({
    description:
      'Ratings a mean or share is stated from (`MIN_SCORE_SAMPLE_SIZE`).',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'Learners with at least one rated session (ordinal 1’s n)',
  })
  ratedLearners!: number;

  @ApiProperty({
    description: 'Of those, learners in the `experienced` panel',
  })
  experiencedLearners!: number;

  @ApiProperty({
    description:
      'Ordinals 1..maxOrdinal, contiguous: an ordinal nobody reached carries ' +
      'zero counts and null values, never a zero rating.',
    type: [SatisfactionOrdinalPointDto],
  })
  points!: SatisfactionOrdinalPointDto[];

  @ApiProperty({
    description:
      'Ratings at ordinals past `maxOrdinal` — counted so the total reconciles, ' +
      'not plotted.',
  })
  ratingsBeyondLastOrdinal!: number;

  @ApiProperty({
    description:
      'Source line: ruler R6 (post-session rating), how ordinals are counted, ' +
      'and the caveat (self-report, sparse, survivorship).',
    type: () => SatisfactionOrdinalProvenanceDto,
  })
  provenance!: SatisfactionOrdinalProvenanceDto;
}

/**
 * Distribution-aware roleplay quality and learner satisfaction.
 *
 * The successor to the mean-only quality/CSAT lines on the Highlights tab, which
 * stay where they are. Two shapes, each chosen because the decision depends on
 * the spread and not the centre: quality as a median with a p25-p75 band,
 * satisfaction as counts of people in three rating bands carrying their own
 * response rate.
 */
export class QualityDistributionResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Quality per bucket, SPARSE: a bucket with no evaluated sessions is ' +
      'ABSENT rather than zero. A percentile of no observations is not zero, ' +
      'and a zero plotted on a 0-100 score axis reads as a collapse in ' +
      'teaching quality. Unlike `satisfaction`, this series is never gap-filled.',
    type: [QualityBucketPointDto],
  })
  quality!: QualityBucketPointDto[];

  @ApiProperty({
    description:
      'Satisfaction per bucket, GAP-FILLED to a contiguous axis: the counts are ' +
      'counts, and "nobody rated a session that month" is a fact worth a zero ' +
      'bar. Every derived percentage stays null over a zero denominator.',
    type: [SatisfactionBucketPointDto],
  })
  satisfaction!: SatisfactionBucketPointDto[];

  @ApiProperty({
    description:
      'Tags on ratings of 3 or below, across the whole window rather than per ' +
      'bucket (slicing 40 complaints over 12 months leaves every bar too short ' +
      'to rank). Sorted by count, with the tail beyond the top rows pooled into ' +
      'a single "Other" row so the parts still sum to the whole.',
    type: [LowRatingTagDto],
  })
  lowRatingTags!: LowRatingTagDto[];

  @ApiProperty({ type: QualityDistributionSummaryDto })
  summary!: QualityDistributionSummaryDto;

  @ApiProperty({
    description:
      'Satisfaction by the learner’s Nth rated session (AAQ-229): mean rating ' +
      'and share rated 4-5 at ordinals 1..12, all-comers and a fixed ' +
      'experienced panel. ALL-TIME regardless of this endpoint’s window, and ' +
      'scoped by the session’s tenant. Floored at `minSampleSize` ratings.',
    type: () => SatisfactionByOrdinalDto,
  })
  byOrdinal!: SatisfactionByOrdinalDto;

  @ApiProperty({
    description:
      'Observations a percentile is stated from. Below it the score is null and ' +
      'the count still travels. Echoed rather than hard-coded a second time in ' +
      'the client, which is how a server that suppresses at 20 and a client that ' +
      'badges at 30 end up drawing cells that are blank for no stated reason.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Fixed [min, max] for the score axis. Sent so the axis cannot ' +
      'auto-scale to the data: a 62-71 axis makes a nine-point wobble look like ' +
      'a crisis.',
    type: [Number],
    example: [0, 100],
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description: 'Fixed [min, max] of the 1-5 rating scale the bands split up',
    type: [Number],
    example: [1, 5],
  })
  ratingDomain!: [number, number];

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'evaluations, feedback and sessions all carry a tenant, so the whole ' +
      'response honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
