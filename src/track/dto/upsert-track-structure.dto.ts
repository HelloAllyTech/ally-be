import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { TrackItemType } from '../type/track.type';

export class UpsertTrackItemCompletionCriteriaDto {
  @ApiPropertyOptional({ description: 'Minimum score (ROLEPLAY/CASE)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minScore?: number;

  @ApiPropertyOptional({ description: 'Minimum call duration s (ROLEPLAY)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minDurationSeconds?: number;

  @ApiPropertyOptional({ description: 'Pass score percent (QUIZ)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passScore?: number;

  @ApiPropertyOptional({ description: 'Required watch percent (VIDEO)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  watchPct?: number;

  @ApiPropertyOptional({ description: 'Minimum read seconds (ARTICLE)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minReadSeconds?: number;
}

export class BreathingExerciseContentDto {
  @ApiProperty({ description: 'Duration of inhale phase (seconds)' })
  @IsNumber()
  @IsPositive()
  inhale!: number;

  @ApiProperty({ description: 'Duration of hold phase after inhale (seconds)' })
  @IsNumber()
  @IsPositive()
  holdIn!: number;

  @ApiProperty({ description: 'Duration of exhale phase (seconds)' })
  @IsNumber()
  @IsPositive()
  exhale!: number;

  @ApiProperty({ description: 'Duration of hold phase after exhale (seconds)' })
  @IsNumber()
  @IsPositive()
  holdOut!: number;

  @ApiProperty({ description: 'Total number of breathing cycles' })
  @IsInt()
  @Min(1)
  cycles!: number;

  @ApiProperty({ description: 'Instructional text for inhale phase' })
  @IsString()
  @IsNotEmpty()
  inhaleText!: string;

  @ApiProperty({ description: 'Instructional text for hold after inhale' })
  @IsString()
  @IsNotEmpty()
  holdInText!: string;

  @ApiProperty({ description: 'Instructional text for exhale phase' })
  @IsString()
  @IsNotEmpty()
  exhaleText!: string;

  @ApiProperty({ description: 'Instructional text for hold after exhale' })
  @IsString()
  @IsNotEmpty()
  holdOutText!: string;
}

export class UpsertTrackItemDto {
  @ApiPropertyOptional({
    description: 'Existing item id (omit to create a new item)',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ enum: TrackItemType })
  @IsEnum(TrackItemType)
  type!: TrackItemType;

  @ApiProperty({ description: 'Order within the section (1-indexed)' })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Scenario id (type=ROLEPLAY)' })
  @IsOptional()
  @IsInt()
  scenarioId?: number;

  @ApiPropertyOptional({ description: 'Case id (type=CASE)' })
  @IsOptional()
  @IsUUID('4')
  caseId?: string;

  @ApiPropertyOptional({
    description:
      'Inline content JSONB for QUIZ/ARTICLE/VIDEO/JOURNAL items; validated per type in the service layer',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, any>;

  @ApiPropertyOptional({ type: UpsertTrackItemCompletionCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertTrackItemCompletionCriteriaDto)
  completionCriteria?: UpsertTrackItemCompletionCriteriaDto;

  @ApiPropertyOptional({
    description:
      'Learners who can open the item can discuss it beneath the content. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  hasDiscussion?: boolean;
}

export class UpsertTrackSectionDto {
  @ApiPropertyOptional({
    description: 'Existing section id (omit to create a new section)',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Order within the track (1-indexed)' })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty({ type: [UpsertTrackItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertTrackItemDto)
  items!: UpsertTrackItemDto[];
}

export class UpsertTrackStructureDto {
  @ApiProperty({ type: [UpsertTrackSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertTrackSectionDto)
  sections!: UpsertTrackSectionDto[];
}
