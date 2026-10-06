import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Scenarios as practice content — the Curriculum sub-tab's "Scenarios" section.
 *
 *  - GET /v1/analytics/scenarios/opportunity-coverage (AAQ-214, AAQ-215):
 *    does each scenario create an opportunity for the skills it is tagged
 *    with? Read on the foundational helping-skills cuts (ruler R1).
 *  - GET /v1/analytics/scenarios/repeat-improvement (AAQ-216): when a learner
 *    replays the same scenario, does their session score rise? Read on
 *    `scenario_sessions.score` (ruler R2), within one scenario version.
 *
 * Both are ALL TIME by construction and take no range: a cut is "the learner's
 * Nth 5,000 characters", and a replay pair is "this learner's first and latest
 * play", whenever they happened — a date window would only measure who
 * practised inside it. Platform-wide unless `tenantId` narrows them to one org;
 * test organisations always excluded. These shapes are a frontend contract.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioEffectivenessProvenanceDto {
  @ApiProperty({
    description:
      'Which ruler the numbers are read on (R1 helping-skills cuts, R2 session score) and how they are made',
  })
  derivation!: string;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/scenarios/opportunity-coverage
// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioOpportunityCoverageQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Cuts are scoped by the tenant ' +
      'of the session they were cut from, and "sessions played" by the ' +
      "session's own tenant. Omitted: every non-test org.",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class ScenarioCoverageSkillDto {
  @ApiProperty({ description: 'Stable rubric skill key (e.g. `verbal`)' })
  skill!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;
}

export class ScenarioOpportunityCellDto {
  @ApiProperty({
    description: 'Rubric skill key; cells come in `skills` order',
  })
  skill!: string;

  @ApiProperty({
    description:
      'True when the scenario is tagged with a competency that maps to this skill — outline the cell. A dim outlined cell is a tag the scenario does not deliver',
  })
  tagged!: boolean;

  @ApiProperty({
    description:
      "The scenario's single-scenario cuts in which the judge found an opportunity for this skill",
  })
  opportunities!: number;

  @ApiProperty({
    description:
      "opportunities ÷ the row's `cuts`, as a percentage (0–100, 1 dp). Rows exist only at or above `minSampleSize` cuts, so this is never withheld inside a row",
    nullable: true,
    type: Number,
  })
  opportunityPct!: number | null;
}

export class ScenarioOpportunityRowDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'Scored cuts attributed wholly to this scenario (every session in the cut played it). At least `minSampleSize`',
  })
  cuts!: number;

  @ApiProperty({
    description:
      'Distinct learners behind those cuts — a row of 20 cuts from 2 people reads differently from 20 from 15',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Countable sessions of this scenario, all time, in scope (any learner, scored or not)',
  })
  sessionsPlayed!: number;

  @ApiProperty({
    type: [String],
    description:
      "Rubric skill keys the scenario's competency tags map to (`competencyIds` + legacy `competencyId` → seeded competency name → skill), rubric order. Empty when no tag maps",
  })
  taggedSkills!: string[];

  @ApiProperty({
    type: [String],
    description:
      'Non-custom tag names with no rubric skill (e.g. "Linking Emotions, Thoughts & Behaviours", "Non-Verbal Communication", admin-created competencies)',
  })
  untranslatableTags!: string[];

  @ApiProperty({
    description:
      'Custom (owner-private) competency tags. Counted, not named: their names identify the owner, not a skill',
  })
  customTags!: number;

  @ApiProperty({ type: [ScenarioOpportunityCellDto] })
  cells!: ScenarioOpportunityCellDto[];
}

export class ScenarioCoverageBelowFloorDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description: 'Single-scenario cuts so far — fewer than `minSampleSize`',
  })
  cuts!: number;
}

export class ScenarioTagGapDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'The tagged rubric skill key' })
  skill!: string;

  @ApiProperty({
    description:
      'Share of the scenario’s single-scenario cuts with an opportunity for the skill — below `thresholds.maxOpportunityPct`',
  })
  opportunityPct!: number;

  @ApiProperty({
    description:
      'Single-scenario cuts the share rests on — at least `thresholds.minCuts`',
  })
  cuts!: number;

  @ApiProperty({
    description:
      'Countable sessions of the scenario, all time, in scope — the sort key (fix the most-played first)',
  })
  sessionsPlayed!: number;
}

export class ScenarioTagGapThresholdsDto {
  @ApiProperty({
    description:
      'A tagged skill is a gap when its opportunity share is below this (%)',
    example: 30,
  })
  maxOpportunityPct!: number;

  @ApiProperty({
    description: '…over at least this many single-scenario cuts',
    example: 20,
  })
  minCuts!: number;
}

