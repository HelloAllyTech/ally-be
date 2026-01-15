import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DetectionConfigDto } from 'src/session-event/dto/session-event.dto';

export class EventMappingDto {
  @ApiProperty({
    description: 'ID of the event',
    example: 'event1',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'The real time feedback status of the event',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  feedbackStatus?: boolean;

  @ApiProperty({
    description: 'The session quality score of the event',
    example: 85,
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
    example: 'Great job on this event!',
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    description: 'The branching status of the event',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  branchingStatus?: boolean;

  @ApiProperty({
    description: 'The branch instruction of the event',
    example: 'Continue with next step',
  })
  @IsOptional()
  @IsString()
  branchInstruction?: string;

  @ApiProperty({
    description: 'The detection config of the event',
    example: {
      startTime: 10,
      endTime: 20,
      maxOccurrences: 10,
      minGapTime: 10,
      minScore: 0,
      maxScore: 100,
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DetectionConfigDto)
  detectionConfig?: DetectionConfigDto;

  @ApiProperty({
    description: 'The checklist visibility status of the event on studio',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  checklistVisibilityStatus?: boolean;
}

export class CreateScenarioEventsDto {
  @ApiProperty({
    description: 'ID of the scenario',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description:
      'Array of events with their specific feedback and branching data',
    type: [EventMappingDto],
    example: [
      {
        id: 'event1',
        feedbackStatus: true,
        score: 85,
        emoji: '👍',
        message: 'Great job!',
        branchingStatus: true,
        branchInstruction: 'Continue with next step',
        detectionConfig: {
          startTime: 10,
          endTime: 20,
          maxOccurrences: 10,
          minGapTime: 10,
          minScore: 0,
          maxScore: 100,
        },
        checklistVisibilityStatus: false,
      },
      {
        id: 'event2',
        feedbackStatus: false,
        branchingStatus: false,
        checklistVisibilityStatus: false,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventMappingDto)
  events!: EventMappingDto[];
}
