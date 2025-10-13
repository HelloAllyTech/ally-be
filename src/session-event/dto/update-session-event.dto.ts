import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { SessionEventDetectionType } from '../enum/session-event-detection-type.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';

export class UpdateSessionEventDto {
  @ApiProperty({
    description: 'ID for the event',
    example: 'event-1',
  })
  @IsOptional()
  @IsString()
  id?: string;
  @ApiProperty({
    description: 'The name of the event',
    example: 'Event 1',
  })
  @IsOptional()
  @IsString()
  name?: string;

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
  @IsOptional()
  @IsString()
  branchInstruction?: string;

  @ApiProperty({
    description: 'The detection type of the event',
    example: 'SENTENCE_SIMILARITY',
  })
  @IsOptional()
  @IsEnum(SessionEventDetectionType)
  detectionType?: SessionEventDetectionType;

  @ApiProperty({
    description: 'The visibility type of the event',
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(SessionEventVisibilityType)
  visibilityType?: SessionEventVisibilityType;

  @ApiProperty({
    description: 'The sentences of the event',
    example: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
  })
  @IsOptional()
  @IsString({ each: true })
  sentences?: string[];
}
