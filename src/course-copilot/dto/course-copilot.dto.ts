import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CourseBlueprint } from '../type/course-copilot.type';

export class CreateCourseCopilotSessionDto {
  @ApiPropertyOptional({
    description:
      'Open the copilot on an existing course (EDIT mode). Resumes the caller’s session for that course if one exists.',
  })
  @IsOptional()
  @IsUUID()
  trackId?: string;
}

/** Structured answer to a question card — same contract as Builder / the character interview. */
export class CourseCopilotAnswerDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  selectedOptionIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  customValues?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  none?: boolean;
}

export class CreateCourseCopilotMessageDto {
  @ApiProperty({ description: "The trainer's message for this turn" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  message!: string;

  @ApiPropertyOptional({ description: 'The question this message answers' })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({ type: CourseCopilotAnswerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CourseCopilotAnswerDto)
  answer?: CourseCopilotAnswerDto;
}

export class UpdateCourseCopilotBlueprintDto {
  @ApiProperty({ description: 'The whole blueprint, as edited in the tree' })
  @IsObject()
  blueprint!: CourseBlueprint;

  @ApiProperty({
    description: 'The blueprint version the edit was made against',
  })
  @IsInt()
  @Min(0)
  version!: number;
}

export class ApproveCourseCopilotBlueprintDto {
  @ApiProperty({ description: 'The blueprint version being approved' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class RetryCourseCopilotBuildDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Jobs to retry; omit for every failed or skipped job',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  jobIds?: string[];
}

export class RaiseCourseCopilotBudgetDto {
  @ApiProperty({ description: 'New ceiling in USD; 0 removes the cap' })
  @IsNumber()
  @Min(0)
  budgetUsd!: number;
}
