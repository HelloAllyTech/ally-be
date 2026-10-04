import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Foundational helping skills BENCHMARK — GET /v1/analytics/foundational-skills/benchmark.
 *
 * The same roleplay taken at onboarding and again after practice, scored whole
 * against the fixed rubric, compared within each learner. Holding the scenario
 * fixed is the point: cut-to-cut scores mix scenarios and cannot show
 * learning. Platform-wide unless `tenantId` narrows it to one org; test
 * organisations excluded, one rubric version per response. This shape is a
 * frontend contract.
 */

export class FoundationalSkillsBenchmarkQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Benchmark sessions are scoped ' +
      "by their own session's tenant, so both ends of a pair and the pending " +
      'count describe that org only; the flagged scenarios are listed whatever ' +
      'the org. Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class FoundationalSkillsBenchmarkScenarioDto {
  @ApiProperty({ description: 'scenarios.id, as a string' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'Sessions of this scenario scored under the current rubric version',
  })
  sessionsScored!: number;
}

export class FoundationalSkillsBenchmarkCoverageDto {
  @ApiProperty({ description: 'Benchmark sessions scored' })
  sessionsScored!: number;

  @ApiProperty({
    description:
      'Too little learner speech to score (`minLearnerChars`); never retried',
  })
  sessionsSkipped!: number;

  @ApiProperty({ description: 'Last attempt failed (retried up to 3 times)' })
  sessionsFailed!: number;

  @ApiProperty({
    description:
      'Completed and settled, not yet attempted (the scheduler scores a few per half hour)',
  })
  sessionsPending!: number;

  @ApiProperty({
    description:
      'Learners with at least one scored benchmark session (the paired set is drawn from these)',
  })
  learnersWithOne!: number;

  @ApiProperty({
    description:
      'Learners with a comparable first/latest pair (`minCutsBetween` apart)',
  })
  learnersPaired!: number;
}

export class FoundationalSkillsBenchmarkSummaryDto {
  @ApiProperty({
    description: 'Paired learners. Present whatever the averages do.',
  })
  learners!: number;

  @ApiProperty({
    description:
      "Paired learners' average composite (1–4) at their first session; null below `minSampleSize`",
    nullable: true,
    type: Number,
  })
  firstAvg!: number | null;

  @ApiProperty({
    description:
      'The same learners’ average at their latest session; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  latestAvg!: number | null;

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
    example: [0.05, 0.31],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose composite went up' })
  up!: number;

  @ApiProperty({ description: 'Learners whose composite went down' })
  down!: number;

  @ApiProperty({ description: 'Learners whose composite did not move' })
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

export class FoundationalSkillsBenchmarkSkillDto {
  @ApiProperty({ description: 'Stable skill key (e.g. `verbal`)' })
  skill!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description:
      'Paired learners for whom the skill was assessable in BOTH sessions (a skill with no opportunity is absent, not low)',
  })
  pairedLearners!: number;

  @ApiProperty({ nullable: true, type: Number })
  firstAvg!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  latestAvg!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  change!: number | null;

  @ApiProperty({ nullable: true, type: [Number] })
  changeCi!: [number, number] | null;

  @ApiProperty()
  detectable!: boolean;
}

export class FoundationalSkillsBenchmarkSessionRefDto {
  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ description: 'When the session ended (ISO 8601)' })
  endedAt!: string;

  @ApiProperty({
    description: 'Sealed 5,000-character cuts the learner had by then',
  })
  cutsBefore!: number;

  @ApiProperty({ description: 'Composite score, 1–4' })
  composite!: number;
}

export class FoundationalSkillsBenchmarkLearnerDto {
  @ApiProperty({ description: 'users.id' })
  id!: number;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Tenant of the latest session',
  })
  tenantId!: string | null;

  @ApiProperty({ description: 'The benchmark scenario compared (string id)' })
  scenarioId!: string;

  @ApiProperty({ type: FoundationalSkillsBenchmarkSessionRefDto })
  first!: FoundationalSkillsBenchmarkSessionRefDto;

  @ApiProperty({ type: FoundationalSkillsBenchmarkSessionRefDto })
  latest!: FoundationalSkillsBenchmarkSessionRefDto;

  @ApiProperty({ description: 'latest − first composite' })
  change!: number;
}

export class FoundationalSkillsBenchmarkResponseDto {
  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Averages, intervals and tests below this many learners are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({ type: [Number], example: [1, 4] })
  scoreDomain!: [number, number];

  @ApiProperty({
    description:
      'A session with less learner speech than this is SKIPPED, not scored',
  })
  minLearnerChars!: number;

  @ApiProperty({
    description:
      'A first/latest pair counts only when the latest came this many more cuts of practice after the first',
  })
  minCutsBetween!: number;

  @ApiProperty({
    type: [FoundationalSkillsBenchmarkScenarioDto],
    description:
      'Scenarios currently flagged as benchmarks; empty when none is (the response is still 200)',
  })
  scenarios!: FoundationalSkillsBenchmarkScenarioDto[];

  @ApiProperty({ type: FoundationalSkillsBenchmarkCoverageDto })
  coverage!: FoundationalSkillsBenchmarkCoverageDto;

  @ApiProperty({ type: FoundationalSkillsBenchmarkSummaryDto })
  summary!: FoundationalSkillsBenchmarkSummaryDto;

  @ApiProperty({ type: [FoundationalSkillsBenchmarkSkillDto] })
  skills!: FoundationalSkillsBenchmarkSkillDto[];

  @ApiProperty({
    type: [FoundationalSkillsBenchmarkLearnerDto],
    description:
      'Every paired learner, most recent retake first. No sample floor: individuals',
  })
  learners!: FoundationalSkillsBenchmarkLearnerDto[];

  @ApiProperty()
  computedAt!: string;
}
