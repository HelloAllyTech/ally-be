import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Foundational helping skills by practice volume — the Priority tab chart.
 *
 * Takes no query params. The x-axis is not a calendar: cut N is each learner's
 * Nth 5,000 characters of their own roleplay speech, whenever they said it, so a
 * date window would only measure who binged inside it. And Priority has no page
 * filters, so the response is platform-wide (test organisations excluded).
 */

export class FoundationalSkillsQueryDto {
  @ApiProperty({
    description:
      'The cut every learner is compared with. 1 (default) is their first cut; 2 ' +
      'treats cut 1 as a warm-up — on production data feedback-seeking and ' +
      'unhelpful behaviour both step once between cut 1 and cut 2, so a cut-1 ' +
      'baseline mostly measures that step.',
    required: false,
    enum: [1, 2],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  baselineCut?: 1 | 2;
}

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
      '95% interval of `pairedChange` (normal approximation over the paired learners); null below `minSampleSize`',
    nullable: true,
    type: [Number],
  })
  pairedChangeCi!: [number, number] | null;

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
    description: 'The cut each learner is compared with (1 or 2)',
  })
  baselineCut!: number;

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

export class FoundationalSkillsCutSessionDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty({ nullable: true, type: Number }) scenarioId!: number | null;
  @ApiProperty({ nullable: true, type: String }) scenarioTitle!: string | null;
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

  @ApiProperty({
    description:
      'Sessions the cut touches, in order, with their scenario — the content that filled it',
    type: [FoundationalSkillsCutSessionDto],
  })
  sessions!: FoundationalSkillsCutSessionDto[];
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
// Helping skills sub-tab: GET /v1/analytics/foundational-skills/progress
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

  @ApiProperty({
    description:
      'First cut of the "start" window. 2 leaves cut 1 out as a warm-up (needs a ' +
      'panel of 3+ cuts; otherwise falls back to 1). The served `windows.from` ' +
      'says which was used.',
    required: false,
    enum: [1, 2],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  baselineFrom?: 1 | 2;
}

export class FhsProgressThresholdsDto {
  @ApiProperty() trendMinCuts!: number;
  @ApiProperty() learnerBandZ!: number;
  @ApiProperty() rareOpportunityPct!: number;
  @ApiProperty() cappedLevelShare!: number;
  @ApiProperty() behaviourQ!: number;
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
  @ApiProperty({ enum: [1, 2], description: 'First cut of the start window' })
  from!: number;
}

export class FhsChangeDto {
  @ApiProperty({ description: 'Learners in the paired comparison' }) n!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Mean own change; null below the floor',
  })
  change!: number | null;
  @ApiProperty({
    nullable: true,
    type: [Number],
    description: 'Paired bootstrap 95% CI',
  })
  ci!: [number, number] | null;
  @ApiProperty() up!: number;
  @ApiProperty() down!: number;
  @ApiProperty() tied!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Exact two-sided sign test',
  })
  signP!: number | null;
  @ApiProperty({ description: 'True only when the CI excludes zero' })
  detectable!: boolean;
}

export class FhsPrecisionDto {
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'SD of one cut composite around a learner (pooled)',
  })
  cutNoiseSd!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Share of composite variance that belongs to the learner (ICC(1))',
  })
  icc!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'SD of the panel learners own changes',
  })
  panelChangeSd!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Smallest mean change detectable at 80% power for this panel',
  })
  minimumDetectableChange!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '± band a single learner must clear for this panel',
  })
  learnerBand!: number | null;
  @ApiProperty({
    description: 'Stored skill levels re-derived from their codes',
  })
  levelsChecked!: number;
  @ApiProperty({
    description: 'Of those, levels that disagree with their codes',
  })
  levelCodeMismatches!: number;
}

export class FhsDepthStepDto {
  @ApiProperty() atLeast!: number;
  @ApiProperty() learners!: number;
}

