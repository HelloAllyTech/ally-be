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

import {
  FhsCohortOptionDto,
  FhsWindowsDto,
  FoundationalSkillsProvenanceDto,
} from './foundational-skills-analytics.dto';
import {
  SEGMENT_DIMENSIONS,
  SegmentDimension,
} from '../util/effectiveness.util';

/**
 * Highlights → Effectiveness: does practice on Ally change how people help?
 *
 *  - GET /v1/analytics/effectiveness/funnel (EFF-02, AAQ-203) — where learners
 *    fall out of the chain, from an account to a measured improvement.
 *  - GET /v1/analytics/foundational-skills/progress/segments (EFF-03, AAQ-204;
 *    `dimension=difficultyTransition` is EFF-13, AAQ-219 on Helping skills) —
 *    the Helping skills start→now change, split by one segment dimension.
 *
 * Both are ALL-TIME by construction and take no date window: every stage and
 * every ordinal ("the learner's Nth cut") is a lifetime property of a person,
 * and a window would only measure who happened to binge inside it. Test
 * organisations are excluded everywhere; every learner-skill number is pinned
 * to ONE rubric version (ruler R1, `rubricVersion`). Floors are applied on the
 * server — a share of people needs `minCohortSize`, an average, change or rate
 * needs `minSampleSize` — and below a floor the number is null while its count
 * still travels. A null is a decision to withhold, never "zero". This shape is
 * a frontend contract.
 */

const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Scoping block: which org the response was narrowed to, and how. */
export class EffectivenessScopingDto {
  @ApiProperty({
    description:
      'Tenant the response was narrowed to; null = every non-test org',
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({
    description:
      'How the org filter reaches each part of the response — the population and the scored cuts are attributed to an org differently',
  })
  note!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EFF-02 · GET /v1/analytics/effectiveness/funnel
// ─────────────────────────────────────────────────────────────────────────────

export class EffectivenessFunnelQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Stages 1–3 by the learner’s own org ' +
      '(as the activation funnel), stages 4–7 by the org of the session each scored cut ' +
      'closed in (as Helping skills). Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(TENANT_ID_PATTERN, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class EffectivenessFunnelStageDto {
  @ApiProperty({
    description: 'Stable stage key; the client keys copy and colour off it',
    enum: [
      'signedUp',
      'firstSession',
      'secondSession',
      'firstScoredCut',
      'measurable',
      'classifiable',
      'improving',
    ],
  })
  key!: string;

  @ApiProperty({ description: 'Admin-facing label, in funnel order' })
  label!: string;

  @ApiProperty({ description: 'The stage’s definition, for the tooltip' })
  description!: string;

  @ApiProperty({
    description:
      'Distinct learners at this stage AND every stage above it (always present, never floored). Non-increasing down the list',
  })
  reached!: number;

  @ApiProperty({
    description:
      'reached ÷ the first stage’s reached × 100 (1 dp). Null when the first stage has fewer than `minCohortSize` learners; on `improving`, also null when `trend.classifiable` < `minSampleSize`. The first stage carries 100 when stated',
    nullable: true,
    type: Number,
  })
  ofEnteredPct!: number | null;

  @ApiProperty({
    description:
      'reached ÷ the previous stage’s reached × 100 (1 dp). Null on the first stage, when the previous stage has fewer than `minCohortSize` learners, and on `improving` when `trend.classifiable` < `minSampleSize`',
    nullable: true,
    type: Number,
  })
  ofPreviousPct!: number | null;

  @ApiProperty({
    description: 'True on the last (success) stage — FunnelBars’ accent bar',
  })
  terminal!: boolean;
}

/**
 * The split a funnel's last step would otherwise hide: of the classifiable
 * learners, how many are improving, steady or declining.
 */
export class EffectivenessFunnelTrendDto {
  @ApiProperty({
    description:
      'Learners at the `classifiable` stage (4+ scored cuts, inside the funnel)',
  })
  classifiable!: number;

  @ApiProperty({
    description:
      'Last half of their cuts above their first half by at least the noise band (the `improving` stage)',
  })
  improving!: number;

  @ApiProperty({ description: 'Within the noise band either way' })
  steady!: number;

  @ApiProperty({ description: 'Below their own start by at least the band' })
  declining!: number;

  @ApiProperty({
    description:
      'Classifiable but not classified because no noise estimate exists yet (fewer than two consecutive-cut pairs platform-wide). 0 in practice',
  })
  unclassified!: number;

  @ApiProperty({
    description:
      'improving ÷ classifiable × 100 (1 dp); null below `minSampleSize` classifiable learners',
    nullable: true,
    type: Number,
  })
  improvingPct!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'As improvingPct' })
  steadyPct!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'As improvingPct' })
  decliningPct!: number | null;
}

/**
 * Who the intersection drops. Stages 4–7 come from scored cuts, which are not
 * nested inside stages 1–3 by construction: one long first session can fill a
 * 5,000-character cut on its own (so a learner can have a scored cut with one
 * session), and practice by a trainer or admin is cut like anyone's (so a cut
 * learner need not be in the learner-role population). The funnel keeps a
 * learner in a later stage only when they are in every earlier one; these
 * counts say how many measured learners that clamp removed, and why.
 */
