import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';
import {
  SkillTrendClass,
  SkillTrendSortKey,
} from '../repository/skill-growth-analytics.repository';

const TREND_CLASSES: SkillTrendClass[] = [
  'improving',
  'flat',
  'declining',
  'insufficient',
];

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
 * The knobs a trend classification turns on, echoed with every response so no
 * client keeps a second copy that can drift from what the server classified
 * with. Chosen against local fixture data only — see the constants'
 * rationale in the repository and SKILL_VIZ_SPIKE_FINDINGS.md.
 */
export class SkillTrendThresholdsDto {
  @ApiProperty({
    description:
      'Evaluated sessions a learner needs before their trend is classified ' +
      'at all. Below it the learner reports `insufficient` with null means.',
  })
  minSessions!: number;

  @ApiProperty({
    description:
      "Sessions averaged at each end of the learner's history to form the " +
      'delta — one session against one session would classify judge noise.',
  })
  window!: number;

  @ApiProperty({
    description:
      'Half-width of the flat band, in composite-score points: a delta ' +
      'within ± this is `flat`, not movement.',
  })
  flatBand!: number;
}

/** One month of the mix, keyed by when learners became classifiable. */
export class SkillTrendMixMonthDto {
  @ApiProperty({
    description:
      "'YYYY-MM' of each learner's `minSessions`th evaluated session — the " +
      'month they became classifiable, NOT calendar activity. Each classified ' +
      'learner appears in exactly one month, so the bars sum to the population.',
    example: '2026-08',
  })
  month!: string;

  @ApiProperty() improving!: number;
  @ApiProperty() flat!: number;
  @ApiProperty() declining!: number;
}

/** Improving / flat / declining, each learner against their own baseline. */
export class SkillTrendMixDto {
  @ApiProperty({
    description: 'Learners with enough evaluated sessions to classify.',
  })
  classifiedLearners!: number;

  @ApiProperty({
    description:
      'Learners with at least one evaluated session but fewer than ' +
      '`thresholds.minSessions` — reported, never silently dropped, so the ' +
      'classified share is read against the whole population.',
  })
  insufficientLearners!: number;

  @ApiProperty() improving!: number;
  @ApiProperty() flat!: number;
  @ApiProperty() declining!: number;

  @ApiProperty({ type: [SkillTrendMixMonthDto] })
  months!: SkillTrendMixMonthDto[];

  @ApiProperty({ type: SkillTrendThresholdsDto })
  thresholds!: SkillTrendThresholdsDto;
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
      'Improving / flat / declining, each learner against their OWN first ' +
      'sessions — the per-person answer the population curve nets out.',
    type: () => SkillTrendMixDto,
  })
  trendMix!: SkillTrendMixDto;

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

/** Paging + sorting for the learner drill-down list. */
export class SkillGrowthLearnersQueryDto {
  @ApiProperty({
    description: 'Narrow to a single tenant (uuid or code).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    description:
      "Sort key. Default 'delta': the biggest movers are the rows leadership " +
      'opened this table for; unclassified learners always sort last.',
    required: false,
    enum: ['delta', 'evaluatedSessions', 'lastSessionAt'],
    default: 'delta',
  })
  @IsOptional()
  @IsIn(['delta', 'evaluatedSessions', 'lastSessionAt'])
  sort?: SkillTrendSortKey;

  @ApiProperty({
    required: false,
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** One learner's own-baseline trend, as the drill-down table lists them. */
export class SkillTrendLearnerRowDto {
  @ApiProperty() learnerId!: number;

  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) tenantId!: string | null;

  @ApiProperty({ description: 'Evaluated sessions in this scope.' })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Mean composite score of the FIRST `thresholds.window` evaluated ' +
      'sessions. Null for unclassified learners — with fewer than 2×window ' +
      'sessions the two windows would share sessions and the delta would be ' +
      'biased toward zero.',
    nullable: true,
    type: Number,
  })
  firstWindowMean!: number | null;

  @ApiProperty({
    description: 'Mean of the LAST `thresholds.window` evaluated sessions.',
    nullable: true,
    type: Number,
  })
  lastWindowMean!: number | null;

  @ApiProperty({
    description: 'lastWindowMean − firstWindowMean; null when unclassified.',
    nullable: true,
    type: Number,
  })
  delta!: number | null;

  @ApiProperty({ enum: TREND_CLASSES })
  trend!: SkillTrendClass;