export class ScenarioOpportunityCoverageResponseDto {
  @ApiProperty({
    description: 'The one rubric version every cut here was scored under',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'A scenario needs this many single-scenario cuts for a row; shares below it are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    type: [ScenarioCoverageSkillDto],
    description: 'The 14 rubric skills, in column order',
  })
  skills!: ScenarioCoverageSkillDto[];

  @ApiProperty({
    description: 'Scored cuts in scope (rubric-pinned, test orgs excluded)',
  })
  scoredCuts!: number;

  @ApiProperty({
    description:
      'Of those, cuts whose every session played one scenario — the only cuts this card attributes',
  })
  singleScenarioCuts!: number;

  @ApiProperty({
    description:
      'singleScenarioCuts ÷ scoredCuts, as a percentage (1 dp). Put it on the card: below ~60% the rows describe a minority of practice. Null below `minSampleSize` scored cuts',
    nullable: true,
    type: Number,
  })
  singleScenarioShare!: number | null;

  @ApiProperty({
    type: [ScenarioOpportunityRowDto],
    description:
      'Scenarios with at least `minSampleSize` single-scenario cuts, most cuts first. Empty (never 404) when none qualify',
  })
  scenarios!: ScenarioOpportunityRowDto[];

  @ApiProperty({
    type: [ScenarioCoverageBelowFloorDto],
    description:
      'Scenarios with some single-scenario cuts but fewer than `minSampleSize` — n only, most cuts first',
  })
  belowFloor!: ScenarioCoverageBelowFloorDto[];

  @ApiProperty({
    type: [ScenarioTagGapDto],
    description:
      'EFF-31: (scenario, tagged skill) pairs whose opportunity share is below `thresholds.maxOpportunityPct` over at least `thresholds.minCuts` cuts, most sessions played first — the content team’s fix list',
  })
  tagGaps!: ScenarioTagGapDto[];

  @ApiProperty({ type: ScenarioTagGapThresholdsDto })
  thresholds!: ScenarioTagGapThresholdsDto;

  @ApiProperty({ type: ScenarioEffectivenessProvenanceDto })
  provenance!: ScenarioEffectivenessProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/scenarios/repeat-improvement
// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioRepeatImprovementQueryDto {
  @ApiProperty({
    description:
      'scenarios.id for the slope chart (`selected`). Omitted: the scenario with the most pairs. The per-scenario table and pooled summary are returned either way.',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  scenarioId?: number;

  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by the session's own tenant. Omitted: every non-test org.",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class ScenarioRepeatRowDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'scenario_versions.id the plays ran against. Null = sessions that recorded no version (they predate versioning); edits between such plays are not tracked',
    nullable: true,
    type: String,
  })
  versionId!: string | null;

  @ApiProperty({
    description:
      'scenario_versions.versionNumber, for a "v3" label; null with no version',
    nullable: true,
    type: Number,
  })
  versionNumber!: number | null;

  @ApiProperty({
    description:
      'Learners with 2+ eligible plays of this version, whatever the gap between them',
  })
  repeaters!: number;

  @ApiProperty({
    description:
      'Of those, learners whose first and latest play are at least a day apart — the paired set',
  })
  pairs!: number;

  @ApiProperty({
    description:
      'Mean first-play score (raw points); null below `minSampleSize` pairs',
    nullable: true,
    type: Number,
  })
  firstAvg!: number | null;

  @ApiProperty({
    description:
      'Mean latest-play score of the same learners; null below `minSampleSize` pairs',
    nullable: true,
    type: Number,
  })
  latestAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own change (latest − first), raw points of THIS version only; null below `minSampleSize` pairs',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` (deterministic); null below `minSampleSize` pairs',
    nullable: true,
    type: [Number],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose latest score beat their first' })
  up!: number;

  @ApiProperty({
    description: 'Learners whose latest score fell below their first',
  })
  down!: number;

  @ApiProperty({ description: 'Learners who scored the same' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (ties dropped); null below `minSampleSize` pairs',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `changeCi` excludes zero. Always false below the floor',
  })
  detectable!: boolean;

  @ApiProperty({
    description:
      "When this scenario's scoring config (event mappings, behaviour instructions, or any PASSIVE event) was last edited. A scenario VERSION does not pin its scoring — edits change the live rows in place — so pairs on one version can still compare two scoring configs. Null when unknown",
    nullable: true,
    type: String,
  })
  scoringChangedAt!: string | null;

  @ApiProperty({
    description:
      'Of `pairs`, those whose first play came before `scoringChangedAt` and latest after it: they may compare two scoring configs. Only the last edit is knowable, so this is a floor. Read the change with this beside it',
  })
  pairsSpanningScoringChange!: number;
}

