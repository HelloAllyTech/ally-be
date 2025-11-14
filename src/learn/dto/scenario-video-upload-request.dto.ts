import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { ScenarioVideoUploadContentType } from '../enum/scenario-video-upload-content-type';

export class ScenarioVideoUploadRequestDto {
  @ApiProperty({
    description: 'Name of video file',
    example: 'scenario-cover.mp4',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  @IsNumber()
  @IsNotEmpty()
  fileSize!: number;

  @ApiProperty({
    description: 'Duration of the video file in seconds',
    example: 8,
  })
  @IsNumber()
  @IsNotEmpty()
  duration!: number;

  @ApiProperty({
    description: 'MIME type of video file',
    example: ScenarioVideoUploadContentType.MP4,
    enum: ScenarioVideoUploadContentType,
  })
  @IsEnum(ScenarioVideoUploadContentType)
  @IsNotEmpty()
  contentType!: ScenarioVideoUploadContentType;
}
