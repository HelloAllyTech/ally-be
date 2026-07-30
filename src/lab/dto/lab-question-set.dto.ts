import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EvalQuestionDto } from './lab-eval.dto';
import { LabListQueryDto } from './lab-query.dto';

export class CreateQuestionSetDto {
  @ApiProperty({ description: 'Display name for the question set' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Short description of this set' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [EvalQuestionDto],
    description:
      'Initial questions (optional — a set can be created empty and filled in while still a draft)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvalQuestionDto)
  questions?: EvalQuestionDto[];
}

/** Draft-only: name/description/questions may all be edited until published. */
export class UpdateQuestionSetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [EvalQuestionDto],
    description: 'Full replacement of the question list',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvalQuestionDto)
  questions?: EvalQuestionDto[];
}

export class ArchiveQuestionSetDto {
  @ApiProperty({
    description: 'true to archive (hide from the run-publish picker), false to unarchive',
  })
  @IsBoolean()
  isArchived!: boolean;
}

export class ListQuestionSetsQueryDto extends LabListQueryDto {
  @ApiPropertyOptional({ description: 'Include archived sets', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Only return published, non-archived sets (used by the run-publish picker)',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  publishedOnly?: boolean = false;
}
