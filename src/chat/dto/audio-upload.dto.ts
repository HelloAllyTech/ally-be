import { IsString, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Chat } from '../../common/entities/chat.entity';

export class AudioUploadRequestDto {
  @ApiProperty({
    description: 'Name of the audio file',
    example: 'my-audio.wav',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'MIME type of the audio file',
    example: 'audio/wav',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;
}

export class AudioUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for the audio file',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'S3 key of the uploaded file',
  })
  @IsString()
  @IsNotEmpty()
  s3Key!: string;
}

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'S3 key of the uploaded file',
  })
  @IsString()
  @IsNotEmpty()
  s3Key!: string;
}

export class ConfirmUploadResponseDto {
  @ApiProperty({
    description: 'Chat Object',
  })
  @IsObject()
  @IsNotEmpty()
  chat!: Chat;
}
