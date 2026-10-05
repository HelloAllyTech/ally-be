import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Transfer to a new scenario — GET /v1/analytics/foundational-skills/transfer
 * (EFF-14, AAQ-220, Highlights → Helping skills).
 *
 * When a learner meets a scenario they have never played, do they bring their
 * helping skills with them? Per learner, on the foundational helping skills
 * composite (ruler R1, 1–4, one pinned rubric version): the composite of a cut
 * on a scenario they had ALREADY played, against the composite of the very
 * next single-scenario cut, on one they had NOT. Paired within the learner.
 *
 * ALL-TIME by construction and takes no window: the pairing is ordered by the
 * learner's own cut sequence, not a calendar, and a window would cut pairs in
 * half. Platform-wide unless `tenantId` narrows to one org; test organisations
 * always excluded. Floors are applied here — below `minSampleSize` learners
 * every average, interval and test is null while the counts travel. Read it
 * with the difficulty-mix chart (AAQ-207): a new scenario is often a harder
 * one. This shape is a frontend contract.
 */

export class FoundationalSkillsTransferQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code), by the tenant of the session ' +
      'each cut was cut from. A scenario the learner played in another org is ' +
      'not seen from here, so it can read as new. Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** A paired repeated → new comparison over learners, floor applied. */
export class FhsTransferComparisonDto {
  @ApiProperty({
    description:
      'Learners in the comparison (each with at least one pair). Present ' +
      'whatever the averages do.',
  })
  n!: number;

  @ApiProperty({
    description:
      'Mean, over learners, of each learner’s mean composite on the REPEATED ' +
      'scenario cuts that opened their pairs. Null below `minSampleSize`.',
    nullable: true,
    type: Number,
  })
  beforeAvg!: number | null;

  @ApiProperty({
    description:
      'The same learners’ mean composite on the NEW scenario cuts. Null below ' +
      '`minSampleSize`.',
    nullable: true,
    type: Number,
  })
  afterAvg!: number | null;