export class FhsUnhelpfulSummaryDto {
  @ApiProperty({ nullable: true, type: Number }) earlyPct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) latePct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) changePts!: number | null;
  @ApiProperty({ nullable: true, type: [Number] }) ciPts!:
    | [number, number]
    | null;
  @ApiProperty() stopped!: number;
  @ApiProperty() started!: number;
  @ApiProperty() persisted!: number;
  @ApiProperty() never!: number;
  @ApiProperty({ nullable: true, type: Number }) signP!: number | null;
  @ApiProperty() detectable!: boolean;
}

export class FhsSkillCountsDto {
  @ApiProperty() detectableUp!: number;
  @ApiProperty() detectableDown!: number;
  @ApiProperty() noDetectableChange!: number;
  @ApiProperty() tooFewLearners!: number;
  @ApiProperty() notMeasurable!: number;
}

export class FhsProgressSummaryDto {
  @ApiProperty() cohortLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) earlyComposite!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lateComposite!: number | null;
  @ApiProperty({ type: FhsChangeDto }) composite!: FhsChangeDto;
  @ApiProperty({ type: FhsUnhelpfulSummaryDto })
  unhelpful!: FhsUnhelpfulSummaryDto;
  @ApiProperty({ type: FhsSkillCountsDto }) skills!: FhsSkillCountsDto;
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
  @ApiProperty({ nullable: true, type: [Number] }) compositeCi!:
    | [number, number]
    | null;
  @ApiProperty({ nullable: true, type: Number }) unhelpfulPct!: number | null;
  @ApiProperty({ nullable: true, type: [Number] }) unhelpfulCi!:
    | [number, number]
    | null;
  @ApiProperty({ type: [FhsTierAtCutDto] }) tiers!: FhsTierAtCutDto[];
  @ApiProperty({ type: [FhsSkillAtCutDto] }) skills!: FhsSkillAtCutDto[];
}

export class FhsTierChangeDto extends FhsChangeDto {
  @ApiProperty({ enum: ['engage', 'understand', 'support'] }) tier!: string;
  @ApiProperty({ nullable: true, type: Number }) earlyAvg!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lateAvg!: number | null;
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

export class FhsProgressSkillDto extends FhsChangeDto {
  @ApiProperty() skill!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['engage', 'understand', 'support'] }) tier!: string;
  @ApiProperty({
    enum: ['measurable', 'capped', 'rare'],
    description:
      '"rare": assessable in under `rareOpportunityPct`% of cuts; "capped": `cappedLevelShare` of assessments at one level. Neither can show a move',
  })
  measurability!: string;
  @ApiProperty({ nullable: true, type: Number }) earlyAvg!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lateAvg!: number | null;
  @ApiProperty({ type: FhsLevelMixDto }) levelMix!: FhsLevelMixDto;
  @ApiProperty() opportunityCuts!: number;
  @ApiProperty({ nullable: true, type: Number }) opportunityPct!: number | null;
  @ApiProperty({
    description: 'Learners with at least one chance at the skill',
  })
  learnersWithOpportunity!: number;
  @ApiProperty({
    description: 'Learners with two or more chances — enough to see any change',
  })
  learnersWithTwoPlus!: number;
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
  @ApiProperty() gained!: number;
  @ApiProperty() lost!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Exact sign test, gained vs lost',
  })
  signP!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Benjamini–Hochberg q across all behaviours',
  })
  q!: number | null;
  @ApiProperty({ description: 'q at or below `thresholds.behaviourQ`' })
  credible!: boolean;
  @ApiProperty({
    description: 'All learners whose cut 1 gave the skill a chance',
  })
  firstSliceLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) firstSlicePct!: number | null;
  @ApiProperty({ description: 'All learners with any chance at the skill' })
  everLearners!: number;
  @ApiProperty({ nullable: true, type: Number }) everPct!: number | null;
}

export class FhsSelfHarmDto {
  @ApiProperty() learnersWithCue!: number;
  @ApiProperty() cutsWithCue!: number;
  @ApiProperty() cutsFollowedUp!: number;
  @ApiProperty() cutsMissed!: number;
  @ApiProperty({ description: 'Both a miss and a follow-up coded, or neither' })
  cutsAmbiguous!: number;
  @ApiProperty() cutsWithAdvanced!: number;
  @ApiProperty() cutsWithOtherUnhelpful!: number;
  @ApiProperty() learnersFollowedFirst!: number;
  @ApiProperty() learnersMissedFirst!: number;
  @ApiProperty() learnersAmbiguousFirst!: number;
  @ApiProperty({ description: 'Learners with 2+ clearly coded cue cuts' })
  repeatLearners!: number;
  @ApiProperty() repeatBetter!: number;
  @ApiProperty() repeatWorse!: number;
  @ApiProperty() repeatSame!: number;
}

