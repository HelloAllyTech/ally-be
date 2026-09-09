import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TrackItemType } from '../type/track.type';
import { UpsertTrackItemCompletionCriteriaDto } from './upsert-track-structure.dto';

/**
 * The five item types the Component Library supports. ROLEPLAY/CASE reference
 * a scenario/case rather than carrying inline content, and GAME never gates
 * progression — none of them are reusable "configure once, insert anywhere"
 * templates the way Journal/Quiz/Article/Video/Annotated Artifact are.
 */
export const SUPPORTED_TRACK_COMPONENT_TEMPLATE_TYPES: TrackItemType[] = [
  TrackItemType.JOURNAL,
  TrackItemType.QUIZ,
  TrackItemType.ARTICLE,
  TrackItemType.VIDEO,
  TrackItemType.ANNOTATED_ARTIFACT,
];

export class CreateTrackComponentTemplateDto {
  @ApiProperty({ enum: TrackItemType })
  @IsEnum(TrackItemType)
  type!: TrackItemType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description:
      'Inline content JSONB, same union TrackItem.content uses; validated per type',
  })
  @IsObject()
  content!: Record<string, any>;

  @ApiPropertyOptional({ type: UpsertTrackItemCompletionCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertTrackItemCompletionCriteriaDto)
  completionCriteria?: UpsertTrackItemCompletionCriteriaDto;
}

export class UpdateTrackComponentTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    description:
      'Inline content JSONB, same union TrackItem.content uses; re-validated per type when supplied',
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

export class GetTrackComponentTemplatesQueryDto {
  @ApiPropertyOptional({ enum: TrackItemType })
  @IsOptional()
  @IsEnum(TrackItemType)
  type?: TrackItemType;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on title',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class TrackComponentTemplateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TrackItemType })
  type!: TrackItemType;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: Record<string, any>;

  @ApiPropertyOptional()
  completionCriteria!: UpsertTrackItemCompletionCriteriaDto | null;

  @ApiProperty()
  createdBy!: number;

  @ApiProperty()
  updatedBy!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class GetTrackComponentTemplatesResponseDto {
  @ApiProperty({ type: [TrackComponentTemplateDto] })
  items!: TrackComponentTemplateDto[];

  @ApiProperty()
  total!: number;
}
