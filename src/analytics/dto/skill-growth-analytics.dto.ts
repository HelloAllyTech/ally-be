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
  SKILL_TREND_SORT_KEYS,
  SkillTrendClass,
  SkillTrendSortKey,
} from '../util/skill-growth.util';

const TREND_CLASSES: SkillTrendClass[] = [
  'improving',
  'flat',
  'declining',
  'insufficient',
];

/**
 * Skill growth — GET /v1/analytics/skill-growth, `/skill-growth/learners`,
 * `/skill-growth/learners/:userId` (Highlights → Skill growth, AAQ-042..047
 * and 049).
 *
 * **What is measured (ruler R1, the foundational helping skills measure).**
 * Each learner's completed roleplay practice, in the order it ended, is cut
 * into 5,000-character slices of THEIR OWN speech ("cuts"); every slice is
 * scored by an AI judge against one fixed rubric of foundational helping
 * skills, 1–4 per skill where the slice gave an opportunity for it, and the
 * composite is the mean of the scored skills (1–4). Only slices scored under
 * the pinned rubric version (`rubricVersion`) are read; test organisations
 * are excluded. The judge has not yet been validated against trained human
 * raters — practice feedback, not a clinical assessment.
 *
 * **The series changed in 2026-10.** Before then these endpoints plotted the
 * LLM judge's 0–100 score of the AI ACTOR (the roleplay character) by the
 * learner's Nth session, not anything about the learner. The response KEYS
 * were kept so a released admin build keeps rendering; their MEANING changed
 * as each field's description says (an ordinal is a scored slice, not a
 * session; a score is 1–4, not 0–100). Screenshots from before 2026-10 show a
 * different measure and cannot be compared with these.
 *
 * Takes NO window params: the x-axis is not a calendar. Cut N is the
 * learner's Nth 5,000 characters of practice, whenever it happened, so a
 * 30-day window would build the later ordinals from whoever binged that month
 * and report the length of the window. The card states "all time".
 */
export class SkillGrowthQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by each cut's own tenant (the " +
      'org of the session the slice closed in). A learner who moved orgs keeps ' +
      'their absolute cut numbers, so practice done elsewhere is not credited ' +
      'here. Omitted: every non-test org.',
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
 * One cell of the curve: where the typical slice sits and how wide the spread
 * is, plus the sample it came from. `n` is present whatever the percentiles
 * do, so a suppressed cell says "n = 4 · need 20" instead of an unexplained gap.
 */
export class SkillGrowthCellDto {
  @ApiProperty({
    description:
      'Median helping-skills composite (1–4, 2 dp) of the learners’ cut at ' +
      'this ordinal, or null when `n` is below `minSampleSize`.',
    nullable: true,
    type: Number,
  })
  median!: number | null;

  @ApiProperty({
    description: '25th percentile (1–4); null below the sample floor',
    nullable: true,
    type: Number,
  })
  p25!: number | null;

  @ApiProperty({
    description: '75th percentile (1–4); null below the sample floor',
    nullable: true,
    type: Number,
  })
  p75!: number | null;

  @ApiProperty({
    description:
      'Scored cuts behind this cell — one per learner (a learner has at most ' +
      'one cut at each index), so this is also the learners behind it. Always ' +
      'returned, even when the percentiles are suppressed.',
  })
  n!: number;
}

/** One ordinal of the curve, with both populations side by side. */
export class SkillGrowthOrdinalDto {
  @ApiProperty({
    description:
      "The learner's cut index: 1 = their first 5,000 characters of roleplay " +
      'speech, 2 = the next 5,000, and so on — the same amount of practice for ' +
      'everyone (until 2026-10 this was the Nth judged SESSION). A cut that ' +
      'failed scoring or is not yet scored leaves a gap: that learner is absent ' +
      'at this ordinal and present again at their next scored cut, exactly as ' +
      'on the Helping skills tab.',
  })
  ordinal!: number;

  @ApiProperty({
    description: 'Every learner with a scored cut at this index.',
    type: SkillGrowthCellDto,
  })
  all!: SkillGrowthCellDto;