export class FhsConfidentialityDto {
  @ApiProperty() learnersAssessable!: number;
  @ApiProperty() cutsAssessable!: number;
  @ApiProperty() learnersWithTwoPlus!: number;
  @ApiProperty() learnersExplained!: number;
  @ApiProperty() learnersListedExceptions!: number;
  @ApiProperty() learnersExplainedWhy!: number;
  @ApiProperty() learnersPromisedAbsolute!: number;
  @ApiProperty() learnersInaccurate!: number;
}

export class FhsSafetyDto {
  @ApiProperty({ type: FhsSelfHarmDto }) selfHarm!: FhsSelfHarmDto;
  @ApiProperty({ type: FhsConfidentialityDto })
  confidentiality!: FhsConfidentialityDto;
}

export class FhsTrendMixDto {
  @ApiProperty() improving!: number;
  @ApiProperty() steady!: number;
  @ApiProperty() declining!: number;
  @ApiProperty({ description: 'Fewer than `trendMinCuts` scored cuts' })
  tooEarly!: number;
}

export class FhsCoachingFlagDto {
  @ApiProperty() code!: string;
  @ApiProperty() skill!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: ['safety', 'repeat'] }) kind!: string;
  @ApiProperty({ type: [Number] }) cuts!: number[];
  @ApiProperty({
    description: 'Seen in either of the learner’s latest two cuts',
  })
  recent!: boolean;
}

export class FhsProgressLearnerDto {
  @ApiProperty() id!: number;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) tenantId!: string | null;
  @ApiProperty() cutsReached!: number;
  @ApiProperty() earlyComposite!: number;
  @ApiProperty() lateComposite!: number;
  @ApiProperty() change!: number;
  @ApiProperty({ nullable: true, type: Number }) band!: number | null;
  @ApiProperty({ nullable: true, enum: ['up', 'down'] }) beyondNoise!:
    | string
    | null;
  @ApiProperty() unhelpfulEarly!: boolean;
  @ApiProperty() unhelpfulLate!: boolean;
  @ApiProperty({ type: [FhsCoachingFlagDto] }) flags!: FhsCoachingFlagDto[];
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
  @ApiProperty({ type: FhsPrecisionDto }) precision!: FhsPrecisionDto;
  @ApiProperty({ type: [FhsDepthStepDto] }) depth!: FhsDepthStepDto[];
  @ApiProperty({ type: FhsProgressSummaryDto }) summary!: FhsProgressSummaryDto;
  @ApiProperty({ type: [FhsProgressCutDto] }) byCut!: FhsProgressCutDto[];
  @ApiProperty({ type: [FhsTierChangeDto] }) tiers!: FhsTierChangeDto[];
  @ApiProperty({ type: [FhsProgressSkillDto] }) skills!: FhsProgressSkillDto[];
  @ApiProperty({ type: [FhsProgressBehaviourDto] })
  behaviours!: FhsProgressBehaviourDto[];
  @ApiProperty({ type: FhsSafetyDto }) safety!: FhsSafetyDto;
  @ApiProperty({ type: FhsTrendMixDto }) trend!: FhsTrendMixDto;
  @ApiProperty({ type: [FhsProgressLearnerDto] })
  learners!: FhsProgressLearnerDto[];
  @ApiProperty() learnersTruncated!: boolean;
  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;
  @ApiProperty() computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Behaviour rates ("habits"): GET /v1/analytics/foundational-skills/behaviours
// ─────────────────────────────────────────────────────────────────────────────

