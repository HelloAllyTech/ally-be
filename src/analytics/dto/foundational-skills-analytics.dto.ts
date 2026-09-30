import { ApiProperty } from '@nestjs/swagger';

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
