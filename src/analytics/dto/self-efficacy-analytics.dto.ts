import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';

/**
 * Highlights → Quality & sentiment: learner confidence, set against the judge.
 * GET /v1/analytics/foundational-skills/self-efficacy.
 *
 *  - EFF-71 (AAQ-230) `confidence` — each learner's self-rated confidence
 *    (0–10) on their FIRST vs LATEST answer to the self-efficacy instrument,
 *    per tier (and per skill for the expanded view), beside the judge's level
 *    (1–4) for the same learners at the cuts nearest those two answers.
 *  - EFF-72 (AAQ-231) `calibration` — each self-rating against the judged
 *    level of the learner's nearest scored cut where that skill was
 *    assessable: over-confident / calibrated / under-confident, per skill.
 *
 * ALL-TIME by construction (first vs latest is a lifetime property of a
 * person) and takes no date window. Platform-wide unless `tenantId` narrows
 * it; test organisations excluded; one instrument version and one rubric
 * version (ruler R1) per response. Floors are applied on the server: below
 * `minSampleSize` learners an average, change, share or correlation is null
 * while its count still travels — a null is a decision to withhold, never
 * "zero". With no answers at all every count is 0 and every number null: the
 * cards read "not yet measured". This shape is a frontend contract.
 *
 * **Never report the self-rating alone as an outcome.** Learners are poor,
 * often over-confident self-assessors, and those who perform least well
 * self-assess least well; every confidence number here travels beside the
 * judge's number for the same people. And the judge itself is not yet checked
 * against human raters.
 */

