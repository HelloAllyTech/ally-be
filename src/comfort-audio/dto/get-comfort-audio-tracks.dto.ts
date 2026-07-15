import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

import { ComfortAudioTrackResponseDto } from './comfort-audio-track-response.dto';

export enum ComfortAudioTrackSortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
}

export enum ComfortAudioTrackSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class GetComfortAudioTracksQueryDto {
  @ApiProperty({ description: 'Number of records to return', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiProperty({ description: 'Number of records to skip', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiProperty({
    description: 'Field to sort by',
    required: false,
    enum: ComfortAudioTrackSortBy,
    default: ComfortAudioTrackSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(ComfortAudioTrackSortBy)
  sortBy?: ComfortAudioTrackSortBy = ComfortAudioTrackSortBy.CREATED_AT;

  @ApiProperty({
    description: 'Sort order',
    required: false,
    enum: ComfortAudioTrackSortOrder,
    default: ComfortAudioTrackSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(ComfortAudioTrackSortOrder)
  sortOrder?: ComfortAudioTrackSortOrder = ComfortAudioTrackSortOrder.DESC;

  @ApiProperty({
    description:
      'Include archived tracks in the result. Defaults to false so the roleplay picker only ever sees active tracks; the superadmin library screen passes true to manage them.',
    required: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean = false;
}

export class GetComfortAudioTracksResponseDto {
  @ApiProperty({ type: [ComfortAudioTrackResponseDto] })
  tracks!: ComfortAudioTrackResponseDto[];

  @ApiProperty({ description: 'Count of tracks matching the filter' })
  count!: number;
}
