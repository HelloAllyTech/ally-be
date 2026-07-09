import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class AddComfortAudioTrackDto {
  @ApiProperty({
    description: 'Display name for the track (shown to authors in the picker)',
    example: 'Rain ambience',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description:
      'Audio URL — S3 URL (from presigned upload) or any public audio asset URL',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/comfort-audio-library/1730000000000-rain-ambience.mp3',
  })
  @IsString()
  @IsNotEmpty()
  // allow_underscores/require_tld:false so local S3 hosts (e.g. the localstack
  // "s3_bucket" bucket) validate; prod bucket names are DNS-valid regardless.
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, allow_underscores: true })
  audioUrl!: string;

  @ApiProperty({ description: 'MIME type of the audio file', required: false })
  @IsOptional()
  @IsString()
  contentType?: string;

  @ApiProperty({ description: 'File size in bytes', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
