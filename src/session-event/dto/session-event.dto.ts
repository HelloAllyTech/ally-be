import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
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
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';

export class CombinationExpressionDto {
  type!: CombinationExpressionType;
  left?: CombinationExpressionDto;
  right?: CombinationExpressionDto;
  operand?: CombinationExpressionDto;
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

export class CombinationExpressionResponseDto {
  @ApiProperty({ required: false })
  @IsEnum(CombinationExpressionRequestType)
  @IsOptional()
  type?: CombinationExpressionRequestType;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => CombinationExpressionResponseDto)
  @IsOptional()
  left?: CombinationExpressionRequestDto;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => CombinationExpressionResponseDto)
  @IsOptional()
  right?: CombinationExpressionRequestDto;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;
}

export class BinaryClassificationExampleDto {
  @ApiProperty({
    description: 'Text for the binary classifier',
    example: 'How are you feeling today?',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
export class DetectionDataDto<T> {
  @ApiProperty({ required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sentences?: string[];

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  score?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  time?: number;

  @ApiProperty({ required: false })
  @IsEnum(SessionEventDetectionCondition)
  @IsOptional()
  condition?: SessionEventDetectionCondition;

  @ApiProperty({ required: false })
  @ValidateNested()
  @IsOptional()
  expression?: T;

  @ApiProperty({
    required: false,
    description: 'Binary classifier name',
    example: 'Open-Ended Question',
  })
  @IsString()
  @IsOptional()
  className?: string;

  @ApiProperty({
    required: false,
    type: [BinaryClassificationExampleDto],
    description: 'Positive examples for binary classifier',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BinaryClassificationExampleDto)
  @IsOptional()
  positiveExamples?: BinaryClassificationExampleDto[];

  @ApiProperty({
    required: false,
    type: [BinaryClassificationExampleDto],
    description: 'Negative examples for binary classifier',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BinaryClassificationExampleDto)
  @IsOptional()
  negativeExamples?: BinaryClassificationExampleDto[];
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
      score: 50,
      time: 120,
      condition: SessionEventDetectionCondition.LT,
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
}

export class CreateSessionEventDto extends SessionEventDto<CombinationExpressionRequestDto> {}

export class UpdateSessionEventDto extends SessionEventDto<CombinationExpressionRequestDto> {}

export class SessionEventResponseDto extends SessionEventDto<CombinationExpressionResponseDto> {}
