import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Skill growth takes NO window params, for the same reason roleplay volume and
 * cohort retention do not: the x-axis is not a calendar.
 *
 * Each learner's sessions are re-indexed to their OWN first one, so "ordinal 3"
 * means the third simulation that person ever had judged, whenever it happened.
 * Over a 30-day window almost every learner has one or two evaluated sessions
 * inside it, so the later ordinals would be built entirely from whoever binged
 * that month and the chart would report the length of the window. Offering
 * `range` and silently ignoring it would be worse than not offering it; the card
 * states "all time" on its face.
 */
export class SkillGrowthQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Both the learners and their ' +
      'sessions are scoped, so the curve stays internally consistent.',
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
 * One cell of the curve: where the typical session sits and how wide the spread
 * is, plus the sample it came from.
 *
 * `n` is present whatever the percentiles do. That is the point of returning it:
 * a suppressed cell must be able to say "n = 4 · need 20" rather than appearing
 * as an unexplained gap, which reads as a bug rather than as a small sample.
 */
export class SkillGrowthCellDto {
  @ApiProperty({
    description:
      'Median composite score (0-100) at this ordinal, or null when `n` is ' +
      'below `minSampleSize`.',
    nullable: true,
    type: Number,
  })
  median!: number | null;

  @ApiProperty({
    description: '25th percentile; null below the sample floor',
    nullable: true,
    type: Number,
  })
  p25!: number | null;

  @ApiProperty({
    description: '75th percentile; null below the sample floor',
    nullable: true,
    type: Number,
  })
  p75!: number | null;

  @ApiProperty({
    description:
      'Sessions behind this cell. Always returned, even when the percentiles ' +
      'are suppressed.',
  })
  n!: number;
}

/** One ordinal of the curve, with both populations side by side. */
export class SkillGrowthOrdinalDto {
  @ApiProperty({
    description:
      "1 = the learner's FIRST evaluated session. Counts evaluated sessions, " +
      'not sessions: an unevaluated session has no score to place, so counting ' +
      'it would make "3rd session" mean different things for different learners.',
  })
  ordinal!: number;

  @ApiProperty({
    description: 'Every learner who reached this ordinal.',
    type: SkillGrowthCellDto,
  })
  all!: SkillGrowthCellDto;

  @ApiProperty({
    description:
      'The SAME rows, restricted to learners with at least ' +
      '`experiencedMinSessions` evaluated sessions in total — held fixed from ' +
      'their first session onwards. This is the survivorship control: ordinal 1 ' +
      'is everyone who ever practised while ordinal 8 is only those who kept ' +
      'going, and the ones who kept going tend to be the ones doing well. If ' +
      'both lines rise the improvement survives the composition change; if only ' +
      '`all` rises, what is being measured is attrition. Computed in the same ' +
      'pass over the same denominator, never as a second query.',
    type: SkillGrowthCellDto,
  })
  experienced!: SkillGrowthCellDto;
}

/**
 * How the plotted score was produced — on the card, not in a doc somewhere.
 *
 * A learning curve is only a learning curve if the ruler stayed the same length,
 * and this ruler is an LLM judge.
 */
export class SkillGrowthProvenanceDto {
  @ApiProperty({
    description: 'What the number is and how the sessions were ordered',
    example:
      'LLM judge (composite of per-goal rubric scores) over completed ' +
      'sessions, ordered per learner by session start',
  })
  derivation!: string;

  @ApiProperty({
    description:
      'The caveat that has to travel with the curve: scores are comparable only ' +
      'within one judge model + rubric version, and this endpoint does not pin ' +
      'a version yet, so a step in the line may be a change in the ruler.',
  })
  note!: string;
}

/** Whole-population figures behind the curve. */
export class SkillGrowthSummaryDto {
  @ApiProperty({ description: 'Learners with at least one evaluated session' })
  learners!: number;

  @ApiProperty({
    description:
      'Of those, learners at or above `experiencedMinSessions` — the ' +
      'population the `experienced` series is drawn from.',
  })
  experiencedLearners!: number;

  @ApiProperty({
    description:
      'Evaluated sessions across every learner, INCLUDING sessions beyond ' +
      '`maxOrdinal` (which are counted here but not plotted).',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Median at ordinal 1 of the `all` series — the baseline the curve is read ' +
      'against. Null below the sample floor.',
    nullable: true,
    type: Number,
  })
  firstOrdinalMedian!: number | null;

  @ApiProperty({
    description:
      'Highest ordinal whose `all` sample clears `minSampleSize` — where the ' +
      'line stops being worth reading. Null when even ordinal 1 is below the ' +
      'floor.',
    nullable: true,
    type: Number,
  })
  lastComparableOrdinal!: number | null;

  @ApiProperty({
    description:
      'Median at `lastComparableOrdinal`. Paired with `firstOrdinalMedian` this ' +
      'is the headline: the improvement between the first simulation and the ' +
      'last one there is enough data to speak about.',
    nullable: true,
    type: Number,
  })
  lastComparableMedian!: number | null;
}

/**
 * Does a learner's Nth simulation score better than their first?
 *
 * The efficacy chart, and the one question no calendar trend can answer: a
 * quality line over time moves when the MIX of learners changes, so a month of
 * new signups drags it down while every individual improves. All-time by
 * construction — see {@link SkillGrowthQueryDto}.
 */
export class SkillGrowthResponseDto {
  @ApiProperty({
    description:
      'The curve, ordinal 1..`maxOrdinal`, contiguous. An ordinal nobody has ' +
      'reached is still present with `n: 0` and null percentiles — the axis is ' +
      'completed, the measurements are not invented.',
    type: [SkillGrowthOrdinalDto],
  })
  ordinals!: SkillGrowthOrdinalDto[];

  @ApiProperty({
    description:
      'How far the curve is drawn. Bounded because the population halves every ' +
      'few ordinals: beyond about a dozen sessions every cell is a handful of ' +
      'enthusiasts and their personal noise would be plotted as a platform ' +
      'trend.',
  })
  maxOrdinal!: number;

  @ApiProperty({
    description:
      'Evaluated sessions a learner needs to enter the `experienced` series.',
  })
  experiencedMinSessions!: number;

  @ApiProperty({
    description:
      'Observations a percentile is stated from. Below it the score is null and ' +
      '`n` still travels. Echoed so the client does not keep a second copy that ' +
      'can drift from the one the server suppresses at.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Fixed [min, max] for the score axis. Sent so the axis cannot auto-scale ' +
      'to the data: on a 62-71 axis a nine-point wobble fills the chart and ' +
      'reads as a transformation.',
    type: [Number],
    example: [0, 100],
  })
  scoreDomain!: [number, number];

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({ type: SkillGrowthSummaryDto })
  summary!: SkillGrowthSummaryDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'the sessions carry a tenant, so the whole curve honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
