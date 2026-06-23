import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { FlattenedSummaryNotePayload } from '../type/call.details.type';

export class TranscriptRequestDto {
  @ApiProperty({
    description: 'Chat ID',
  })
  @IsNumber()
  @IsNotEmpty()
  chatId!: number;

  @ApiProperty({
    description: 'Chat transcription',
  })
  @IsArray()
  @IsOptional()
  transcription?: MessageRequest[];

  @ApiProperty({
    description: 'Chat Summary',
  })
  @IsObject()
  @IsOptional()
  summary?: FlattenedSummaryNotePayload;

  @ApiProperty({
    required: false,
    description: 'S3 download URL',
    example:
      'https://dummy-bucket.s3.amazonaws.com/result.json?X-Amz-Agnature=dummy',
  })
  @IsOptional()
  @IsString()
  downloadPresignedUrl?: string;

  @ApiProperty({
    required: false,
    description: 'S3 delete object URL',
    example:
      'https://dummy-bucket.s3.amazonaws.com/result.json?X-Amz-Agnature=dummy',
  })
  @IsOptional()
  @IsString()
  deletePresignedUrl?: string;

  @ApiProperty({
    required: false,
    description: 'Error occurred during chat transcript/summary generation',
    example: 'Internal server error',
  })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiProperty({
    required: false,
    description:
      'Pipeline stage the failure occurred in (e.g. transcribe, diarize, summarize, deliver)',
    example: 'summarize',
  })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiProperty({
    required: false,
    description:
      'End-to-end trace id echoed from the original transcribe request',
  })
  @IsOptional()
  @IsString()
  correlationId?: string;
}
