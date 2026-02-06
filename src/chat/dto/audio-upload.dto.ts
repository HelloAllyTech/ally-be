import {
  IsString,
  IsNotEmpty,
  IsNumber,
  MaxDate,
  IsEnum,
  IsDate,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AudioChatPlatform } from 'src/common/constants/chat.constants';

export class AudioUploadRequestDto {
  @ApiProperty({
    description: 'Name of the audio file',
    example: 'my-audio.wav',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024,
  })
  @IsNumber()
  @IsNotEmpty()
  fileSize!: number;

  @ApiProperty({
    description: 'MIME type of the audio file',
    example: 'audio/wav',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiProperty({
    description: 'Counselor ID',
  })
  @IsNumber()
  @IsNotEmpty()
  counselorId!: number;

  @ApiProperty({
    description: 'Started At (ISO string)',
    example: '2025-01-01T00:00:00.000Z',
  })
  @Transform(({ value }) => new Date(value))
  @IsDate()
  @MaxDate(() => new Date(), {
    message: 'Start date must be before current date',
  })
  startedAt!: Date;

  @ApiProperty({
    description: 'Platform',
  })
  @IsEnum(AudioChatPlatform)
  @IsNotEmpty()
  platform!: AudioChatPlatform;

  @ApiProperty({
    description: 'Duration of the audio file in seconds',
  })
  @IsNumber()
  @IsNotEmpty()
  duration!: number;
}

export class AudioUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for the audio file',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'S3 key of the audio file',
  })
  s3Key!: string;

  @ApiProperty({
    description: 'Chat ID',
  })
  @IsNumber()
  @IsNotEmpty()
  chatId!: number;
}

export class CancelUploadRequestDto {
  @ApiProperty({
    description: 'Chat ID',
  })
  @IsNumber()
  @IsNotEmpty()
  chatId!: number;
}

export class ProcessAudioUploadRequestDto {
  @ApiProperty({
    description: 'S3 key of audio file',
  })
  @IsString()
  @IsNotEmpty()
  s3Key!: string;
}