  @ApiProperty({ nullable: true, type: String })
  lastSessionAt!: string | null;
}

/** One page of the learner drill-down list. */
export class SkillGrowthLearnersResponseDto {
  @ApiProperty({ type: [SkillTrendLearnerRowDto] })
  rows!: SkillTrendLearnerRowDto[];

  @ApiProperty({ description: 'Learners in scope, across every page.' })
  total!: number;

  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;

  @ApiProperty({ type: SkillTrendThresholdsDto })
  thresholds!: SkillTrendThresholdsDto;

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

/** One raw `skillCoverage` entry, passed through as the evaluator wrote it. */
export class SkillCoverageEntryDto {
  @ApiProperty({
    description:
      'Skill category label AS EMITTED — two label generations exist ' +
      '(`Listening Engagement`/`Emotional Attunement`/`Supportive engagement` ' +
      'from ally-ai; `Learning`/`Support`/`Standards` in older payloads), so ' +
      'clients group by the string they get rather than an enum.',
  })
  category!: string;

  @ApiProperty({ description: '0-100.' })
  percentage!: number;
}

/** One evaluated session on a single learner's timeline. */
export class SkillGrowthLearnerSessionDto {
  @ApiProperty({ description: "1 = this learner's first evaluated session." })
  ordinal!: number;

  @ApiProperty({ nullable: true, type: String })
  occurredAt!: string | null;

  @ApiProperty({
    description:
      'Scenario the session ran, so a score step can be read against a ' +
      'scenario change — difficulty mix is the known confound of a raw-score ' +
      'timeline.',
    nullable: true,
    type: String,
  })
  scenarioTitle!: string | null;

  @ApiProperty({ description: 'Composite judge score, 0-100.' })
  compositeScore!: number;

  @ApiProperty({
    description:
      'Per-skill percentages when the evaluation left them; null on sessions ' +
      'without a payload (most sessions predate it). A chart renders whatever ' +
      'categories exist rather than expecting all three.',
    nullable: true,
    type: [SkillCoverageEntryDto],
  })
  skillCoverage!: SkillCoverageEntryDto[] | null;
}

/** One scored knowledge-side attempt (quiz or annotation). */
export class SkillGrowthKnowledgeAttemptDto {
  @ApiProperty({ enum: ['quiz', 'annotation'] })
  kind!: 'quiz' | 'annotation';

  @ApiProperty({ nullable: true, type: String })
  itemTitle!: string | null;

  @ApiProperty({ description: '0-100.' })
  scorePct!: number;

  @ApiProperty() attemptNumber!: number;

  @ApiProperty({ nullable: true, type: String })
  submittedAt!: string | null;
}

/** The learner a drill-down is about, with their own trend classification. */
export class SkillGrowthLearnerDto {
  @ApiProperty() id!: number;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) tenantId!: string | null;

  @ApiProperty() evaluatedSessions!: number;

  @ApiProperty({ nullable: true, type: Number })
  firstWindowMean!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  lastWindowMean!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  delta!: number | null;

  @ApiProperty({ enum: TREND_CLASSES })
  trend!: SkillTrendClass;
}

/**
 * One learner's full skill timeline: the roleplay series and the knowledge
 * series SIDE BY SIDE, never blended — an invented weighting would hide which
 * signal moved.
 */
export class SkillGrowthLearnerSeriesResponseDto {
  @ApiProperty({ type: SkillGrowthLearnerDto })
  learner!: SkillGrowthLearnerDto;

  @ApiProperty({
    description:
      "Every evaluated session, oldest first (the learner's own x-axis).",
    type: [SkillGrowthLearnerSessionDto],
  })
  sessions!: SkillGrowthLearnerSessionDto[];

  @ApiProperty({
    description: 'Scored quiz and annotation attempts, oldest first.',
    type: [SkillGrowthKnowledgeAttemptDto],
  })
  knowledgeAttempts!: SkillGrowthKnowledgeAttemptDto[];

  @ApiProperty({
    description:
      'True when either series hit the server-side row cap and the timeline ' +
      'shown is incomplete — surfaced rather than silently truncated.',
  })
  truncated!: boolean;

  @ApiProperty({ type: SkillTrendThresholdsDto })
  thresholds!: SkillTrendThresholdsDto;

  @ApiProperty({
    description: 'Fixed [min, max] for every score axis in this response.',
    type: [Number],
    example: [0, 100],
  })
  scoreDomain!: [number, number];

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