export class EffectivenessFunnelClampDto {
  @ApiProperty({
    description:
      'Learners with at least one scored cut in scope — the Helping skills tab’s `measuredLearners`',
  })
  measuredLearners!: number;

  @ApiProperty({
    description:
      'Of those, learners not in the funnel’s `secondSession` stage, so counted in no stage from `firstScoredCut` down',
  })
  outsideFunnel!: number;

  @ApiProperty({
    description:
      'Of outsideFunnel: not a learner-role account in scope (a trainer or admin who practised, or a learner whose own org differs from the cuts’ org under a filter)',
  })
  notInPopulation!: number;

  @ApiProperty({
    description:
      'Of outsideFunnel: in the population but with fewer than two countable sessions (their first cut came from one long session)',
  })
  fewerThanTwoSessions!: number;
}

/**
 * Helping skills AAQ-181's own counts for the same org filter, before the
 * funnel's intersection — so the two cards can be reconciled by eye.
 */
export class EffectivenessHelpingSkillsTrendDto {
  @ApiProperty() improving!: number;
  @ApiProperty() steady!: number;
  @ApiProperty() declining!: number;
  @ApiProperty({ description: 'Fewer than `trendMinCuts` scored cuts' })
  tooEarly!: number;
}

export class EffectivenessFunnelResponseDto {
  @ApiProperty({
    description: 'The one rubric version stages 4–7 come from (ruler R1)',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'The improving/steady/declining shares (and the improving stage’s shares) need this many classifiable learners',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'A share of people needs a denominator of at least this many',
  })
  minCohortSize!: number;

  @ApiProperty({
    description:
      'Scored cuts a learner needs before their own trend is classified (the `classifiable` stage)',
  })
  trendMinCuts!: number;

  @ApiProperty({
    type: [EffectivenessFunnelStageDto],
    description:
      'Seven stages in order: signedUp → firstSession → secondSession → firstScoredCut → measurable → classifiable → improving. Each is a subset of the one above (intersected; see `clamp`)',
  })
  stages!: EffectivenessFunnelStageDto[];

  @ApiProperty({ type: EffectivenessFunnelTrendDto })
  trend!: EffectivenessFunnelTrendDto;

  @ApiProperty({ type: EffectivenessFunnelClampDto })
  clamp!: EffectivenessFunnelClampDto;

  @ApiProperty({
    type: EffectivenessHelpingSkillsTrendDto,
    description:
      'AAQ-181’s improving / steady / declining / too-early counts over every measured learner in scope, unclamped',
  })
  helpingSkillsTrend!: EffectivenessHelpingSkillsTrendDto;

  @ApiProperty({
    description:
      'Slice-to-slice composite noise (SD) the bands are sized from, over every measured learner in scope; null with too few consecutive cuts',
    nullable: true,
    type: Number,
  })
  cutNoiseSd!: number | null;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: EffectivenessScopingDto })
  scoping!: EffectivenessScopingDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EFF-03 · GET /v1/analytics/foundational-skills/progress/segments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Segments are NOT independent — language, org and course overlap — so read
 * one dimension at a time, and treat a difference between two segments as a
 * hypothesis to check (against the mix and the CIs), not a finding. No test
 * between segments is run, deliberately: at today's n it would mostly be a test
 * of which segment happens to be bigger.
 */
export class FoundationalSkillsSegmentsQueryDto {
  @ApiProperty({
    description:
      'What to split the panel by. `language`: majority session language (scenario_sessions.metadata.languageId → languages) over the sessions in the learner’s panel cuts; tie → "mixed", none resolvable → "unknown". `workerType`: users.metadata.workerType as it is NOW (an admin-assigned label, not history); absent or unrecognised → "unset". `orgSize`: the org most of the learner’s panel cuts were practised in, banded by its measured learners (distinct learners with ≥1 scored cut there, under this rubric): 1–9 / 10–49 / 50+. `course`: "course" when the learner started a live course (track_enrollments.startedAt) before their first "now"-window cut closed, else "freePractice". `difficulty`: majority scenarios.difficultyLevel (EASY / MEDIUM / HARD; MEDIUM is the column default, so an untouched scenario reads as Medium) over the sessions in the panel cuts; tie → "mixed", none → "untagged". `difficultyTransition` (EFF-13): the same majority difficulty taken separately over the sessions in the learner’s START-window cuts and their NOW-window cuts, as "<start>→<now>" (e.g. EASY→HARD; mixed/untagged as for `difficulty`) — whether a flat composite hides learners taking on harder material. With today’s volume most cells sit below the floor; the card renders only when at least one segment is in `segments`.',
    required: false,
    enum: SEGMENT_DIMENSIONS,
    default: 'language',
  })
  @IsOptional()
  @IsIn([...SEGMENT_DIMENSIONS])
  dimension?: SegmentDimension;

