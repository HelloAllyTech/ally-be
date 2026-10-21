import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BuilderEvalChecklistItemDto {
  @ApiPropertyOptional({ description: '"C1"… — generated when absent' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  id?: string;

  @ApiProperty({
    description: 'What a correct PRD says (or must not say), in plain words',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  text!: string;

  @ApiProperty({ enum: ['must', 'must_not'] })
  @IsIn(['must', 'must_not'])
  kind!: 'must' | 'must_not';
}

class FixtureCutDto {
  @ApiProperty({
    description: 'Unique; says which failure the fixture reproduces',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: [BuilderEvalChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => BuilderEvalChecklistItemDto)
  checklist?: BuilderEvalChecklistItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Repo → commit the session ran against; file reads in the replay pin to these',
  })
  @IsOptional()
  @IsObject()
  pins?: Record<string, string>;
}

export class CreateEvalFixtureFromSessionDto extends FixtureCutDto {}

export class CreateEvalFixtureFromExportDto extends FixtureCutDto {
  @ApiProperty({
    description:
      'A session as GET /v1/builder/sessions/:id returns it: { id, title, messages, prd }',
  })
  @IsObject()
  session!: Record<string, any>;
}

export class CreateEvalFixtureDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ['interview', 'prd_review'] })
  @IsIn(['interview', 'prd_review'])
  kind!: 'interview' | 'prd_review';

  @ApiProperty({
    description: 'BuilderEvalInterviewPayload or BuilderEvalPrdReviewPayload',
  })
  @IsObject()
  payload!: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEvalFixtureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: [BuilderEvalChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => BuilderEvalChecklistItemDto)
  checklist?: BuilderEvalChecklistItemDto[];

  @ApiPropertyOptional({ description: 'Replace the whole payload' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export class ImportEvalFixturesDto {
  @ApiProperty({ description: 'The `fixtures` array of an export' })
  @IsArray()
  @ArrayMaxSize(200)
  fixtures!: Record<string, any>[];
}

export class StartEvalSuiteDto {
  @ApiPropertyOptional({ description: 'Defaults to every active fixture' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  fixtureIds?: string[];

  @ApiPropertyOptional({ description: 'Runs per fixture, 1–10; default 3' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  repetitions?: number;

  @ApiPropertyOptional({
    description:
      'Replay with validated interview turns on or off; defaults to the live ' +
      'builder_settings.validatedTurns. For comparing the two loops.',
  })
  @IsOptional()
  @IsBoolean()
  validatedTurns?: boolean;

  @ApiPropertyOptional({
    description:
      'Replay with the interview protocol (discovery sweep, situation brief, question ' +
      'gate) on or off; defaults to the live builder_settings.situationBrief. Only has ' +
      'an effect with validated turns.',
  })
  @IsOptional()
  @IsBoolean()
  situationBrief?: boolean;
}

export class SubmitPromptCandidateDto extends StartEvalSuiteDto {
  @ApiProperty({ example: 'builder_interviewer_system' })
  @IsString()
  @IsNotEmpty()
  promptCode!: string;

  @ApiPropertyOptional({ description: 'The new prompt text' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @ApiPropertyOptional({ description: 'Empty string clears the override' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Empty string clears the override' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
