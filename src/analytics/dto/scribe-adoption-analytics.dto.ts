import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Scribe adoption is a windowed trend, so it takes the shared window params. It
 * defaults to `range=all` with monthly buckets: the question is whether the second
 * value stream is spreading beyond its pilots, and spread is measured in quarters.
 * A 30-day default would show one point of a growth curve and answer nothing.
 */
export class ScribeAdoptionQueryDto extends AnalyticsWindowQueryDto {}

/** One bucket of Scribe's reach. */
export class ScribeAdoptionPointDto {
  @ApiProperty({ description: 'Bucket start (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      'Distinct orgs with at least one Scribe session in this bucket. The ' +
      'headline: adoption is a count of customers, not of sessions.',
  })
  orgs!: number;

  @ApiProperty({
    description:
      'Distinct counsellors who ran at least one session in this bucket. Sessions ' +
      'with no counsellor attributed are counted in `sessions` but cannot be ' +
      'counted here.',
  })
  counsellors!: number;

  @ApiProperty({
    description:
      'Scribe sessions in this bucket. Present as the depth behind the breadth ' +
      '— two orgs running a hundred sessions each and twenty running five are ' +
      'the same total and completely different businesses.',
  })
  sessions!: number;
}

/**
 * Whole-window reach.
 *
 * Note that these are NOT the sums of the points: an org that used Scribe in
 * March and again in June is one org over the window and two org-months on the
 * chart. Distinct counts do not add up across buckets, so they are measured over
 * the window in their own pass.
 */
export class ScribeAdoptionSummaryDto {
  @ApiProperty({
    description:
      'Distinct orgs with >= 1 session anywhere in the window — measured over ' +
      'the window, not summed from the buckets.',
  })
  orgs!: number;

  @ApiProperty({ description: 'Distinct counsellors across the window' })
  counsellors!: number;

  @ApiProperty({
    description: 'Scribe sessions in the window (this one does sum)',
  })
  sessions!: number;

  @ApiProperty({
    description:
      'The latest bucket whose period has FINISHED, or null when the window ' +
      'contains none. The current bucket is still accruing, so quoting it as ' +
      '"orgs using Scribe now" reports how far into the month we are.',
    nullable: true,
    type: String,
  })
  latestCompleteBucket!: string | null;

  @ApiProperty({
    description:
      '`orgs` for `latestCompleteBucket` — the honest "currently live" figure. ' +
      'Null when there is no complete bucket to quote.',
    nullable: true,
    type: Number,
  })
  latestOrgs!: number | null;
}

/**
 * "Is the second value stream growing beyond pilots?" — Scribe reach over time, in
 * orgs and counsellors.
 *
 * Deliberately BREADTH and not operations. Summary-failure funnels, provider
 * reliability and processing outcomes already live on the Scribe tab and are not
 * repeated here: this surface answers "how many customers actually use it", and a
 * failure rate beside that number invites the reader to explain the adoption curve
 * with the reliability curve, which is a causal claim neither chart supports.
 */
export class ScribeAdoptionResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'One point per bucket across a contiguous axis, gap-filled with zeros. ' +
      'All three series are counts, so a zero is a real measurement — "no org ' +
      'used Scribe that month" is exactly the fact an adoption chart needs to be ' +
      'able to show.',
    type: [ScribeAdoptionPointDto],
  })
  points!: ScribeAdoptionPointDto[];

  @ApiProperty({ type: ScribeAdoptionSummaryDto })
  summary!: ScribeAdoptionSummaryDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty — ' +
      'though note that with a tenant filter applied `orgs` can only be 0 or 1, ' +
      'so the series worth reading are `counsellors` and `sessions`.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