export class SelfEfficacyQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Answers by the org the learner was in when they answered; the judged cuts they are matched to by the org of the session each cut closed in (as Helping skills). Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class SelfEfficacyScopingDto {
  @ApiProperty({
    description:
      'Tenant the response was narrowed to; null = every non-test org',
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({
    description:
      'How the org filter reaches answers and cuts (they are attributed to an org differently)',
  })
  note!: string;
}

/** A paired before/after comparison, with the floor applied (same shape as course impact). */
export class SelfEfficacyComparisonDto {
  @ApiProperty({
    description: 'Learners in the comparison. Present whatever the averages do',
  })
  n!: number;

  @ApiProperty({
    description: 'Their average on the first side; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  beforeAvg!: number | null;

  @ApiProperty({
    description:
      'The same learners’ average on the second side; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  afterAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own change (latest − first); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` (deterministic); null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [0.4, 1.6],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners who went up' })
  up!: number;

  @ApiProperty({ description: 'Learners who went down' })
  down!: number;

  @ApiProperty({ description: 'Learners who did not move' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (ties dropped); null below `minSampleSize` or with nothing to test',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `changeCi` excludes zero. Always false below `minSampleSize`',
  })
  detectable!: boolean;
}

/** Fields shared by a tier row and a skill row of EFF-71. */
export class SelfEfficacyChangeRowDto {
  @ApiProperty({
    description:
      'Learners paired: their first and latest answers both rated at least one of the same items in this row',
  })
  learners!: number;

  @ApiProperty({
    type: SelfEfficacyComparisonDto,
    description:
      'Self-rated confidence (0–10), first vs latest answer, over the items rated BOTH times (the same questions revisited, so a skipped item cannot move it). Never shown without `judge`',
  })
  self!: SelfEfficacyComparisonDto;

  @ApiProperty({
    type: SelfEfficacyComparisonDto,
    description:
      'The same self-rating restricted to the learners and skills `judge` covers, so the two can be read side by side on the same people',
  })
  selfMatched!: SelfEfficacyComparisonDto;

  @ApiProperty({
    type: SelfEfficacyComparisonDto,
    description:
      'The judge’s level (1–4) for the same learners: the scored cut nearest the first answer vs the one nearest the latest (each within `thresholds.matchWindowDays`, two different cuts), over the skills assessable in both. A learner with no such pair of cuts drops out of this side only',
  })
  judge!: SelfEfficacyComparisonDto;

  @ApiProperty({
    description:
      'Median days between the paired learners’ first and latest answers; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  medianDaysApart!: number | null;
}

export class SelfEfficacyTierChangeDto extends SelfEfficacyChangeRowDto {
  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;

  @ApiProperty({ description: 'Display label', example: 'Engage' })
  label!: string;

  @ApiProperty({
    type: [String],
    description: 'Rubric skill keys in the tier (the items rolled up)',
  })
  skills!: string[];
}

export class SelfEfficacySkillChangeDto extends SelfEfficacyChangeRowDto {
  @ApiProperty({ description: 'Rubric skill key' })
  skill!: string;

  @ApiProperty({ description: 'The rubric’s name for the skill' })
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;
}

/** EFF-71 · AAQ-230. */
export class SelfEfficacyConfidenceDto {
  @ApiProperty({
    description:
      'Learners with two or more answered (not dismissed) answers — the most who could be paired',
  })
  learnersWithTwoOrMore!: number;

  @ApiProperty({ type: [Number], example: [0, 10] })
  selfDomain!: [number, number];

  @ApiProperty({ type: [Number], example: [1, 4] })
  levelDomain!: [number, number];

  @ApiProperty({
    type: [SelfEfficacyTierChangeDto],
    description:
      'Engage, Understand, Support — always all three, in that order',
  })
  tiers!: SelfEfficacyTierChangeDto[];

  @ApiProperty({
    type: [SelfEfficacySkillChangeDto],
    description: 'Every instrument item, in rubric order (the expanded view)',
  })
  skills!: SelfEfficacySkillChangeDto[];
}

/** Calibration over one point per learner (their latest matched answer). */
export class SelfEfficacyCalibrationStatsDto {
  @ApiProperty({
    description:
      'Learners classified — one point each, their LATEST answer that could be matched to a judged cut',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Matched (answer, skill) observations behind it, every answer counted — more than `learners` when people answered more than once',
  })
  observations!: number;

  @ApiProperty({
    description:
      'Rescaled self-rating more than `thresholds.band` above the level',
  })
  overConfident!: number;

  @ApiProperty({ description: 'Within ±`thresholds.band` of the level' })
  calibrated!: number;

  @ApiProperty({
    description:
      'Rescaled self-rating more than `thresholds.band` below the level',
  })
  underConfident!: number;

  @ApiProperty({
    description: '% of `learners` over-confident; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  overConfidentPct!: number | null;

  @ApiProperty({
    description: '% of `learners` calibrated; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  calibratedPct!: number | null;

  @ApiProperty({
    description: '% of `learners` under-confident; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  underConfidentPct!: number | null;

  @ApiProperty({
    description:
      'Mean gap, rescaled self − level, in rubric levels (positive = over-confident); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  meanGap!: number | null;

  @ApiProperty({
    description:
      '95% bootstrap interval of `meanGap` (deterministic, over learners); null below `minSampleSize`',
    nullable: true,
    type: [Number],
  })
  meanGapCi!: [number, number] | null;

  @ApiProperty({
    description:
      'Spearman rank correlation of self-rating with level (average ranks for ties) over the same points; null below `minSpearmanPoints` or when either side does not vary. Near 0 = confidence says little about competence',
    nullable: true,
    type: Number,
  })
  spearmanR!: number | null;
}

export class SelfEfficacyCalibrationSkillDto extends SelfEfficacyCalibrationStatsDto {
  @ApiProperty({ description: 'Rubric skill key' })
  skill!: string;

  @ApiProperty({ description: 'The rubric’s name for the skill' })
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;
}

export class SelfEfficacyPointDto {
  @ApiProperty({ description: 'Rubric skill key' })
  skill!: string;

  @ApiProperty({ description: 'Self-rating as answered, integer 0–10' })
  selfRating!: number;

  @ApiProperty({ description: 'Judged level of the matched cut, integer 1–4' })
  level!: number;
}

/**
 * Over-confidence on assessing harm is the one that matters for safety: a
 * helper sure they handle risk well who the judge says does not. INTERNAL —
 * derived from unaudited judge coding; share only privately with partners.
 */
export class SelfEfficacySafetyFlagDto {
  @ApiProperty({ example: 'harm' })
  skill!: string;

  @ApiProperty({ description: 'The rubric’s name for the skill' })
  name!: string;

  @ApiProperty({ description: 'Learners classified on this skill' })
  learners!: number;

  @ApiProperty({ description: 'Of them, over-confident' })
  overConfident!: number;

  @ApiProperty({
    description: '% over-confident; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  overConfidentPct!: number | null;

  @ApiProperty({
    description: 'Always true: never shown outside the admin console',
  })
  internal!: boolean;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

export class SelfEfficacyThresholdsDto {
  @ApiProperty({
    description:
      'How a 0–10 self-rating is put on the rubric’s 1–4 scale before comparing',
    example: '1 + 3·r/10',
  })
  rescale!: string;

  @ApiProperty({
    description:
      'Calibration band in rubric levels: over-confident above +band, under-confident below −band',
    example: 0.75,
  })
  band!: number;

  @ApiProperty({
    description:
      'An answer is matched only to a cut that closed within this many days of it, either side',
    example: 30,
  })
  matchWindowDays!: number;
}

/** EFF-72 · AAQ-231. */
export class SelfEfficacyCalibrationDto {
  @ApiProperty({ type: SelfEfficacyThresholdsDto })
  thresholds!: SelfEfficacyThresholdsDto;

  @ApiProperty({
    type: [SelfEfficacyCalibrationSkillDto],
    description: 'Every instrument item, in rubric order',
  })
  skills!: SelfEfficacyCalibrationSkillDto[];

  @ApiProperty({
    type: SelfEfficacyCalibrationStatsDto,
    description:
      'All skills pooled: each learner’s latest matched answer as its mean rescaled self-rating vs the mean level over its matched skills (Spearman on the 0–10 mean)',
  })
  overall!: SelfEfficacyCalibrationStatsDto;

  @ApiProperty({
    type: [SelfEfficacyPointDto],
    description:
      'Scatter points, one per matched (answer, skill), most recent first, capped at `pointCap`; only for skills whose `learners` clears `minSampleSize` (below it the shares are withheld, and so are the dots). No learner ids — jittering is the client’s',
  })
  points!: SelfEfficacyPointDto[];

  @ApiProperty({ description: 'Matched observations across every skill' })
  pointsTotal!: number;

  @ApiProperty({ description: 'True when `points` was cut at `pointCap`' })
  pointsTruncated!: boolean;

  @ApiProperty({ example: 2000 })
  pointCap!: number;

  @ApiProperty({ type: SelfEfficacySafetyFlagDto })
  safetyFlag!: SelfEfficacySafetyFlagDto;
}

export class SelfEfficacyTriggerCountsDto {
  @ApiProperty({ description: 'First answers (the baseline)' })
  ONBOARDING!: number;

  @ApiProperty({ description: 'Asked after 3 more scored cuts' })
  CUTS!: number;

  @ApiProperty({ description: 'Asked after a course was completed' })
  COURSE!: number;
}

export class SelfEfficacyCoverageDto {
  @ApiProperty({
    description:
      'Learners who were shown the instrument and answered or dismissed it at least once',
  })
  learnersAsked!: number;

  @ApiProperty({ description: 'Learners who rated at least one item' })
  learnersAnswered!: number;

  @ApiProperty({
    description:
      'Learners with two or more answered answers (EFF-71’s ceiling)',
  })
  learnersWithTwoOrMore!: number;

  @ApiProperty({ description: 'Stored answers, dismissals included' })
  responses!: number;

  @ApiProperty({ description: 'Answers with at least one item rated' })
  answeredResponses!: number;

  @ApiProperty({
    description: 'Answers with every item skipped (prompt dismissed)',
  })
  dismissedResponses!: number;

  @ApiProperty({
    type: SelfEfficacyTriggerCountsDto,
    description: 'Stored answers by why they were asked',
  })
  byTrigger!: SelfEfficacyTriggerCountsDto;

  @ApiProperty({ description: 'Items rated across every answer' })
  itemsAnswered!: number;

  @ApiProperty({
    description:
      'Rated items matched to a judged cut within the window (EFF-72’s observations)',
  })
  matchedObservations!: number;

  @ApiProperty({
    description:
      'Rated items with no cut assessing that skill within the window — practice too far away, or no opportunity for the skill',
  })
  unmatchedObservations!: number;
}

export class SelfEfficacyResponseDto {
  @ApiProperty({
    description: 'The one instrument version every answer here comes from',
    example: 'v1',
  })
  instrumentVersion!: string;

  @ApiProperty({
    description: 'The one rubric version every judged level here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Averages, changes, shares and intervals below this many learners are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'Spearman’s r is withheld below this many points',
  })
  minSpearmanPoints!: number;

  @ApiProperty({ type: SelfEfficacyCoverageDto })
  coverage!: SelfEfficacyCoverageDto;

  @ApiProperty({ type: SelfEfficacyConfidenceDto })
  confidence!: SelfEfficacyConfidenceDto;

  @ApiProperty({ type: SelfEfficacyCalibrationDto })
  calibration!: SelfEfficacyCalibrationDto;

  @ApiProperty({
    description:
      'Self-assessment caveat the cards must carry: poor, often over-confident self-assessors; triangulated with the judge, never an outcome alone; the judge not yet checked against human raters',
  })
  caveat!: string;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: SelfEfficacyScopingDto })
  scoping!: SelfEfficacyScopingDto;

  @ApiProperty({ description: 'ISO time the response was computed' })
  computedAt!: string;
}