  @ApiProperty({
    description:
      'The SAME cuts, restricted to learners with at least ' +
      '`experiencedMinSessions` scored cuts in total — held fixed from their ' +
      'first cut onwards. The survivorship control: ordinal 1 is everyone who ' +
      'ever completed a slice while ordinal 8 is only those who kept going, ' +
      'and the ones who kept going tend to be the ones doing well. If both ' +
      'lines rise the improvement survives the composition change; if only ' +
      '`all` rises, what is being measured is attrition.',
    type: SkillGrowthCellDto,
  })
  experienced!: SkillGrowthCellDto;
}

/** How the plotted score was produced — on the card, not in a doc somewhere. */
export class SkillGrowthProvenanceDto {
  @ApiProperty({
    description:
      'What the number is: the learner ruler (R1), how slices are cut and ' +
      'scored, and what an ordinal means.',
  })
  derivation!: string;

  @ApiProperty({
    description:
      'The caveats that travel with the curve: AI judge not validated against ' +
      'human raters, pinned rubric version, slices can span scenarios, and the ' +
      'series change of 2026-10 (before it this chart plotted the AI actor’s ' +
      'judge score, not the learner).',
  })
  note!: string;
}

/** Whole-population figures behind the curve. */
export class SkillGrowthSummaryDto {
  @ApiProperty({ description: 'Learners with at least one scored cut' })
  learners!: number;

  @ApiProperty({
    description:
      'Of those, learners with at least `experiencedMinSessions` scored cuts — ' +
      'the population the `experienced` series is drawn from.',
  })
  experiencedLearners!: number;

  @ApiProperty({
    description:
      'Scored cuts (slices) across every learner, INCLUDING cuts beyond ' +
      '`maxOrdinal` (counted here, not plotted). Name kept for the released ' +
      'client: until 2026-10 it counted judged sessions.',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Median composite (1–4) at ordinal 1 of the `all` series — the baseline ' +
      'the curve is read against. Null below the sample floor.',
    nullable: true,
    type: Number,
  })
  firstOrdinalMedian!: number | null;

  @ApiProperty({
    description:
      'Highest ordinal whose `all` sample clears `minSampleSize` — where the ' +
      'line stops being worth reading. Null when even ordinal 1 is below it.',
    nullable: true,
    type: Number,
  })
  lastComparableOrdinal!: number | null;

  @ApiProperty({
    description:
      'Median at `lastComparableOrdinal`. Against `firstOrdinalMedian` this is ' +
      'the headline — but it compares two DIFFERENT populations (whoever ' +
      'reached each cut); the `experienced` series and the Helping skills ' +
      'tab’s paired start→now change are the within-learner reads.',
    nullable: true,
    type: Number,
  })
  lastComparableMedian!: number | null;
}

/**
 * The knobs the trend classification turned on, echoed with every response so
 * no client keeps a second copy. The classification is the Helping skills
 * tab's (`learnerTrend` in `util/foundational-skills-progress.util.ts`):
 * first half of ALL a learner's scored cuts against the last half, with a
 * band sized to the measured slice-to-slice noise.
 */
export class SkillTrendThresholdsDto {
  @ApiProperty({
    description:
      'Scored cuts a learner needs before their trend is classified at all ' +
      '(`FHS_PROGRESS_THRESHOLDS.trendMinCuts`). Below it, or when the noise ' +
      'cannot be estimated, the learner is `insufficient` with null means. ' +
      'Name kept for the released client: it counts cuts, not sessions.',
  })
  minSessions!: number;

  @ApiProperty({
    description:
      'Cuts in each half AT the classification minimum: ⌊minSessions/2⌋. A ' +
      'learner with k scored cuts compares their first ⌊k/2⌋ with their last ' +
      '⌊k/2⌋, so this is the SMALLEST window anyone is classified on — not a ' +
      'fixed window (until 2026-10 it was a fixed 2 sessions).',
  })
  window!: number;

  @ApiProperty({
    description:
      'The band (composite points, 1–4 scale) a learner with exactly ' +
      '`minSessions` cuts must clear: bandZ × cutNoiseSd × √(2 / window). The ' +
      'WIDEST band any classified learner faces; learners with more cuts face ' +
      'a narrower one, carried on their own row as `band`. Null when the ' +
      'noise cannot be estimated (no learner has two consecutive scored cuts).',
    nullable: true,
    type: Number,
  })
  flatBand!: number | null;