  @ApiProperty({
    description:
      'Mean own change (new − repeated), one value per learner (several pairs ' +
      'collapse to their mean first). Negative = lower on first contact with ' +
      'a new scenario. Null below `minSampleSize`. 2 dp.',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap CI of `change`, resampling learners (seeded, so it ' +
      'does not wobble on refresh). Null below `minSampleSize`.',
    nullable: true,
    type: [Number],
    example: [-0.21, 0.04],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners higher on the new scenario' })
  up!: number;

  @ApiProperty({ description: 'Learners lower on the new scenario' })
  down!: number;

  @ApiProperty({ description: 'Learners with no change' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (ties dropped). Null below ' +
      '`minSampleSize`.',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `changeCi` excludes zero. False reads "no detectable ' +
      'drop or gain on a new scenario", never "skills transfer fully".',
  })
  detectable!: boolean;
}

/** How the authoring difficulty moved across the pairs. */
export class FhsTransferDifficultyShiftDto {
  @ApiProperty({
    description:
      'Pairs whose new scenario is tagged harder (EASY < MEDIUM < HARD)',
  })
  harder!: number;

  @ApiProperty({ description: 'Pairs with the same difficulty tag on both' })
  same!: number;

  @ApiProperty({ description: 'Pairs whose new scenario is tagged easier' })
  easier!: number;

  @ApiProperty({
    description: 'Pairs where either scenario has no difficulty tag',
  })
  untagged!: number;
}

/** One learner on the paired slope chart (`BenchmarkSlope`). */
export class FhsTransferLearnerDto {
  @ApiProperty({ description: 'users.id. No name travels with this chart.' })
  learnerId!: number;

  @ApiProperty({
    description:
      'Mean composite (1–4) of this learner’s repeated-scenario cuts that ' +
      'opened a pair. 2 dp.',
  })
  before!: number;

  @ApiProperty({
    description:
      'Mean composite of the new-scenario cuts those pairs closed on. 2 dp.',
  })
  after!: number;

  @ApiProperty({
    description: 'after − before. Rows sort by this, biggest first.',
  })
  change!: number;

  @ApiProperty({ description: 'Repeated → new pairs behind this row' })
  pairs!: number;
}

export class FoundationalSkillsTransferResponseDto {
  @ApiProperty({
    description: 'The one rubric version every composite here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Learners a comparison needs before its averages, interval and test are ' +
      'stated (`MIN_SCORE_SAMPLE_SIZE`). Echoed so the client never keeps a ' +
      'second copy.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Scored single-scenario cuts a learner needs to take part ' +
      '(`TRANSFER_MIN_SINGLE_SCENARIO_CUTS`).',
    example: 3,
  })
  minSingleScenarioCuts!: number;

  @ApiProperty({
    type: [Number],
    example: [1, 4],
    description: 'Fixed composite axis',
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description: 'Learners in scope with at least one scored cut',
  })
  learnersMeasured!: number;

  @ApiProperty({
    description: 'Scored cuts in scope (the share’s denominator)',
  })
  scoredCuts!: number;

  @ApiProperty({
    description:
      'Of those, cuts in which every session played one scenario — the only ' +
      'cuts this chart compares.',
  })
  singleScenarioCuts!: number;

  @ApiProperty({
    description:
      'singleScenarioCuts / scoredCuts (%), 1 dp. Shown on the card: the ' +
      'chart reads only this share of practice. Null with no scored cuts.',
    nullable: true,
    type: Number,
  })
  singleScenarioSharePct!: number | null;

  @ApiProperty({
    description:
      'Learners with at least `minSingleScenarioCuts` scored single-scenario cuts',
  })
  learnersEligible!: number;

  @ApiProperty({
    description:
      'Of those, learners with at least one repeated → new pair — the n of ' +
      '`comparison`.',
  })
  learnersWithPair!: number;

  @ApiProperty({
    description:
      'Repeated → new pairs across those learners. A pair is a scored ' +
      'single-scenario cut on a scenario played in no earlier cut (single or ' +
      'mixed, scored or not), immediately preceded among the learner’s ' +
      'single-scenario cuts by a scored cut on a scenario they HAD played ' +
      'before it.',
  })
  pairs!: number;

  @ApiProperty({
    description:
      'The headline: repeated → new composite, paired within each learner and ' +
      'collapsed to one value per learner.',
    type: () => FhsTransferComparisonDto,
  })
  comparison!: FhsTransferComparisonDto;

  @ApiProperty({
    description:
      'The same comparison over pairs whose two scenarios carry the SAME ' +
      'authoring difficulty — the check that a drop is not just harder ' +
      'material. Usually thinner; same floor.',
    type: () => FhsTransferComparisonDto,
  })
  sameDifficulty!: FhsTransferComparisonDto;

  @ApiProperty({
    description:
      'Pairs by how the scenario difficulty tag moved, repeated → new. ' +
      'Counts of pairs, always present.',
    type: () => FhsTransferDifficultyShiftDto,
  })
  difficultyShift!: FhsTransferDifficultyShiftDto;

  @ApiProperty({
    description:
      'One row per paired learner for the slope chart, sorted by own change. ' +
      'Null below `minSampleSize` paired learners: individuals are only drawn ' +
      'once the group is big enough to read as a pattern.',
    nullable: true,
    type: [FhsTransferLearnerDto],
  })
  learners!: FhsTransferLearnerDto[] | null;

  @ApiProperty({
    description:
      'Ruler (R1) and the caveat: new scenarios are often harder (read with ' +
      'AAQ-207), and familiar material reads higher than first contact even ' +
      'when skill transfers, so a drop here can be difficulty or novelty, not ' +
      'lost skill. Observational: associated with, never caused by.',
    type: () => FoundationalSkillsProvenanceDto,
  })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to. Nothing stays platform-wide: every ' +
      'cut carries the tenant of its session.',
    type: () => AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
