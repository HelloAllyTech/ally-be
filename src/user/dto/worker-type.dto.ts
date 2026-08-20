import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkerType } from '../enum/user.enum';

export const BULK_SET_WORKER_TYPE_MAX = 500;

export class SetWorkerTypeDto {
  @ApiProperty({
    description:
      'How much clinical training the learner brings, which sets the ' +
      "register of the AI supervisor's post-roleplay debrief. Assigned by " +
      'an admin — learners never self-declare this.',
    enum: WorkerType,
    example: WorkerType.LAY,
  })
  @IsEnum(WorkerType, {
    message:
      'workerType must be one of LAY, EARLY_PROFESSIONAL, EXPERIENCED_PROFESSIONAL',
  })
  workerType!: WorkerType;
}

export class BulkSetWorkerTypeDto {
  @ApiProperty({
    description:
      'IDs of the users to set the worker type for, all in the same organization',
    example: [101, 102, 103],
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_SET_WORKER_TYPE_MAX)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  @Type(() => Number)
  userIds!: number[];

  @ApiProperty({
    description: 'Worker type applied to every listed user',
    enum: WorkerType,
    example: WorkerType.LAY,
  })
  @IsEnum(WorkerType, {
    message:
      'workerType must be one of LAY, EARLY_PROFESSIONAL, EXPERIENCED_PROFESSIONAL',
  })
  workerType!: WorkerType;
}

export class BulkSetWorkerTypeResponseDto {
  @ApiProperty({ description: 'Number of users updated' })
  updated!: number;
}