  @ApiProperty({
    description:
      'Slice-to-slice noise in the composite (3 dp): the SD of differences ' +
      'between consecutive scored cuts, over √2, pooled across the learners in ' +
      'scope. The same estimate the Helping skills tab’s precision card shows ' +
      'for the same scope. Null with no consecutive pairs.',
    nullable: true,
    type: Number,
  })
  cutNoiseSd!: number | null;

  @ApiProperty({
    description: 'z of the noise band (95%).',
    example: 1.96,
  })
  bandZ!: number;

  @ApiProperty({
    description: 'The classification rule, in words, with the live constants.',
  })
  bandRule!: string;
}

/** One month of the mix, keyed by when learners became classifiable. */
export class SkillTrendMixMonthDto {
  @ApiProperty({
    description:
      "'YYYY-MM' (UTC) in which the session that closed the learner's " +
      '`minSessions`th scored cut ended — the month they became classifiable, ' +
      'NOT calendar activity. Each classified learner appears in exactly one ' +
      'month (with their class today), so the bars sum to the population.',
    example: '2026-08',
  })
  month!: string;

  @ApiProperty() improving!: number;
  @ApiProperty({ description: 'Steady: the change sits inside the noise band' })
  flat!: number;
  @ApiProperty() declining!: number;
}

/** Improving / flat / declining, each learner against their own baseline. */
export class SkillTrendMixDto {
  @ApiProperty({
    description:
      'Learners classified improving, flat (steady) or declining — the same ' +
      'learners and classes as the Helping skills tab’s trend for this scope.',
  })
  classifiedLearners!: number;

  @ApiProperty({
    description:
      'Learners with at least one scored cut but too few to classify ' +
      '(`thresholds.minSessions`), or no noise estimate — reported, never ' +
      'silently dropped, so the classified share is read against the whole ' +
      'population.',
  })
  insufficientLearners!: number;

  @ApiProperty({ description: 'Change ≥ +band' }) improving!: number;
  @ApiProperty({ description: 'Change inside ±band ("steady")' })
  flat!: number;
  @ApiProperty({ description: 'Change ≤ −band' }) declining!: number;

  @ApiProperty({ type: [SkillTrendMixMonthDto] })
  months!: SkillTrendMixMonthDto[];

  @ApiProperty({ type: SkillTrendThresholdsDto })
  thresholds!: SkillTrendThresholdsDto;
}

/**
 * Does a learner's Nth slice of practice score better than their first, on
 * the learner ruler? All-time by construction — see {@link SkillGrowthQueryDto}.
 */
export class SkillGrowthResponseDto {
  @ApiProperty({
    description:
      'The curve, ordinal (cut index) 1..`maxOrdinal`, contiguous. An ordinal ' +
      'nobody has reached is still present with `n: 0` and null percentiles — ' +
      'the axis is completed, the measurements are not invented.',
    type: [SkillGrowthOrdinalDto],
  })
  ordinals!: SkillGrowthOrdinalDto[];

  @ApiProperty({
    description:
      'How far the curve is drawn, in cuts. Bounded because the population ' +
      'thins with every cut: beyond about a dozen every cell is a handful of ' +
      'enthusiasts and their noise would be plotted as a platform trend.',
  })
  maxOrdinal!: number;

  @ApiProperty({
    description:
      'Scored cuts a learner needs to enter the `experienced` series. Name ' +
      'kept for the released client: it counts cuts, not sessions.',
  })
  experiencedMinSessions!: number;

  @ApiProperty({
    description:
      'Observations a percentile is stated from. Below it the score is null and ' +
      '`n` still travels. Echoed so the client does not keep a second copy.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Fixed [min, max] for the score axis: the rubric’s 1–4 (was 0–100 until ' +
      '2026-10). Sent so the axis cannot auto-scale to the data.',
    type: [Number],
    example: [1, 4],
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description:
      'The rubric version every score here was judged under. Scores from two ' +
      'versions are never pooled; a new version re-scores every slice.',
    example: 'fhs-text-v1',
  })
  rubricVersion!: string;

