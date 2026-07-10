import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TrackMediaKind } from '../constants/track.constant';

export class TrackMediaUploadRequestDto {
  @ApiProperty({ description: 'Original file name' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({ description: 'File size in bytes' })
  @IsNumber()
  @Min(1)
  fileSize!: number;

  @ApiProperty({ description: 'MIME content type' })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiProperty({ enum: TrackMediaKind })
  @IsEnum(TrackMediaKind)
  kind!: TrackMediaKind;

  @ApiPropertyOptional({ description: 'Video duration in seconds' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  duration?: number;
}

export class TrackMediaUploadResponseDto {
  @ApiProperty({ description: 'Presigned PUT URL (10 min expiry)' })
  presignedUrl!: string;

  @ApiProperty({ description: 'Public URL of the object after upload' })
  publicUrl!: string;
}

export class DeleteTrackMediaDto {
  @ApiProperty({ description: 'Public URL of the media object to delete' })
  @IsString()
  @IsNotEmpty()
  url!: string;
}
