import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
} from 'class-validator';
import { SessionEventDetectionType } from '../enum/session-event-detection-type.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';

export class CreateSessionEventDto {
  @ApiProperty({
    description: 'ID for the event',
    example: 'event-1',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'The name of the event',
    example: 'Event 1',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'The description of the event',
    example: 'Event 1 description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'The session quality score of the event',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  score?: number;

  @ApiProperty({
    description: 'The emoji of the event',
    example: '👍',
  })
  @IsOptional()
  @IsString()
  emoji?: string;

  @ApiProperty({
    description: 'The real time feedback message of the event',
    example: 'Event 1 real time feedback message',
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    description: 'The branch instruction of the event',
    example: 'Event 1 branch instruction',
  })
  @IsString()
  @IsOptional()
  branchInstruction?: string;

  @ApiProperty({
    description: 'The detection type of the event',
    example: 'SENTENCE_SIMILARITY',
    default: 'SENTENCE_SIMILARITY',
  })
  @IsEnum(SessionEventDetectionType)
  @IsOptional()
  detectionType?: SessionEventDetectionType =
    SessionEventDetectionType.SENTENCE_SIMILARITY;

  @ApiProperty({
    description: 'The visibility type of the event',
    example: 'ACTIVE',
    default: 'ACTIVE',
  })
  @IsEnum(SessionEventVisibilityType)
  @IsOptional()
  visibilityType?: SessionEventVisibilityType =
    SessionEventVisibilityType.ACTIVE;

  @ApiProperty({
    description: 'The sentences of the event',
    example: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sentences?: string[];
}