export class FoundationalSkillsBehavioursQueryDto {
  @ApiProperty({
    description:
      'Return this one learner with every behaviour they have had a chance at (group figures are still over everyone)',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

export class FhsBehaviourThresholdsDto {
  @ApiProperty() minCuts!: number;
  @ApiProperty() trackableIcc!: number;
  @ApiProperty() groupQ!: number;
  @ApiProperty() learnerP!: number;
  @ApiProperty() gridBehaviours!: number;
}

export class FhsBehaviourCountDto {
  @ApiProperty({ description: 'Slices where the behaviour was shown' })
  hits!: number;
  @ApiProperty({ description: 'Slices where its skill could be shown at all' })
  chances!: number;
}

export class FhsBehaviourGroupChangeDto {
  @ApiProperty({
    description: 'Learners with a chance in both their start and now halves',
  })
  n!: number;
  @ApiProperty({ nullable: true, type: Number }) startPct!: number | null;
  @ApiProperty({ nullable: true, type: Number }) nowPct!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Mean own change, points',
  })
  changePts!: number | null;
  @ApiProperty({ nullable: true, type: [Number] }) ciPts!:
    | [number, number]
    | null;
  @ApiProperty() up!: number;
  @ApiProperty() down!: number;
  @ApiProperty({ nullable: true, type: Number }) signP!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Benjamini–Hochberg across all behaviours',
  })
  q!: number | null;
  @ApiProperty() credible!: boolean;
  @ApiProperty({
    description: 'Learners whose own change is clear (Fisher p ≤ learnerP), up',
  })
  learnersAdopted!: number;
  @ApiProperty() learnersDropped!: number;
}

export class FhsBehaviourRateDto {
  @ApiProperty() code!: string;
  @ApiProperty() skill!: string;
  @ApiProperty({ enum: ['unhelpful', 'basic', 'advanced'] }) kind!: string;
  @ApiProperty() text!: string;
  @ApiProperty() learnersWithChance!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Mean of learners’ own rates, %',
  })
  ratePct!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'How person-specific the behaviour is (ICC); null until enough learners had repeat chances',
  })
  icc!: number | null;
  @ApiProperty() trackable!: boolean;
  @ApiProperty({ type: FhsBehaviourGroupChangeDto })
  change!: FhsBehaviourGroupChangeDto;
}

export class FhsLearnerBehaviourDto {
  @ApiProperty() code!: string;
  @ApiProperty({ type: FhsBehaviourCountDto }) all!: FhsBehaviourCountDto;
  @ApiProperty({ nullable: true, type: FhsBehaviourCountDto })
  start!: FhsBehaviourCountDto | null;
  @ApiProperty({ nullable: true, type: FhsBehaviourCountDto })
  now!: FhsBehaviourCountDto | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Fisher exact, start vs now',
  })
  p!: number | null;
  @ApiProperty({ nullable: true, enum: ['adopted', 'dropped'] }) clear!:
    | string
    | null;
}

export class FhsBehaviourLearnerDto {
  @ApiProperty() id!: number;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) tenantId!: string | null;
  @ApiProperty() cuts!: number;
  @ApiProperty({ description: 'Has enough slices for start vs now' })
  comparable!: boolean;
  @ApiProperty({ type: [FhsLearnerBehaviourDto] })
  behaviours!: FhsLearnerBehaviourDto[];
}

export class FoundationalSkillsBehavioursResponseDto {
  @ApiProperty() rubricVersion!: string;
  @ApiProperty() minSampleSize!: number;
  @ApiProperty({ type: FhsBehaviourThresholdsDto })
  thresholds!: FhsBehaviourThresholdsDto;
  @ApiProperty() measuredLearners!: number;
  @ApiProperty({ description: 'Learners with enough slices for start vs now' })
  comparableLearners!: number;
  @ApiProperty({ type: [FhsBehaviourRateDto] })
  behaviours!: FhsBehaviourRateDto[];
  @ApiProperty({
    type: [String],
    description: 'Habit-grid behaviours, most person-specific first',
  })
  gridCodes!: string[];
  @ApiProperty({ type: [FhsBehaviourLearnerDto] })
  learners!: FhsBehaviourLearnerDto[];
  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;
  @ApiProperty() computedAt!: string;
}