export class ScenarioRepeatPooledDto {
  @ApiProperty({
    description:
      'Paired learner × scenario-version comparisons across every scenario',
  })
  pairs!: number;

  @ApiProperty({
    description:
      'Distinct learners behind them. Each counts ONCE: their pairs collapse to the sign of the mean of their per-pair signs (up on most of their scenarios = up), because raw points do not compare across scenarios',
  })
  learners!: number;

  @ApiProperty({ description: 'Learners who went up, on balance' })
  up!: number;

  @ApiProperty({ description: 'Learners who went down, on balance' })
  down!: number;

  @ApiProperty({ description: 'Learners with no net direction' })
  tied!: number;

  @ApiProperty({
    description:
      'up ÷ (up + down) as a percentage (1 dp), ties left out; null below `minSampleSize` learners or with no non-tied learner',
    nullable: true,
    type: Number,
  })
  improvingPct!: number | null;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down learners; null below `minSampleSize` learners',
    nullable: true,
    type: Number,
  })
  signP!: number | null;
}

export class ScenarioRepeatLearnerDto {
  @ApiProperty({
    description: 'users.id — an id, not a name: this is a population view',
  })
  learnerId!: number;

  @ApiProperty({ description: 'First eligible play’s score (raw points)' })
  first!: number;

  @ApiProperty({ description: 'Latest eligible play’s score (raw points)' })
  latest!: number;

  @ApiProperty({
    description: 'latest − first. Rows are sorted by this, biggest rise first',
  })
  change!: number;

  @ApiProperty({ description: 'When the first play started (ISO)' })
  firstAt!: string;

  @ApiProperty({ description: 'When the latest play started (ISO)' })
  latestAt!: string;

  @ApiProperty({
    description: 'Eligible plays of this version in between, inclusive',
  })
  plays!: number;
}

export class ScenarioRepeatSelectedDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty({
    description:
      'Null only when the requested scenario has no repeat plays at all',
    nullable: true,
    type: String,
  })
  title!: string | null;

  @ApiProperty({
    description:
      'The version shown: the scenario’s version with the most pairs',
    nullable: true,
    type: String,
  })
  versionId!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  versionNumber!: number | null;

  @ApiProperty({
    description: 'Learners with 2+ eligible plays of that version',
  })
  repeaters!: number;

  @ApiProperty({
    description: 'Of those, learners paired (≥ 1 day between first and latest)',
  })
  pairs!: number;

  @ApiProperty({
    type: [ScenarioRepeatLearnerDto],
    nullable: true,
    description:
      'One slope per paired learner; null below `minSampleSize` pairs (the counts above still say how far off it is)',
  })
  learners!: ScenarioRepeatLearnerDto[] | null;
}

export class ScenarioRepeatPickerItemDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description: 'The version the slope chart would show',
    nullable: true,
    type: String,
  })
  versionId!: string | null;

  @ApiProperty({ description: 'Pairs on that version' })
  pairs!: number;
}

export class ScenarioRepeatThresholdsDto {
  @ApiProperty({
    description: 'First and latest play must be at least this many hours apart',
    example: 24,
  })
  minSpanHours!: number;

  @ApiProperty({ description: 'Scenarios offered in `picker`', example: 10 })
  pickerSize!: number;
}

export class ScenarioRepeatImprovementResponseDto {
  @ApiProperty({
    description:
      'Averages, intervals, tests and the slope list below this many pairs (or learners, pooled) are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({ type: ScenarioRepeatThresholdsDto })
  thresholds!: ScenarioRepeatThresholdsDto;

  @ApiProperty({
    description:
      'Learner × scenario-version groups with 2+ eligible plays, before the one-day span rule',
  })
  repeatGroups!: number;

  @ApiProperty({
    type: [ScenarioRepeatRowDto],
    description:
      'Every scenario version with a repeat player, most pairs first. Empty (never 404) when nobody has replayed anything',
  })
  scenarios!: ScenarioRepeatRowDto[];

  @ApiProperty({
    type: ScenarioRepeatPooledDto,
    description: 'Scale-free summary across every scenario',
  })
  pooled!: ScenarioRepeatPooledDto;

  @ApiProperty({
    type: ScenarioRepeatSelectedDto,
    nullable: true,
    description:
      'The slope chart’s scenario (`scenarioId`, else the top of `picker`); null when no scenario has a repeat player',
  })
  selected!: ScenarioRepeatSelectedDto | null;

  @ApiProperty({
    type: [ScenarioRepeatPickerItemDto],
    description:
      'Top scenarios by pairs (each on its best version), for the picker',
  })
  picker!: ScenarioRepeatPickerItemDto[];

  @ApiProperty({ type: ScenarioEffectivenessProvenanceDto })
  provenance!: ScenarioEffectivenessProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}
