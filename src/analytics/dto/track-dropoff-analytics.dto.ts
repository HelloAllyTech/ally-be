import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Track drop-off takes NO window params, for the same reason roleplay volume and
 * cohort retention do not: the quantity being measured is a LIFETIME property of
 * a learner's path through a track. A learner enrolled in March may reach a
 * video in April and never open the quiz behind it; a 30-day window would count
 * the reach and miss the drop-off, and the chart would report the length of the
 * window rather than where momentum dies.
 *
 * Offering `range` and silently ignoring it would be worse than not offering it,
 * so the only filter is the org narrowing — and the card states "all time" on its
 * face.
 */
export class TrackDropoffQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Progress rows carry no tenant ' +
      'of their own, so the filter is applied through the learner who owns them ' +
      '— the same route the test-org exclusion takes, so the numerator and the ' +
      'denominator can never be scoped differently.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/**
 * One item FORMAT — the question the chart exists to answer: which kind of
 * content do learners stop at?
 */
export class TrackDropoffItemTypeDto {
  @ApiProperty({
    description:
      'TrackItemType value (ROLEPLAY / CASE / QUIZ / ARTICLE / VIDEO / ' +
      'JOURNAL). Always all six, in enum declaration order, whether or not a ' +
      'format has any progress yet — an ordered category list keeps its order ' +
      'and its members everywhere, including the legend.',
    example: 'QUIZ',
  })
  type!: string;

  @ApiProperty({
    description:
      'Progress rows the learner could actually get to — status is anything ' +
      'other than LOCKED. Progress rows are created for the whole track at ' +
      'enrollment time, so the raw row count would say how long the track is, ' +
      'not how far anyone got.',
  })
  reached!: number;

  @ApiProperty({ description: 'Of those, rows at status COMPLETED' })
  completed!: number;

  @ApiProperty({
    description:
      'completed / reached as a percentage. NULL when `reached` is 0 (a rate ' +
      'over a zero denominator is undefined, not 0%) and NULL when the row is ' +
      'below the group-size floor.',
    nullable: true,
    type: Number,
  })
  completionRatePct!: number | null;

  @ApiProperty({
    description:
      'Distinct learners who reached at least one item of this format',
  })
  learners!: number;

  @ApiProperty({
    description:
      'True when `learners` is under `minGroupSize`. The row still travels with ' +
      'its counts — dropping it would understate the total and hide exactly the ' +
      'tail a drop-off chart exists to show — but the RATE is suppressed: "0% ' +
      'of journals completed" over two learners names them.',
  })
  belowFloor!: boolean;
}

/**
 * One SECTION of one track. The format breakdown says which kind of content
 * stalls learners; this says where in a specific curriculum it happens, which is
 * the row an author can act on.
 */
export class TrackDropoffSectionDto {
  @ApiProperty({ description: 'Track id (uuid)' })
  trackId!: string;

  @ApiProperty({ description: 'Track title, as authored' })
  trackTitle!: string;

  @ApiProperty({ description: 'Section id (uuid)' })
  sectionId!: string;

  @ApiProperty({ description: 'Section title, as authored' })
  sectionTitle!: string;

  @ApiProperty({
    description:
      "The section's position in its track. Sections are returned in track " +
      'then `order` sequence: a curriculum is a sequence, and re-sorting it by ' +
      'completion rate would destroy the only axis a drop-off is visible along.',
  })
  order!: number;

  @ApiProperty({
    description: 'Progress rows in this section that are not LOCKED',
  })
  reached!: number;

  @ApiProperty({ description: 'Of those, rows at status COMPLETED' })
  completed!: number;

  @ApiProperty({
    description:
      'completed / reached as a percentage; NULL over a zero denominator and ' +
      'NULL below the group-size floor.',
    nullable: true,
    type: Number,
  })
  completionRatePct!: number | null;

  @ApiProperty({
    description:
      'True when fewer than `minGroupSize` distinct learners reached this ' +
      'section. The counts still travel; the rate is suppressed. The learner ' +
      'count itself is NOT returned per section — a headcount beside a named ' +
      'section of a named track in a single-org view is close enough to naming ' +
      'the people in it.',
  })
  belowFloor!: boolean;
}

/** What the two breakdowns above are breakdowns OF. */
export class TrackDropoffSummaryDto {
  @ApiProperty({ description: 'Non-deleted track enrollments in scope' })
  enrollments!: number;

  @ApiProperty({ description: 'Distinct learners holding those enrollments' })
  learners!: number;

  @ApiProperty({
    description:
      'Distinct track items that at least one learner reached — the items this ' +
      'analysis can say anything about. Items nobody has unlocked yet are not ' +
      'evidence of a drop-off.',
  })
  itemsTracked!: number;

  @ApiProperty({
    description:
      'Enrollments with a `completedAt`. Stated beside the per-format rates so ' +
      'a reader can see whether the drop-offs below add up to a track anyone ' +
      'finishes.',
  })
  completedEnrollments!: number;
}

/**
 * "Which item format kills momentum?" — all-time completion of track items, by
 * format and by section, for the leadership Highlights tab.
 */
export class TrackDropoffResponseDto {
  @ApiProperty({
    description:
      'One row per item format, in TrackItemType declaration order (not by ' +
      'count): the order is part of the category list, so the legend, the axis ' +
      'and the table all read the same way from one request to the next.',
    type: [TrackDropoffItemTypeDto],
  })
  itemTypes!: TrackDropoffItemTypeDto[];

  @ApiProperty({
    description:
      'One row per track section that has any progress, ordered by track title ' +
      'then section `order` — the sequence a learner walks.',
    type: [TrackDropoffSectionDto],
  })
  sections!: TrackDropoffSectionDto[];

  @ApiProperty({ type: TrackDropoffSummaryDto })
  summary!: TrackDropoffSummaryDto;

  @ApiProperty({
    description:
      'Smallest learner group a RATE may be stated for. Echoed rather than left ' +
      'to the client to hard-code a second copy of. Deliberately the same ' +
      'number as every other floor on this surface.',
  })
  minGroupSize!: number;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'every figure here resolves to a tenant through the learner who owns the ' +
      'progress row, so the whole response honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
