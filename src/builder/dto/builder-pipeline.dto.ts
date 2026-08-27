import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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

export class RecordBuilderQuestionsDto {
  @ApiProperty({
    type: [Object],
    description: 'Questions in the shape the interview widget renders',
  })
  @IsArray()
  @ArrayNotEmpty()
  questions!: Record<string, any>[];

  @ApiPropertyOptional({
    type: Object,
    description:
      'Branches holding the work in progress, as { repo: branch }. Without these a resume has nowhere to pick up from.',
  })
  @IsOptional()
  @IsObject()
  branches?: Record<string, string>;
}

export class BuilderPullRequestDto {
  @ApiProperty()
  @IsString()
  repo!: string;

  @ApiProperty()
  @IsString()
  branch!: string;

  @ApiProperty()
  @IsNumber()
  prNumber!: number;

  @ApiProperty()
  @IsString()
  prUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;
}

export class RecordBuilderPrsDto {
  @ApiProperty({ type: [BuilderPullRequestDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderPullRequestDto)
  pullRequests!: BuilderPullRequestDto[];
}

export class RecordBuilderReportDto {
  @ApiPropertyOptional({ enum: ['run_report', 'retrospective'] })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: 'Markdown; rendered in the session Reports tab' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  contentMd!: string;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Files changed, tests added, stage durations — and a `retrospective` array whose bullets become builder_lessons.',
  })
  @IsOptional()
  @IsObject()
  metrics?: Record<string, any>;
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
}

export class BuilderFeedbackOutcomeDto {
  @ApiProperty({ description: 'The builder_pr_feedback row this is about' })
  @IsString()
  @IsNotEmpty()
  feedbackId!: string;

  @ApiPropertyOptional({
    enum: ['addressed', 'dismissed'],
    description:
      'addressed = changed the code; dismissed = replied explaining why not. Anything else is treated as addressed.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Where Builder replied on the PR' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  replyUrl?: string;
}

export class RecordBuilderFeedbackOutcomesDto {
  @ApiProperty({ type: [BuilderFeedbackOutcomeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderFeedbackOutcomeDto)
  outcomes!: BuilderFeedbackOutcomeDto[];
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
