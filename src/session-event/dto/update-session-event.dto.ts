import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { SessionEventDetectionType } from '../enum/session-event-detection-type.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { SessionEventSpeaker } from '../enum/session-event-speaker.enum';
import { DetectionDataDto } from './create-session-event.dto';
import { Type } from 'class-transformer';

export class UpdateSessionEventDto {
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
    description: 'The detection data of the event',
    type: DetectionDataDto,
    example: {
      sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
    },
  })
  @ValidateNested()
  @Type(() => DetectionDataDto)
  @IsOptional()
  detectionData?: DetectionDataDto;

  @ApiProperty({
    description: 'The speaker of the event',
    example: SessionEventSpeaker.CARE_GIVER,
    enum: SessionEventSpeaker,
  })
  @IsEnum(SessionEventSpeaker)
  @IsOptional()
  speaker?: SessionEventSpeaker;
}
