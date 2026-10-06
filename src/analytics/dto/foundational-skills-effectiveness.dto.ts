import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Three Highlights → Helping skills cards about practice over TIME:
 *
 *  - GET /v1/analytics/foundational-skills/time-to-competence (AAQ-205)
 *  - GET /v1/analytics/foundational-skills/retention          (AAQ-206)
 *  - GET /v1/analytics/practice-progression                   (AAQ-207)
 *
 * All three are ALL-TIME by construction and take no window: the x-axis is a
 * learner's own Nth slice, the time between two of their slices, or their own
 * Nth session — never a calendar. A date window would only measure who binged
 * inside it, so the card says "all time" on its face. Platform-wide unless
 * `tenantId` narrows to one org; test organisations always excluded. Floors
 * are applied here, never re-derived by the client: below a floor the number
 * is null and its count still travels. These shapes are a frontend contract.
 */

export class FoundationalSkillsEffectivenessQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Slices are scoped by the ' +
      'tenant of the session each was cut from, sessions by their own tenant — ' +
      'so practice a learner did in another org is not credited here. ' +
      'Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time to competence — AAQ-205
// ─────────────────────────────────────────────────────────────────────────────

export class TierCompetenceSkillsDto {
  @ApiProperty({
    description:
      'Engage skills needed at level 3+ (of the tier’s counted skills in `tiers[].skills`)',
  })
  engage!: number;

  @ApiProperty({
    description:
      'Understand skills needed at level 3+ (of the tier’s counted skills in `tiers[].skills`)',
  })
  understand!: number;

  @ApiProperty({
    description:
      'Support skills needed at level 3+ (of the tier’s counted skills in `tiers[].skills`)',
  })
  support!: number;
}

export class TimeToCompetencePointDto {
  @ApiProperty({ description: '1-based slice index (the learner’s Nth slice)' })
  cut!: number;

  @ApiProperty({
    description:
      'Learners still observed at this slice (their last scored slice is this one or later) who had not reached the tier before it. Always travels',
  })
  atRisk!: number;

  @ApiProperty({ description: 'Of `atRisk`, learners who reached it here' })
  reachedAtCut!: number;

  @ApiProperty({
    description:
      'Of `atRisk`, learners whose last scored slice is this one without having reached it — they leave the curve (censored), they are not counted as "never"',
  })
  censoredAtCut!: number;

  @ApiProperty({
    description:
      'Kaplan–Meier percent (1 dp) who have reached the tier by this slice: 1 − Π(1 − reached/atRisk) over slices 1..this. Null when `atRisk` is below `minSampleSize` (and so for every later slice: `atRisk` never grows)',
    nullable: true,
    type: Number,
  })
  reachedShare!: number | null;
}

export class TimeToCompetenceMissingSkillDto {
  @ApiProperty({ description: 'Stable rubric skill key, e.g. `harm`' })
  skill!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'Learners who have not reached the tier and have never scored 3+ on this skill',
  })
  missingLearners!: number;

  @ApiProperty({
    description:
      'Of `missingLearners`, those for whom the skill was never assessable — no slice gave the opportunity (typical of `harm` and `confidentiality`)',
  })
  neverAssessed!: number;

  @ApiProperty({
    description:
      'Of `missingLearners`, those who had the opportunity but never reached 3 (`missingLearners − neverAssessed`)',
  })
  assessedBelow!: number;

  @ApiProperty({
    description:
      '`missingLearners` as a percent (1 dp) of the tier’s not-yet-reached learners; null below `minCohortSize` of them',
    nullable: true,
    type: Number,
  })
  sharePct!: number | null;
}

export class TimeToCompetenceMissingDto {
  @ApiProperty({
    description:
      'Learners in the curve who have not reached this tier by their last scored slice',
  })
  learners!: number;

  @ApiProperty({
    description:
      'The skill those learners most often lack (most `missingLearners`, rubric order on ties) — what the card names. Null below `minCohortSize` not-yet-reached learners, or when none lacks any',
    nullable: true,
    type: String,
  })
  mostOftenMissing!: string | null;

  @ApiProperty({
    type: [TimeToCompetenceMissingSkillDto],
    description: 'Every skill of the tier, most often missing first',
  })
  skills!: TimeToCompetenceMissingSkillDto[];
}

export class TimeToCompetenceTierDto {
  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;

  @ApiProperty({
    type: [String],
    description: 'The tier’s rubric skill keys, in rubric order',
  })
  skills!: string[];

