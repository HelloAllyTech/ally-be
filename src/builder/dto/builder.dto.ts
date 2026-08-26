import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BuilderSessionStatus } from '../enum/builder.enum';
import {
  BUILDER_SLUG_MAX_LENGTH,
  BUILDER_TITLE_MAX_LENGTH,
} from '../constants/builder.constants';

/**
 * Structured answer for option-card questions. The FE also sends a
 * human-readable `message`; the orchestrator renders ids + custom values into
 * the persisted content so the agent acts on exact selections, and keeps the
 * raw payload in metadata for resume fidelity.
 */
export class BuilderAnswerDto {
  @ApiPropertyOptional({ type: [String], description: 'Selected option ids' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom free-text values the admin added',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customValues?: string[];

  @ApiPropertyOptional({ description: 'Admin chose "None of these"' })
  @IsOptional()
  @IsBoolean()
  none?: boolean;
}

export class CreateBuilderMessageDto {
  @ApiProperty({ description: "The admin's message for this turn" })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description: 'When answering an ask_admin question, the question id',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({ type: BuilderAnswerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuilderAnswerDto)
  answer?: BuilderAnswerDto;
}

export class CreateBuilderSessionDto {
  @ApiPropertyOptional({
    description:
      'Working title. Also seeds the branch slug, so it is worth being ' +
      'descriptive — the agent refines the title as the PRD takes shape.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_TITLE_MAX_LENGTH)
  title?: string;
}

export class UpdateBuilderSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Repos this build will touch',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repos?: string[];

  @ApiPropertyOptional({ description: 'Coding engine for build runs' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  engine?: string;

  @ApiPropertyOptional({ description: 'Model for build runs' })
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_SLUG_MAX_LENGTH)
  model?: string;
}

/** One RFC-6902 operation. Only add/replace/remove — see json-patch.util. */
export class BuilderPrdPatchOpDto {
  @ApiProperty({ enum: ['add', 'replace', 'remove'] })
  @IsIn(['add', 'replace', 'remove'])
  op!: 'add' | 'replace' | 'remove';

  @ApiProperty({ description: 'JSON Pointer into the PRD, e.g. "/problem"' })
  @IsString()
  path!: string;

  @ApiPropertyOptional({ description: 'Required for add/replace' })
  @IsOptional()
  value?: any;
}

export class PatchBuilderPrdDto {
  @ApiProperty({ type: [BuilderPrdPatchOpDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BuilderPrdPatchOpDto)
  ops!: BuilderPrdPatchOpDto[];

  @ApiPropertyOptional({ description: 'One line for the version history' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeSummary?: string;
}

export class StartBuilderBuildDto {
  @ApiPropertyOptional({
    description: 'Override the session engine for this run',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  engine?: string;

  @ApiPropertyOptional({
    description: 'Override the session model for this run',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @ApiPropertyOptional({
    description:
      'Spend ceiling for the session. Once reached, no further runs dispatch until it is raised.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetUsd?: number;
}

export class AnswerBuilderQuestionDto {
  @ApiProperty({
    description: 'Human-readable answer, as the agent will read it',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    type: BuilderAnswerDto,
    description: 'Structured payload for an option-card answer',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuilderAnswerDto)
  answer?: BuilderAnswerDto;
}

export class UpdateBuilderSettingsDto {
  @ApiPropertyOptional({
    description:
      'The kill switch. Off means no build will dispatch, whatever the feature toggle says.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Ceiling on concurrent builds' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxConcurrentBuilds?: number;

  @ApiPropertyOptional({
    description: 'Default per-session spend ceiling, USD',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultBudgetUsd?: number;
}

export class ListBuilderSessionsQueryDto {
  @ApiPropertyOptional({
    enum: BuilderSessionStatus,
    isArray: true,
    description: 'Filter to these statuses',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(BuilderSessionStatus, { each: true })
  @Type(() => String)
  status?: BuilderSessionStatus[];
}
