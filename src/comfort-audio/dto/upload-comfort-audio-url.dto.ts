import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

import { ComfortAudioUploadContentType } from '../enum/comfort-audio-upload-content-type.enum';
import { COMFORT_AUDIO_MAX_FILE_SIZE_BYTES } from '../constants/comfort-audio.constants';

export class UploadComfortAudioUrlRequestDto {
  @ApiProperty({
    description: 'Name of the audio file',
    example: 'rain-ambience.mp3',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
    minimum: 1,
    maximum: COMFORT_AUDIO_MAX_FILE_SIZE_BYTES,
  })
  @IsNumber()
  @Min(1)
  @Max(COMFORT_AUDIO_MAX_FILE_SIZE_BYTES)
  fileSize!: number;

  @ApiProperty({
    description: 'MIME type of the audio file',
    example: ComfortAudioUploadContentType.MPEG,
    enum: ComfortAudioUploadContentType,
  })
  @IsEnum(ComfortAudioUploadContentType)
  @IsNotEmpty()
  contentType!: ComfortAudioUploadContentType;
}

export class UploadComfortAudioUrlResponseDto {
  @ApiProperty({ description: 'Presigned URL for uploading the audio file' })
  presignedUrl!: string;

  @ApiProperty({ description: 'S3 object URL for the uploaded audio file' })
  audioUrl!: string;
}