  @ApiProperty({
    description:
      'How many of `skills` must each have reached level 3 at least once (echo of `tierCompetenceSkills`)',
  })
  skillsRequired!: number;

  @ApiProperty({
    type: [TimeToCompetencePointDto],
    description:
      'Slices 1..N, ending at the last slice at least `minCohortSize` learners are at risk for. Empty when fewer than that ever were. Draw as a step line',
  })
  points!: TimeToCompetencePointDto[];

  @ApiProperty({ description: 'Learners in the curve who reached the tier' })
  reachedLearners!: number;

  @ApiProperty({
    description:
      'Learners in the curve who have not reached it (yet) — `learners − reachedLearners`',
  })
  notReachedLearners!: number;

  @ApiProperty({
    description:
      'Median slices to competence: the first SHOWN slice (non-null `reachedShare`) at which half have reached the tier. Null when the shown curve never gets to 50% (see `notReachedByHalf`) or nothing is shown',
    nullable: true,
    type: Number,
  })
  medianCuts!: number | null;

  @ApiProperty({
    description:
      'True when the curve has shown points and none reaches 50% — read as "fewer than half by slice `lastShownCut`". False when nothing is shown (too few learners, not "not reached")',
  })
  notReachedByHalf!: boolean;

  @ApiProperty({
    description: 'Last slice with a non-null `reachedShare`; null when none',
    nullable: true,
    type: Number,
  })
  lastShownCut!: number | null;

  @ApiProperty({
    description:
      'Median practice minutes to competence over the learners who reached it: each one’s summed countable-session time (net of pauses) up to and including the session their competence slice closed in. A median among those who got there, NOT the Kaplan–Meier median — slow learners who have not reached it yet are not in it. Null below `minSampleSize` such learners',
    nullable: true,
    type: Number,
  })
  medianMinutes!: number | null;

  @ApiProperty({
    description:
      'Learners behind `medianMinutes` (reached learners with a measurable session time). Always travels',
  })
  minutesLearners!: number;

  @ApiProperty({ type: TimeToCompetenceMissingDto })
  missing!: TimeToCompetenceMissingDto;
}

export class TimeToCompetenceExcludedSkillDto {
  @ApiProperty({ description: 'Rubric skill key (e.g. `rapport`)' })
  skill!: string;

  @ApiProperty({
    enum: ['capped', 'rare'],
    description:
      '`capped`: the rubric pins it at level 2 in a slice; `rare`: assessable only when the client raises it',
  })
  reason!: 'capped' | 'rare';
}

export class TimeToCompetenceResponseDto {
  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({ description: 'Learner speech per slice, in characters' })
  cutSizeLearnerChars!: number;

  @ApiProperty({
    description:
      'Shares and medians below this many learners are withheld (null); counts travel',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'The curve’s axis ends at the last slice at least this many learners are at risk for; shares of people below it are withheld',
  })
  minCohortSize!: number;

  @ApiProperty({
    description:
      'A skill counts as reached at this level or above: 3 = every basic behaviour of the skill and no unhelpful one',
  })
  competenceLevel!: number;

  @ApiProperty({
    type: TierCompetenceSkillsDto,
    description:
      'Per tier, how many of its COUNTED skills (the tier minus `excludedSkills`) must each have reached `competenceLevel` at least once: every counted skill but one. A ONE-TIME crossing, not sustained: a learner who reached 3 once and scored 2 since still counts, and the skills need not reach 3 in the same slice',
  })
  tierCompetenceSkills!: TierCompetenceSkillsDto;

  @ApiProperty({
    type: [TimeToCompetenceExcludedSkillDto],
    description:
      "Skills left out of every tier's count, with why: `capped` (rapport, family — every basic behaviour in one slice is out of reach under this rubric) or `rare` (confidentiality, harm — assessable only when the client raises them). The same four the Helping skills tab marks not measurable. Counting them made Engage unreachable for every learner on production (2026-10-05)",
  })
  excludedSkills!: TimeToCompetenceExcludedSkillDto[];

  @ApiProperty({
    description:
      'Learners in the curve: those whose FIRST slice is scored (in scope). Everyone enters at slice 1',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Learners with scored slices but no scored first slice in scope (it failed scoring, or it was practised in another org) — left out, since what came before is unseen',
  })
  learnersWithoutFirstCut!: number;

  @ApiProperty({
    description: 'Longest tier axis, in slices (0 when no tier has points)',
  })
  maxCut!: number;

