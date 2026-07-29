import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * The coaching loop is a windowed trend, so it takes the shared window params.
 * It defaults to `range=all` with monthly buckets: sharing a session for review
 * is a rare event compared with completing one, and a 30-day default would put a
 * handful of reviews on a daily axis where every point sits below the sample
 * floor and the whole chart reads as "no data".
 */
export class CoachingLoopQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of the coaching loop. */
export class CoachingLoopPointDto {
  @ApiProperty({ description: 'Bucket start (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Sessions shared for review in this bucket — one per review row, ' +
      'timestamped by when the review was created.',
  })
  sharedSessions!: number;

  @ApiProperty({
    description:
      'Simulations completed in this bucket — the denominator `sharePct` is ' +
      'over. Note the two are timestamped independently: a review created this ' +
      'month may be of a session completed last month, so the share is a ' +
      'rate-of-sharing indicator rather than a per-session cohort rate.',
  })
  completedSessions!: number;

  @ApiProperty({
    description:
      'sharedSessions / completedSessions as a percentage; NULL when nothing ' +
      'was completed in the bucket. A share over no sessions is undefined, and ' +
      'drawing it as 0% would report a quiet month as a month nobody shared.',
    nullable: true,
    type: Number,
  })
  sharePct!: number | null;

  @ApiProperty({
    description:
      "Of this bucket's reviews, those that received at least one non-deleted " +
      "comment from someone OTHER than the review's creator. A learner " +
      'replying to their own share is not the loop closing.',
  })
  reviewsWithComment!: number;

  @ApiProperty({
    description:
      'Median hours from a review being created to its first comment from ' +
      'someone else. NULL when nothing in the bucket was commented on, and NULL ' +
      'when fewer than `minSampleSize` reviews were — a median turnaround over ' +
      'two reviews is noise that reads as a measurement.',
    nullable: true,
    type: Number,
  })
  medianHoursToFirstComment!: number | null;

  @ApiProperty({
    description:
      'The same measurement at the 90th percentile — the learner who waited ' +
      'longest. Travels with the median because turnaround is skewed: a median ' +
      'of six hours can hide a tail of a fortnight, and the median alone is a ' +
      'half-truth about whether learners hear back.',
    nullable: true,
    type: Number,
  })
  p90HoursToFirstComment!: number | null;

  @ApiProperty({
    description:
      "Comments on this bucket's reviews from someone other than the creator " +
      '(non-deleted). Depth of the conversation, where `reviewsWithComment` is ' +
      'its breadth.',
  })
  comments!: number;
}

/** The same measurements over the whole window. */
export class CoachingLoopSummaryDto {
  @ApiProperty({ description: 'Sessions shared for review in the window' })
  sharedSessions!: number;

  @ApiProperty({ description: 'Simulations completed in the window' })
  completedSessions!: number;

  @ApiProperty({
    description:
      'sharedSessions / completedSessions, percent; NULL when nothing was ' +
      'completed in the window.',
    nullable: true,
    type: Number,
  })
  sharePct!: number | null;

  @ApiProperty({
    description: 'Reviews that received a comment from someone else',
  })
  reviewsWithComment!: number;

  @ApiProperty({
    description:
      'reviewsWithComment / sharedSessions, percent — the share of shares that ' +
      'got an answer. NULL when nothing was shared.',
    nullable: true,
    type: Number,
  })
  respondedPct!: number | null;

  @ApiProperty({
    description:
      'Median hours to first comment across the whole window, computed over the ' +
      'raw reviews rather than averaged from the buckets: a median of per-bucket ' +
      'medians weights a month with two reviews the same as a month with two ' +
      'hundred. NULL below `minSampleSize`.',
    nullable: true,
    type: Number,
  })
  medianHoursToFirstComment!: number | null;

  @ApiProperty({
    description:
      'p90 hours to first comment across the window; NULL below the floor.',
    nullable: true,
    type: Number,
  })
  p90HoursToFirstComment!: number | null;

  @ApiProperty({ description: 'Comments from someone other than the creator' })
  comments!: number;
}

/**
 * "Is the human feedback loop alive, and how fast do learners hear back?" —
 * sessions shared for review, the share of them that got a reply, and how long
 * the reply took.
 *
 * Aggregate only, and deliberately: there is no per-trainer breakdown on this
 * surface and there must not be one. Turnaround per named reviewer would put a
 * league table of individuals on a leadership dashboard, and "who is slow to
 * respond to a distressing session" is a clinical-adjacent judgement this
 * dashboard is not equipped to make. The loop is a property of the programme.
 */
export class CoachingLoopResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'One point per bucket across a contiguous axis. Counts are gap-filled ' +
      'with real zeros (a month where nobody shared is a fact); every derived ' +
      'percentage and percentile stays null over a zero or below-floor ' +
      'denominator rather than being drawn as zero.',
    type: [CoachingLoopPointDto],
  })
  points!: CoachingLoopPointDto[];

  @ApiProperty({ type: CoachingLoopSummaryDto })
  summary!: CoachingLoopSummaryDto;

  @ApiProperty({
    description:
      'Smallest number of commented-on reviews a median or p90 turnaround may ' +
      'be stated for. Echoed so the client can caption the suppression instead ' +
      'of showing an unexplained gap.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'reviews, comments and sessions all carry a tenant, so the whole response ' +
      'honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
