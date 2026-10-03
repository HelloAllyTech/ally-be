import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Foundational helping skills by practice volume — the Priority tab chart.
 *
 * Takes no query params. The x-axis is not a calendar: cut N is each learner's
 * Nth 5,000 characters of their own roleplay speech, whenever they said it, so a
 * date window would only measure who binged inside it. And Priority has no page
 * filters, so the response is platform-wide (test organisations excluded).
 */

export class FoundationalSkillsSkillDto {
  @ApiProperty({
    description:
      'Stable skill key (e.g. `verbal`, `empathy`). Non-verbal communication is not text-assessable and never appears',
  })
  skill!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;
}

export class FoundationalSkillsCutSkillDto {
  @ApiProperty()
  skill!: string;

  @ApiProperty({
    description: 'Learners at this cut for whom the skill was assessable',
  })
  learners!: number;

  @ApiProperty({
    description: 'Average score (1–4); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  avgScore!: number | null;
}

export class FoundationalSkillsCutDto {
  @ApiProperty({ description: '1-based cut index' })
  cut!: number;

  @ApiProperty({
    description:
      'Learners with a scored cut at this index. Present whatever the averages do.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Average composite (mean of the assessable skills, 1–4) across those learners; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  avgScore!: number | null;

  @ApiProperty({
    description:
      'Of those learners, how many also have a scored first cut (the paired set)',
  })
  baselineLearners!: number;

  @ApiProperty({
    description:
      'The paired set’s average at THIS cut; with `baselineAvgScore` it gives the change within the same learners. Null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  pairedAvgScore!: number | null;

  @ApiProperty({
    description:
      "The SAME learners' average at cut 1; null below `minSampleSize`",
    nullable: true,
    type: Number,
  })
  baselineAvgScore!: number | null;

  @ApiProperty({
    description:
      'Mean of each paired learner’s own change since cut 1; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  pairedChange!: number | null;

  @ApiProperty({
    description:
      'Percent of learners whose cut showed at least one unhelpful behaviour (any skill scored 1); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  unhelpfulPct!: number | null;

  @ApiProperty({ type: [FoundationalSkillsCutSkillDto] })
  skills!: FoundationalSkillsCutSkillDto[];
}

export class FoundationalSkillsCoverageDto {
  @ApiProperty({ description: 'Learners with at least one sealed cut' })
  learners!: number;

  @ApiProperty()
  cutsSealed!: number;

  @ApiProperty({ description: 'Scored under the current rubric version' })
  cutsScored!: number;

  @ApiProperty({ description: 'Last attempt failed (retried up to 3 times)' })
  cutsFailed!: number;

  @ApiProperty({ description: 'Not yet attempted under the current version' })
  cutsPending!: number;
}

export class FoundationalSkillsProvenanceDto {
  @ApiProperty()
  derivation!: string;

  @ApiProperty()
  note!: string;
}

export class FoundationalSkillsResponseDto {
  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({ description: 'Learner speech per cut, in characters' })
  cutSizeLearnerChars!: number;

  @ApiProperty({
    description: 'Averages below this many learners are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({ type: [Number], example: [1, 4] })
  scoreDomain!: [number, number];

  @ApiProperty({ type: [FoundationalSkillsSkillDto] })
  skills!: FoundationalSkillsSkillDto[];

  @ApiProperty({
    type: [FoundationalSkillsCutDto],
    description:
      'Cuts in order, up to the last one reached by at least 5 learners (MIN_COHORT_SIZE)',
  })
  cuts!: FoundationalSkillsCutDto[];

  @ApiProperty({ type: FoundationalSkillsCoverageDto })
  coverage!: FoundationalSkillsCoverageDto;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-learner drill-down: GET /v1/analytics/foundational-skills/learners
// ─────────────────────────────────────────────────────────────────────────────

export class FoundationalSkillsLearnersQueryDto {
  @ApiProperty({
    description:
      'Only learners with a scored cut at this index — the same rule as the ' +
      "chart's per-cut `learners`, so `minCut=5` returns exactly the people " +
      'behind the cut-5 point. Every scored cut of each learner is returned.',
    required: false,
    default: 1,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  minCut?: number;

  @ApiProperty({
    description: 'Learners per page',
    required: false,
    default: 100,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    description: 'Narrow to one learner (users.id) — the per-person drill-down',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

export class FoundationalSkillsLearnerCutDto {
  @ApiProperty({ description: '1-based cut index' })
  cut!: number;

  @ApiProperty({
    description:
      'When the session the cut closed in ended — its place in calendar time',
  })
  closedAt!: string;

  @ApiProperty({ description: 'Mean of the assessable skills, 1–4' })
  compositeScore!: number;

  @ApiProperty({
    description: 'Any assessed skill scored 1 (an unhelpful behaviour seen)',
    nullable: true,
    type: Boolean,
  })
  hasUnhelpfulBehaviour!: boolean | null;

  @ApiProperty({
    description:
      '`{ "<skill key>": level }` for the skills this cut gave an opportunity ' +
      'for. An absent key means not assessable here, not a low score',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  skillLevels!: Record<string, number>;

  @ApiProperty({
    description:
      'Behaviour codes the judge saw, `<skill>.<u|b|a><n>` (unhelpful / basic / ' +
      'advanced), sorted. Text for each code is in the rubric; no transcript text',
    type: [String],
  })
  observed!: string[];
}

export class FoundationalSkillsLearnerDto {
  @ApiProperty({ description: 'users.id' })
  id!: number;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    description: 'Tenant of the session the latest returned cut closed in',
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({ description: 'Highest scored cut index' })
  cutsReached!: number;

  @ApiProperty({
    description:
      'Latest cut minus cut 1; null when cut 1 has no scored result. Each ' +
      'end is one judged slice, so read it alongside the full series',
    nullable: true,
    type: Number,
  })
  changeSinceFirstCut!: number | null;

  @ApiProperty({ type: [FoundationalSkillsLearnerCutDto] })
  cuts!: FoundationalSkillsLearnerCutDto[];
}

export class FoundationalSkillsLearnersResponseDto {
  @ApiProperty()
  rubricVersion!: string;

  @ApiProperty()
  minCut!: number;

  @ApiProperty({ description: 'Learners matching `minCut`, across all pages' })
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty({
    type: [FoundationalSkillsLearnerDto],
    description: 'Ordered by user id',
  })
  learners!: FoundationalSkillsLearnerDto[];

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills sub-tab: GET /v1/analytics/foundational-skills/progress
// ─────────────────────────────────────────────────────────────────────────────

export class FoundationalSkillsProgressQueryDto {
  @ApiProperty({
    description:
      'Panel size: compare the same learners across their first N cuts (every ' +
      'one of cuts 1..N scored). Must be one of `cohortOptions`; anything else ' +
      'falls back to the default — the largest panel with at least ' +
      '`minSampleSize` learners.',
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
}

export class FhsProgressThresholdsDto {
  @ApiProperty() trendMinCuts!: number;
  @ApiProperty() compositeFlatBand!: number;
  @ApiProperty() skillFlatBand!: number;
  @ApiProperty() skillMoveBand!: number;
  @ApiProperty() maxLearnerRows!: number;
}

export class FhsCohortOptionDto {
  @ApiProperty() cuts!: number;
  @ApiProperty() learners!: number;
}

export class FhsWindowsDto {
  @ApiProperty({ type: [Number], description: 'Cuts averaged as "start"' })
  early!: number[];

  @ApiProperty({ type: [Number], description: 'Cuts averaged as "now"' })
  late!: number[];
}

export class FhsProgressSummaryDto {
  @ApiProperty() cohortLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) earlyComposite!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lateComposite!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Mean of each learner’s own change, start → now',
  })
  compositeChange!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Share of the panel with any unhelpful behaviour at the start',
  })
  unhelpfulEarlyPct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) unhelpfulLatePct!:
    | number
    | null;
  @ApiProperty() skillsUp!: number;
  @ApiProperty() skillsDown!: number;
  @ApiProperty() skillsSteady!: number;
  @ApiProperty({ description: 'Skills with too few paired learners to say' })
  skillsWithheld!: number;
}

export class FhsTierAtCutDto {
  @ApiProperty({ enum: ['engage', 'understand', 'support'] }) tier!: string;
  @ApiProperty() learners!: number;
  @ApiProperty({ nullable: true, type: Number }) avgLevel!: number | null;
}

export class FhsSkillAtCutDto {
  @ApiProperty() skill!: string;
  @ApiProperty() learners!: number;
  @ApiProperty({ nullable: true, type: Number }) avgLevel!: number | null;
}

export class FhsProgressCutDto {
  @ApiProperty() cut!: number;
  @ApiProperty() learners!: number;
  @ApiProperty({ nullable: true, type: Number }) composite!: number | null;
  @ApiProperty({ nullable: true, type: Number }) unhelpfulPct!: number | null;
  @ApiProperty({ type: [FhsTierAtCutDto] }) tiers!: FhsTierAtCutDto[];
  @ApiProperty({ type: [FhsSkillAtCutDto] }) skills!: FhsSkillAtCutDto[];
}

export class FhsLevelMixWindowDto {
  @ApiProperty({ description: 'Skill assessments in the window' })
  assessments!: number;

  @ApiProperty({
    description:
      'Counts at levels 1, 2, 3, 4; null below `minSampleSize` assessments',
    nullable: true,
    type: [Number],
  })
  levels!: number[] | null;
}

export class FhsLevelMixDto {
  @ApiProperty({ type: FhsLevelMixWindowDto }) early!: FhsLevelMixWindowDto;
  @ApiProperty({ type: FhsLevelMixWindowDto }) late!: FhsLevelMixWindowDto;
}

export class FhsProgressSkillDto {
  @ApiProperty() skill!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['engage', 'understand', 'support'] }) tier!: string;
  @ApiProperty({
    description: 'Panel learners the skill was assessable for in both windows',
  })
  pairedLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) earlyAvg!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lateAvg!: number | null;
  @ApiProperty({ nullable: true, type: Number }) change!: number | null;
  @ApiProperty() improved!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() declined!: number;
  @ApiProperty({ type: FhsLevelMixDto }) levelMix!: FhsLevelMixDto;
  @ApiProperty({
    description: 'Scored cuts, platform-wide, that gave an opportunity for it',
  })
  opportunityCuts!: number;
  @ApiProperty({ nullable: true, type: Number }) opportunityPct!: number | null;
}

export class FhsProgressBehaviourDto {
  @ApiProperty({ description: '`<skill>.<u|b|a><n>`' }) code!: string;
  @ApiProperty() skill!: string;
  @ApiProperty({ enum: ['unhelpful', 'basic', 'advanced'] }) kind!: string;
  @ApiProperty() text!: string;
  @ApiProperty() pairedLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) earlyPct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) latePct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) changePts!: number | null;
}

export class FhsUnhelpfulTransitionsDto {
  @ApiProperty({ description: 'Unhelpful at the start, none now' })
  stopped!: number;
  @ApiProperty({ description: 'Unhelpful at the start and now' })
  persisted!: number;
  @ApiProperty({ description: 'None at the start, unhelpful now' })
  started!: number;
  @ApiProperty({ description: 'Neither window' })
  never!: number;
}

export class FhsTrendMixDto {
  @ApiProperty() improving!: number;
  @ApiProperty() steady!: number;
  @ApiProperty() declining!: number;
  @ApiProperty({ description: 'Fewer than `trendMinCuts` scored cuts' })
  tooEarly!: number;
}

export class FhsDoseBucketDto {
  @ApiProperty() label!: string;
  @ApiProperty() learners!: number;
  @ApiProperty({ nullable: true, type: Number }) avgChange!: number | null;
}

export class FhsProgressLearnerDto {
  @ApiProperty() id!: number;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) tenantId!: string | null;
  @ApiProperty() cutsReached!: number;
  @ApiProperty() earlyComposite!: number;
  @ApiProperty() lateComposite!: number;
  @ApiProperty() change!: number;
  @ApiProperty({ enum: ['improving', 'steady', 'declining', 'tooEarly'] })
  trend!: string;
  @ApiProperty() skillsImproved!: number;
  @ApiProperty() skillsDeclined!: number;
  @ApiProperty() unhelpfulEarly!: boolean;
  @ApiProperty() unhelpfulLate!: boolean;
}

export class FoundationalSkillsProgressResponseDto {
  @ApiProperty() rubricVersion!: string;
  @ApiProperty() cutSizeLearnerChars!: number;
  @ApiProperty() minSampleSize!: number;
  @ApiProperty() minCohortSize!: number;
  @ApiProperty({ type: [Number], example: [1, 4] }) scoreDomain!: [
    number,
    number,
  ];
  @ApiProperty({ type: FhsProgressThresholdsDto })
  thresholds!: FhsProgressThresholdsDto;
  @ApiProperty({ description: 'The panel size these numbers are for' })
  cuts!: number;
  @ApiProperty({ type: [FhsCohortOptionDto] })
  cohortOptions!: FhsCohortOptionDto[];
  @ApiProperty({ type: FhsWindowsDto }) windows!: FhsWindowsDto;
  @ApiProperty({ description: 'Learners with at least one scored cut' })
  measuredLearners!: number;
  @ApiProperty({ type: FhsProgressSummaryDto }) summary!: FhsProgressSummaryDto;
  @ApiProperty({ type: [FhsProgressCutDto] }) byCut!: FhsProgressCutDto[];
  @ApiProperty({ type: [FhsProgressSkillDto] }) skills!: FhsProgressSkillDto[];
  @ApiProperty({ type: [FhsProgressBehaviourDto] })
  behaviours!: FhsProgressBehaviourDto[];
  @ApiProperty({ type: FhsUnhelpfulTransitionsDto })
  unhelpfulTransitions!: FhsUnhelpfulTransitionsDto;
  @ApiProperty({ type: FhsTrendMixDto }) trend!: FhsTrendMixDto;
  @ApiProperty({ type: [FhsDoseBucketDto] }) dose!: FhsDoseBucketDto[];
  @ApiProperty({ type: [FhsProgressLearnerDto] })
  learners!: FhsProgressLearnerDto[];
  @ApiProperty() learnersTruncated!: boolean;
  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;
  @ApiProperty() computedAt!: string;
}
