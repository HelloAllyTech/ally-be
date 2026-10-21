import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * What a runner sends back.
 *
 * Validation here is deliberately loose on payload *shapes* and strict on
 * envelopes. The bodies are written by a model mid-run; rejecting a whole
 * batch because one event's payload had an unexpected key would lose the
 * other nineteen, and the runner has no way to ask what it did wrong.
 */

export class BuilderEventDto {
  @ApiProperty({ description: 'Event type; unknown values degrade to text' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiPropertyOptional({ description: 'Stage in force when this happened' })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export class IngestBuilderEventsDto {
  @ApiProperty({ type: [BuilderEventDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BuilderEventDto)
  events!: BuilderEventDto[];
}

export class RecordBuilderRunCostDto {
  @ApiPropertyOptional({
    description:
      'Which engine invocation this bills (plan, code-1, verify-2, finalise, …). ' +
      'Upserted by key, so re-reporting a phase replaces it rather than double counting. ' +
      'Omitted means the legacy single-invocation shape and lands as "build".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phase?: string;

  @ApiPropertyOptional({ description: 'Model that ran this phase' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @ApiPropertyOptional({ type: Object, description: 'Per-model token usage' })
  @IsOptional()
  @IsObject()
  modelUsage?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalCostUsd?: number;

  @ApiPropertyOptional({
    description:
      'Wall clock of this engine invocation, in ms. With durationApiMs this is ' +
      'what makes a slow run diagnosable: the difference between them is time ' +
      'spent inside tool calls rather than waiting on the model.',
  })
  @IsOptional()
  @IsNumber()
  durationMs?: number;

  @ApiPropertyOptional({
    description:
      'Of the wall clock, the part spent waiting on the model, in ms',
  })
  @IsOptional()
  @IsNumber()
  durationApiMs?: number;

  @ApiPropertyOptional({ description: 'Agent turns this invocation took' })
  @IsOptional()
  @IsNumber()
  numTurns?: number;
}

export class BuilderReviewFindingDto {
  @ApiPropertyOptional({
    description:
      'A short stable slug for this finding. Used to key the feedback row, ' +
      'so a retried report does not double-record. Falls back to the index.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  key?: string;

  @ApiProperty({
    description: 'The defect and the concrete scenario in which it misbehaves',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000)
  body!: string;

  @ApiPropertyOptional({ description: 'Repo-relative file the finding is in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @ApiPropertyOptional({ description: '1-indexed line the finding anchors to' })
  @IsOptional()
  @IsNumber()
  line?: number;
}

export class RecordBuilderReviewFindingsDto {
  @ApiProperty({
    description: 'The builder_pull_requests row that was reviewed',
  })
  @IsString()
  @IsNotEmpty()
  pullRequestId!: string;

  /**
   * Empty is a real answer, not a missing one: a clean review reports `[]`, and
   * that is the result an approval would rest on. Optional only so a runner
   * that omits the key entirely is treated the same way rather than 400ing.
   */
  @ApiProperty({ type: [BuilderReviewFindingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderReviewFindingDto)
  findings?: BuilderReviewFindingDto[];
}

export class CompleteBuilderRunDto {
  @ApiProperty({ enum: ['done', 'failed'] })
  @IsIn(['done', 'failed'])
  outcome!: 'done' | 'failed';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  error?: string;
}

export class UpsertBuilderRepoMapDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  repo!: string;

  @ApiProperty({ description: 'The condensed repo map, markdown' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  mapMd!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  commitSha?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  stats?: Record<string, any>;
}

export class UpsertBuilderRepoCatalogDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  repo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commitSha?: string;

  /**
   * Loose on each entry's shape, like the event DTOs: the extractor is ours,
   * and the service keeps only the declared keys. Bounded on count, so a
   * runaway extraction cannot write an unbounded row.
   */
  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(20_000)
  entries!: Record<string, any>[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  stats?: Record<string, any>;
}

/* ── Technical design ───────────────────────────────────────────────────── */

/*
 * Strict on shape, unlike the event DTOs above. The `design` tool is the
 * designer's only output and it calls it as many times as it likes, so a
 * refusal costs one more call rather than lost work — and a design stored in
 * the wrong shape would be approved, then fail the build's scope check.
 */

export class BuilderDesignScopeDto {
  @ApiProperty({ description: 'A Builder repo name, e.g. ally-be' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  repo!: string;

  @ApiProperty({
    type: [String],
    description: 'Repo-relative paths or globs the build may change',
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  files!: string[];
}

export class BuilderDesignContractDto {
  @ApiProperty({ description: 'The field, enum, table or API it names' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name!: string;

  @ApiProperty({ description: 'What changes about it' })
  @IsString()
  @MaxLength(4_000)
  change!: string;

  @ApiProperty({
    type: [String],
    description: 'Every reader, as "repo:path:line"',
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  readers!: string[];
}

export class BuilderDesignTestDto {
  @ApiProperty({ description: 'The PRD requirement id, e.g. R1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  requirementId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  repo!: string;

  @ApiProperty({ description: 'Repo-relative test file' })
  @IsString()
  @MaxLength(500)
  file!: string;

  @ApiProperty({ description: 'The observable behaviour the test asserts' })
  @IsString()
  @MaxLength(2_000)
  asserts!: string;
}

export class SubmitBuilderDesignDto {
  @ApiProperty({ description: 'The design itself, markdown' })
  @IsString()
  @MaxLength(60_000)
  designMd!: string;

  @ApiProperty({ type: [BuilderDesignScopeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderDesignScopeDto)
  scope!: BuilderDesignScopeDto[];

  @ApiProperty({ type: [BuilderDesignContractDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderDesignContractDto)
  contracts!: BuilderDesignContractDto[];

  @ApiProperty({ description: 'How released clients keep working' })
  @IsString()
  @MaxLength(20_000)
  compatibilityMd!: string;

  @ApiProperty({ type: [BuilderDesignTestDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderDesignTestDto)
  testMap!: BuilderDesignTestDto[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2_000, { each: true })
  openDecisions!: string[];
}

export class SubmitBuilderDesignReviewDto {
  /** Ignored when `defects` is sent: the verdict is derived from it. */
  @ApiPropertyOptional({ enum: ['pass', 'concerns'] })
  @IsOptional()
  @IsIn(['pass', 'concerns'])
  verdict?: 'pass' | 'concerns';

  @ApiPropertyOptional({
    description: 'Anything else worth a person reading, markdown',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30_000)
  notesMd?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'What would make the build wrong or a released client break',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(4_000, { each: true })
  defects?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Scope the design could widen to — not defects',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(4_000, { each: true })
  suggestions?: string[];
}

/**
 * What an opencode run or a review spent, reported by the Builder workflows
 * after it finishes (scripts/builder/opencode-usage.py). Attributed to a run
 * by `runId`, or to a pull request by `repo` + `prNumber`.
 */
export class RecordBuilderUsageDto {
  @IsIn(['build', 'fix', 'review'])
  kind!: 'build' | 'fix' | 'review';

  @IsString()
  repo!: string;

  @IsOptional()
  @IsNumber()
  prNumber?: number | null;

  @IsOptional()
  @IsString()
  runId?: string | null;

  @IsNumber()
  @Min(0)
  costUsd!: number;

  @IsOptional()
  @IsNumber()
  inputTokens?: number;

  @IsOptional()
  @IsNumber()
  outputTokens?: number;

  @IsOptional()
  @IsNumber()
  cacheReadTokens?: number;

  @IsOptional()
  @IsNumber()
  cacheWriteTokens?: number;

  @IsOptional()
  @IsObject()
  models?: Record<string, number>;
}