  @ApiProperty({
    description:
      'Panel size, as on GET foundational-skills/progress: must be one of `cohortOptions`, else the default (the largest panel with at least `minSampleSize` learners)',
    required: false,
    minimum: 2,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(1000)
  cuts?: number;

  @ApiProperty({
    description:
      'First cut of the "start" window, as on GET foundational-skills/progress (default 1, the Helping skills tab’s default; 2 needs a panel of 3+). The served `windows.from` says which was used',
    required: false,
    enum: [1, 2],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  baselineFrom?: 1 | 2;

  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code), by the org of the session each cut closed in — the same scoping as GET foundational-skills/progress, so `overall` equals that endpoint’s `summary.composite`. Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(TENANT_ID_PATTERN, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/**
 * The paired start→now composite change over a set of panel learners, floored
 * and rounded exactly as Helping skills' `summary.composite` (AAQ-168).
 */
export class FhsSegmentChangeDto {
  @ApiProperty({
    description: 'Panel learners in this row. Always present',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Their mean "start"-window composite (1–4, 2 dp); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  earlyComposite!: number | null;

  @ApiProperty({
    description:
      'Their mean "now"-window composite (1–4, 2 dp); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  lateComposite!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own change (now-window mean − start-window mean), 2 dp; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      'Paired bootstrap 95% CI of `change` (deterministic), 2 dp; null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [-0.04, 0.21],
  })
  ci!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose own change is above zero' })
  up!: number;

  @ApiProperty({ description: 'Learners whose own change is below zero' })
  down!: number;

  @ApiProperty({ description: 'Learners who did not move' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (3 dp); null with nothing to test',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `ci` excludes zero; always false below `minSampleSize`. Colour a whisker only when true',
  })
  detectable!: boolean;
}

export class FhsSegmentRowDto extends FhsSegmentChangeDto {
  @ApiProperty({
    description:
      'Stable segment value: a language code, or mixed / unknown (language); LAY / EARLY_PROFESSIONAL / EXPERIENCED_PROFESSIONAL / unset (workerType); 1-9 / 10-49 / 50+ / unknown (orgSize); course / freePractice (course); EASY / MEDIUM / HARD / mixed / untagged (difficulty); "<start>→<now>" over those five, e.g. EASY→HARD (difficultyTransition)',
  })
  key!: string;

  @ApiProperty({ description: 'Admin-facing label' })
  label!: string;
}

export class FhsWithheldSegmentDto {
  @ApiProperty({ description: 'As FhsSegmentRowDto.key' })
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    description:
      'Panel learners in this segment — fewer than `minSampleSize`, so no change, CI or direction counts are stated',
  })
  learners!: number;
}

export class FoundationalSkillsSegmentsResponseDto {
  @ApiProperty({ description: 'The one rubric version (ruler R1)' })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Averages, changes, CIs and direction counts need this many learners in a row',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'A panel size is only offered with this many learners',
  })
  minCohortSize!: number;

  @ApiProperty({ type: [Number], example: [1, 4] })
  scoreDomain!: [number, number];

  @ApiProperty({
    enum: SEGMENT_DIMENSIONS,
    description: 'The dimension these segments split',
  })
  dimension!: SegmentDimension;

  @ApiProperty({
    enum: SEGMENT_DIMENSIONS,
    isArray: true,
    description: 'Every dimension this endpoint accepts, in display order',
  })
  dimensions!: SegmentDimension[];

  @ApiProperty({
    description:
      'Panel size N: the learners whose cuts 1..N are all scored — the Helping skills panel for the same request',
  })
  cuts!: number;

  @ApiProperty({ type: FhsWindowsDto })
  windows!: FhsWindowsDto;

  @ApiProperty({ type: [FhsCohortOptionDto] })
  cohortOptions!: FhsCohortOptionDto[];

  @ApiProperty({
    description: 'Learners with at least one scored cut in scope',
  })
  measuredLearners!: number;

  @ApiProperty({
    description:
      'Learners in the panel. Every one is in exactly one segment, so `segments[].learners` + `withheld[].learners` sums to this',
  })
  panelLearners!: number;

  @ApiProperty({
    type: FhsSegmentChangeDto,
    description:
      'The whole panel — equal to GET foundational-skills/progress `summary.composite` (AAQ-168) for the same cuts, baselineFrom and tenantId',
  })
  overall!: FhsSegmentChangeDto;

  @ApiProperty({
    type: [FhsSegmentRowDto],
    description:
      'Segments with at least `minSampleSize` learners, most learners first. Not independent of each other; a difference between two is a hypothesis, not a finding',
  })
  segments!: FhsSegmentRowDto[];

  @ApiProperty({
    type: [FhsWithheldSegmentDto],
    description:
      'Segments below `minSampleSize`, most learners first, with their count only',
  })
  withheld!: FhsWithheldSegmentDto[];

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: EffectivenessScopingDto })
  scoping!: EffectivenessScopingDto;

  @ApiProperty()
  computedAt!: string;
}
