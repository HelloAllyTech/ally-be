import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  CombinationExpressionRequestType,
  CombinationExpressionType,
  SessionEventDetectionCondition,
  SessionEventDetectionType,
} from '../enum/session-event-detection.enum';
import { SessionEventSpeaker } from '../enum/session-event-speaker.enum';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';

export class CombinationExpressionDto {
  @ApiProperty({ required: true })
  @IsEnum(CombinationExpressionType)
  type!: CombinationExpressionType;

  @ApiProperty({ required: false })
  left?: CombinationExpressionDto;

  @ApiProperty({ required: false })
  right?: CombinationExpressionDto;

  @ApiProperty({ required: false })
  operand?: CombinationExpressionDto;

  @ApiProperty({ required: false })
  id?: string;
}

export class CombinationExpressionRequestDto {
  @ApiProperty({ required: false })
  @IsEnum(CombinationExpressionRequestType)
  @IsOptional()
  type?: CombinationExpressionRequestType;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => CombinationExpressionRequestDto)
  @IsOptional()
  left?: CombinationExpressionRequestDto;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => CombinationExpressionRequestDto)
  @IsOptional()
  right?: CombinationExpressionRequestDto;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  id?: string;
}

export class DetectionDataDto<T> {
  @ApiProperty({ required: false })
  sentences?: string[];

  @ApiProperty({ required: false })
  score?: number;

  @ApiProperty({ required: false })
  time?: number;

  @ApiProperty({ required: false })
  condition?: SessionEventDetectionCondition;

  @ApiProperty({ required: false })
  expression?: T;
}

export class DetectionDataRequestDto extends DetectionDataDto<CombinationExpressionRequestDto> {}

export class SessionEventDto<T> {
  @ApiProperty({
    description: 'The name of the event',
    example: 'Event 1',
  })
  @IsString()
  @IsNotEmpty()
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
  detectionType?: SessionEventDetectionType;

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
    description:
      'The detection data of the event. Structure depends on detectionType',
    example: {
      sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
      expression: {
        type: CombinationExpressionRequestType.AND,
        left: {
          id: 'eventId-1',
        },
        right: {
          type: CombinationExpressionRequestType.NOT,
          left: { id: 'eventId-2' },
        },
      },
    },
  })
  @ValidateNested()
  @Type(() => DetectionDataDto)
  @IsOptional()
  detectionData?: DetectionDataDto<T>;

  @ApiProperty({
    description: 'The speaker of the event',
    example: SessionEventSpeaker.CARE_GIVER,
    enum: SessionEventSpeaker,
  })
  @IsEnum(SessionEventSpeaker)
  @IsNotEmpty()
  speaker!: SessionEventSpeaker;
}

export class CreateSessionEventDto extends SessionEventDto<CombinationExpressionRequestDto> {}

export class UpdateSessionEventDto extends SessionEventDto<CombinationExpressionRequestDto> {}

export class SessionEventResponseDto extends SessionEventDto<CombinationExpressionRequestDto> {}
