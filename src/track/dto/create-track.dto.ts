import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { TRACK_MAX_COMPETENCIES } from '../constants/track.constant';
import { TrackStatus } from '../type/track.type';

const COMPETENCY_IDS_DESCRIPTION =
  'The competencies this course teaches: ids of shared (non-custom) ' +
  '`competencies` rows, at most ' +
  TRACK_MAX_COMPETENCIES +
  '. Optional. Analytics → Course impact reads the course on these skills ' +
  "when set, and falls back to the competencies of the course's roleplay " +
  'scenarios when not. Omit the key to leave the tag unchanged; send `null` ' +
  'or `[]` to clear it (stored as NULL). An id the course already carries ' +
  'whose competency has since been deleted is dropped silently.';

export class CreateTrackDto {
  @ApiPropertyOptional({ description: 'Title of the track' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the track' })
  @IsOptional()
  @IsString()
  description?: string | null;

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

  @ApiPropertyOptional({
    description: COMPETENCY_IDS_DESCRIPTION,
    type: [String],
    nullable: true,
    maxItems: TRACK_MAX_COMPETENCIES,
    example: ['123e4567-e89b-42d3-a456-426614174000'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRACK_MAX_COMPETENCIES)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  competencyIds?: string[] | null;
}

export class TrackSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title?: string;

  @ApiProperty()
  description?: string | null;

  @ApiProperty()
  coverImageUrl?: string;

  @ApiProperty({ enum: TrackStatus })
  status!: TrackStatus;

  @ApiPropertyOptional({
    description:
      'Stored `tracks.competencyIds`: the competencies the author tagged this ' +
      'course with, or null when untagged (Course impact then derives them ' +
      "from the course's roleplay scenarios).",
    type: [String],
    nullable: true,
  })
  competencyIds?: string[] | null;
}