  @ApiProperty({
    type: [TimeToCompetenceTierDto],
    description: 'Engage, Understand, Support — one curve each',
  })
  tiers!: TimeToCompetenceTierDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill retention after a break — AAQ-206
// ─────────────────────────────────────────────────────────────────────────────

export class RetentionBandDefDto {
  @ApiProperty({ enum: ['<7', '7-13', '14-29', '30+'] })
  band!: string;

  @ApiProperty({ example: '7–13 days' })
  label!: string;

  @ApiProperty({ description: 'Inclusive lower bound of the gap, days' })
  minDays!: number;

  @ApiProperty({
    description: 'Exclusive upper bound, days; null for the open top band',
    nullable: true,
    type: Number,
  })
  maxDays!: number | null;
}

export class RetentionChangeDto {
  @ApiProperty({
    description:
      'Consecutive-slice pairs (k → k+1) in this band. Always travels',
  })
  pairs!: number;

  @ApiProperty({
    description: 'Distinct learners behind those pairs. Always travels',
  })
  learners!: number;

  @ApiProperty({
    description:
      'True when `pairs` ≥ `minPairs` AND `learners` ≥ `minLearners`. Below it every statistic here is null/false',
  })
  measurable!: boolean;

  @ApiProperty({
    description:
      'Mean change from slice k to k+1, taken over LEARNERS: each learner’s own pairs in the band are averaged first, so a learner with many short gaps counts once. Composite: points on the 1–4 scale (2 dp). Unhelpful: percentage points (1 dp), down is better. Null unless `measurable`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` over learners (deterministic); null unless `measurable`',
    nullable: true,
    type: [Number],
    example: [-0.21, 0.08],
  })
  ci!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose mean change is above zero' })
  up!: number;

  @ApiProperty({ description: 'Learners whose mean change is below zero' })
  down!: number;

  @ApiProperty({ description: 'Learners whose mean change is zero' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (3 dp); null unless `measurable`',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description: 'True only when `ci` excludes zero. False unless `measurable`',
  })
  detectable!: boolean;
}

export class RetentionBandDto extends RetentionBandDefDto {
  @ApiProperty({
    description:
      'True for the under-7-days band: the "no break" reference. Slice-to-slice change carries noise and any steady drift whatever the gap, so a longer-break band is read against this one, not against zero',
  })
  reference!: boolean;

  @ApiProperty({
    description:
      'Median gap of the band’s pairs, days (1 dp); null unless `composite.measurable`',
    nullable: true,
    type: Number,
  })
  medianGapDays!: number | null;

  @ApiProperty({
    type: RetentionChangeDto,
    description:
      'Composite (1–4) change from the slice before the gap to the one after',
  })
  composite!: RetentionChangeDto;

  @ApiProperty({
    type: RetentionChangeDto,
    description:
      'Change in "the slice shows any unhelpful or potentially harmful behaviour", percentage points; over the pairs where both slices were coded either way',
  })
  unhelpful!: RetentionChangeDto;
}

export class RetentionPairCountsDto {
  @ApiProperty({
    description:
      'Every pair of a learner’s consecutive SCORED slices, in slice order',
  })
  considered!: number;

  @ApiProperty({
    description:
      'Skipped: the next scored slice is not k+1 (one in between failed scoring or is pending)',
  })
  nonAdjacent!: number;

  @ApiProperty({
    description:
      'Not plotted: slice k+1 lies wholly inside sessions slice k already touched (one long roleplay spanning both) — no gap to measure',
  })
  sameSession!: number;

  @ApiProperty({
    description:
      'Not plotted: a session on either side has no start or end time',
  })
  missingTimes!: number;

  @ApiProperty({
    description:
      'Plotted pairs whose sessions overlapped (a session after the gap started before the last one before it ended): the gap is taken as 0 and the pair sits in the under-7-days band',
  })
  overlapping!: number;

  @ApiProperty({ description: 'Pairs placed in a band' })
  plotted!: number;
}

export class RetentionTakeawayDto {
  @ApiProperty({ description: 'The reference band key (`<7`)' })
  referenceBand!: string;

  @ApiProperty({
    description: 'The reference band’s composite change; null when withheld',
    nullable: true,
    type: Number,
  })
  referenceChange!: number | null;

  @ApiProperty({ nullable: true, type: [Number] })
  referenceCi!: [number, number] | null;

  @ApiProperty({ description: 'The long-break band key (`30+`)' })
  longBreakBand!: string;

  @ApiProperty({
    description:
      'The long-break band’s composite change; null when withheld. The two bands are different pairs (often different learners), so present both with their intervals — "after a 30+ day break learners come back X, against Y after a short gap" — rather than a subtracted difference, which has no interval here',
    nullable: true,
    type: Number,
  })
  longBreakChange!: number | null;