  @ApiProperty({
    description: 'Learner characters per cut — the size of one ordinal step.',
    example: 5000,
  })
  cutSizeLearnerChars!: number;

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({ type: SkillGrowthSummaryDto })
  summary!: SkillGrowthSummaryDto;

  @ApiProperty({
    description:
      'Improving / flat / declining, each learner against their OWN first ' +
      'cuts — the per-person answer the population curve nets out.',
    type: () => SkillTrendMixDto,
  })
  trendMix!: SkillTrendMixDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'every cut carries a tenant, so the whole response honours the filter ' +
      '(including the noise estimate behind the trend band).',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

/** Paging + sorting for the learner drill-down list. */
export class SkillGrowthLearnersQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by each cut's own tenant.",
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
      "Sort key. Default 'delta' (the learner's own change — never their " +
      "level). 'evaluatedSessions' sorts by scored cuts, 'lastSessionAt' by " +
      'their latest scored cut. Nulls (unclassified learners) always sort ' +
      'last; learner id breaks ties.',
    required: false,
    enum: [...SKILL_TREND_SORT_KEYS],
    default: 'delta',
  })
  @IsOptional()
  @IsIn([...SKILL_TREND_SORT_KEYS])
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

  @ApiProperty({
    description: "The learner's own tenant (users.tenant_id).",
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({
    description:
      'Scored cuts in scope. Name kept for the released client: until 2026-10 ' +
      'it counted judged sessions.',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Mean composite (1–4, 2 dp) of the FIRST ⌊k/2⌋ of the learner’s k scored ' +
      'cuts. Null for `insufficient` learners.',
    nullable: true,
    type: Number,
  })
  firstWindowMean!: number | null;

  @ApiProperty({
    description:
      'Mean composite of the LAST ⌊k/2⌋ scored cuts; null when insufficient.',
    nullable: true,
    type: Number,
  })
  lastWindowMean!: number | null;

  @ApiProperty({
    description:
      'Last half − first half (2 dp, composite points); null when insufficient.',
    nullable: true,
    type: Number,
  })
  delta!: number | null;

  @ApiProperty({
    description:
      '± band this learner’s `delta` had to clear (bandZ × cutNoiseSd × ' +
      '√(2 / ⌊k/2⌋), 2 dp); null when insufficient.',
    nullable: true,
    type: Number,
  })
  band!: number | null;

  @ApiProperty({
    enum: TREND_CLASSES,
    description:
      'The Helping skills tab’s class under this endpoint’s names: steady → ' +
      '`flat`, too early → `insufficient`.',
  })
  trend!: SkillTrendClass;

  @ApiProperty({
    description:
      'When the session that closed their latest scored cut ended (ISO). Name ' +
      'kept for the released client.',
    nullable: true,
    type: String,
  })
  lastSessionAt!: string | null;
}

/** One page of the learner drill-down list. */
export class SkillGrowthLearnersResponseDto {
  @ApiProperty({ type: [SkillTrendLearnerRowDto] })
  rows!: SkillTrendLearnerRowDto[];

  @ApiProperty({
    description:
      'Learners with at least one scored cut in scope, across every page.',
  })
  total!: number;

  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;

  @ApiProperty({ type: SkillTrendThresholdsDto })
  thresholds!: SkillTrendThresholdsDto;

  @ApiProperty({ example: 'fhs-text-v1' })
  rubricVersion!: string;

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({
    description:
      'Which tenant the list (and its noise estimate) was narrowed to.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}

/** One raw `skillCoverage` entry — retained for the released client's types. */
export class SkillCoverageEntryDto {
  @ApiProperty({ description: 'Skill category label as emitted.' })
  category!: string;

  @ApiProperty({ description: '0-100.' })
  percentage!: number;
}

/** One scored cut on a single learner's timeline. */
export class SkillGrowthLearnerSessionDto {
  @ApiProperty({
    description:
      "The cut index (1 = this learner's first 5,000 characters). Gaps are cuts " +
      'that failed scoring or are not yet scored. Until 2026-10 one entry was a ' +
      'judged session.',
  })
  ordinal!: number;

  @ApiProperty({
    description:
      'When the session the cut closed in ended (ISO) — the cut’s place in time.',
    nullable: true,
    type: String,
  })
  occurredAt!: string | null;

  @ApiProperty({
    description:
      'The scenarios the cut’s sessions ran: distinct titles in practice order, ' +
      'joined " · " (a cut can span several scenarios). Null when none resolves.',
    nullable: true,
    type: String,
  })
  scenarioTitle!: string | null;

  @ApiProperty({
    description:
      'Helping-skills composite for this cut: mean of the scored skills, 1–4, ' +
      '2 dp (was an integer 0–100 actor score until 2026-10).',
  })
  compositeScore!: number;

  @ApiProperty({
    description:
      'Always null since 2026-10: per-skill levels now come from the same ' +
      'ruler as the composite, in `skillLevels`. Kept so the released client ' +
      'renders no per-skill chart instead of failing.',
    nullable: true,
    type: [SkillCoverageEntryDto],
  })
  skillCoverage!: SkillCoverageEntryDto[] | null;

  @ApiProperty({
    description:
      'Level 1–4 per foundational skill the cut gave an opportunity for, keyed ' +
      'by rubric key. A skill absent here had no opportunity — never read it ' +
      'as a low score.',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  skillLevels!: Record<string, number>;

  @ApiProperty({
    description:
      'True when the judge saw at least one unhelpful behaviour in the cut; ' +
      'null when not recorded.',
    nullable: true,
    type: Boolean,
  })
  hasUnhelpfulBehaviour!: boolean | null;
}

/** One scored knowledge-side attempt (quiz or annotation). Unchanged. */
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

  @ApiProperty({ description: 'Scored cuts, every org (not capped).' })
  evaluatedSessions!: number;

  @ApiProperty({ nullable: true, type: Number })
  firstWindowMean!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  lastWindowMean!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  delta!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  band!: number | null;

  @ApiProperty({ enum: TREND_CLASSES })
  trend!: SkillTrendClass;
}

/**
 * One learner's full timeline: the roleplay series (now their scored cuts)
 * and the knowledge series SIDE BY SIDE, never blended — an invented weighting
 * would hide which signal moved.
 *
 * Platform-wide: the learner is classified over ALL their scored cuts against
 * the platform-wide noise estimate, which is what the unfiltered list shows.
 * Under an org filter the list classifies within that org (its cuts, its
 * noise), as the Helping skills tab does, so the two can differ for a learner
 * who practised in several orgs.
 */
export class SkillGrowthLearnerSeriesResponseDto {
  @ApiProperty({ type: SkillGrowthLearnerDto })
  learner!: SkillGrowthLearnerDto;

  @ApiProperty({
    description:
      'Every scored cut, oldest first (the learner’s own x-axis). Key name kept ' +
      'for the released client: one entry is a cut, not a session.',
    type: [SkillGrowthLearnerSessionDto],
  })
  sessions!: SkillGrowthLearnerSessionDto[];

  @ApiProperty({
    description:
      'Scored quiz and annotation attempts, oldest first. Unchanged.',
    type: [SkillGrowthKnowledgeAttemptDto],
  })
  knowledgeAttempts!: SkillGrowthKnowledgeAttemptDto[];

  @ApiProperty({
    description:
      'True when either series hit the server-side row cap and the timeline ' +
      'shown is incomplete — surfaced rather than silently truncated.',
  })
  truncated!: boolean;

  @ApiProperty({
    description: 'Platform-wide thresholds the learner was classified under.',
    type: SkillTrendThresholdsDto,
  })
  thresholds!: SkillTrendThresholdsDto;

  @ApiProperty({
    description:
      'Fixed [min, max] for the ROLEPLAY (cut composite) axis: 1–4. Until ' +
      '2026-10 it covered every axis in the response at 0–100.',
    type: [Number],
    example: [1, 4],
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description:
      'Fixed [min, max] for the quiz/annotation axis (`scorePct`, 0–100).',
    type: [Number],
    example: [0, 100],
  })
  knowledgeScoreDomain!: [number, number];

  @ApiProperty({ example: 'fhs-text-v1' })
  rubricVersion!: string;

  @ApiProperty({ type: SkillGrowthProvenanceDto })
  provenance!: SkillGrowthProvenanceDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
