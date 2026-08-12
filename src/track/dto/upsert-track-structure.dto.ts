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
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
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
