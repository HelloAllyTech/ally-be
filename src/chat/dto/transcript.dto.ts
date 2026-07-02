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

  @ApiProperty({
    required: false,
    description: 'STT provider that actually produced the transcript',
    example: 'openai',
  })
  @IsOptional()
  @IsString()
  sttProviderSucceeded?: string;

  @ApiProperty({
    required: false,
    description:
      'Per-provider STT trail for this attempt: [{provider, ok, error?}]',
  })
  @IsArray()
  @IsOptional()
  sttAttempts?: { provider: string; ok: boolean; error?: string }[];

  @ApiProperty({
    required: false,
    description: 'LLM model used to generate the summary',
    example: 'gpt-4o-mini-2024-07-18',
  })
  @IsOptional()
  @IsString()
  summaryModel?: string;

  @ApiProperty({
    required: false,
    description:
      'Furthest pipeline phase reached (created/audio-uploaded/transcribed/' +
      'diarized/summarized/delivered)',
    example: 'delivered',
  })
  @IsOptional()
  @IsString()
  phaseReached?: string;
}