  @ApiProperty({ nullable: true, type: [Number] })
  longBreakCi!: [number, number] | null;
}

export class SkillRetentionResponseDto {
  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({ description: 'Learner speech per slice, in characters' })
  cutSizeLearnerChars!: number;

  @ApiProperty({
    description: 'The platform’s judged-score floor (echoed for the card)',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'A band’s statistics need at least this many pairs…',
  })
  minPairs!: number;

  @ApiProperty({ description: '…from at least this many distinct learners' })
  minLearners!: number;

  @ApiProperty({
    type: [RetentionBandDefDto],
    description:
      'The gap bands, in order. Gap = start of the first session in slice k+1 that is not in slice k − end of the last session of slice k',
  })
  bandDefs!: RetentionBandDefDto[];

  @ApiProperty({
    description: 'Distinct learners with at least one plotted pair',
  })
  learners!: number;

  @ApiProperty({ type: RetentionPairCountsDto })
  pairs!: RetentionPairCountsDto;

  @ApiProperty({
    type: [RetentionBandDto],
    description:
      'One entry per band, in band order, always all four. A learner can appear in several bands, so bands are not independent groups',
  })
  bands!: RetentionBandDto[];

  @ApiProperty({ type: RetentionTakeawayDto })
  takeaway!: RetentionTakeawayDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty mix by practice ordinal — AAQ-207
// ─────────────────────────────────────────────────────────────────────────────

export class DifficultyCountsDto {
  @ApiProperty() EASY!: number;
  @ApiProperty() MEDIUM!: number;
  @ApiProperty() HARD!: number;

  @ApiProperty({
    description:
      'No usable label: NULL, a value outside EASY/MEDIUM/HARD, or a scenario row that no longer exists',
  })
  untagged!: number;
}

export class DifficultySharesDto {
  @ApiProperty({ nullable: true, type: Number }) EASY!: number | null;
  @ApiProperty({ nullable: true, type: Number }) MEDIUM!: number | null;
  @ApiProperty({ nullable: true, type: Number }) HARD!: number | null;
  @ApiProperty({ nullable: true, type: Number }) untagged!: number | null;
}

export class PracticeProgressionCellDto {
  @ApiProperty({
    description:
      'Sessions at this ordinal — one per learner who reached it. Always travels',
  })
  sessions!: number;

  @ApiProperty({ type: DifficultyCountsDto })
  counts!: DifficultyCountsDto;

  @ApiProperty({
    type: DifficultySharesDto,
    description:
      'Percent of `sessions` (1 dp) at each label; all null below `minSampleSize` sessions',
  })
  shares!: DifficultySharesDto;
}

export class PracticeProgressionOrdinalDto extends PracticeProgressionCellDto {
  @ApiProperty({
    description:
      "1 = the learner's FIRST countable session (ordered by start time, creation time when it never started; id breaks ties)",
  })
  ordinal!: number;

  @ApiProperty({
    type: PracticeProgressionCellDto,
    description:
      'The SAME ordinal restricted to learners with at least `experiencedMinSessions` sessions — a fixed panel, the same people at every ordinal. The survivorship control: if only the all-comers mix drifts toward HARD, it is who kept practising, not people moving up',
  })
  experienced!: PracticeProgressionCellDto;
}

export class PracticeProgressionResponseDto {
  @ApiProperty({
    description: 'Ordinals returned: 1..this, always all of them',
  })
  maxOrdinal!: number;

  @ApiProperty({
    description:
      'Shares below this many sessions at an ordinal are withheld (null); counts travel',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Panel membership for `experienced`: sessions in total, at least',
  })
  experiencedMinSessions!: number;

  @ApiProperty({
    type: [String],
    example: ['EASY', 'MEDIUM', 'HARD', 'untagged'],
    description: 'Stack order for the bars',
  })
  levels!: string[];

  @ApiProperty({ description: 'Learners with at least one countable session' })
  learners!: number;

  @ApiProperty({ description: 'Learners in the `experienced` panel' })
  experiencedLearners!: number;

  @ApiProperty({ type: [PracticeProgressionOrdinalDto] })
  ordinals!: PracticeProgressionOrdinalDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    type: FoundationalSkillsProvenanceDto,
    description:
      'Difficulty is an AUTHORING label on the scenario (its current value), not a measured property, and the column defaults to MEDIUM — so MEDIUM includes scenarios nobody labelled',
  })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}
