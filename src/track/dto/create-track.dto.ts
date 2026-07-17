import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TrackStatus } from '../type/track.type';

export class CreateTrackDto {
  @ApiPropertyOptional({ description: 'Title of the track' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the track' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'Whether the track is global' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    description: 'Status of the track',
    enum: TrackStatus,
    default: TrackStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus;

  @ApiPropertyOptional({ description: 'Estimated duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDurationMinutes?: number;
}

export class TrackSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title?: string;

  @ApiProperty()
  description?: string;

  @ApiProperty()
  coverImageUrl?: string;

  @ApiProperty({ enum: TrackStatus })
  status!: TrackStatus;
}
