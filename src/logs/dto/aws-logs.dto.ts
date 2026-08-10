import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AwsLogServiceKey } from '../../config/config.service';

export const AWS_LOG_SERVICE_KEYS: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];

export const AWS_LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
export type AwsLogLevel = (typeof AWS_LOG_LEVELS)[number];

export class AwsLogsQueryDto {
  @ApiProperty({ enum: AWS_LOG_SERVICE_KEYS })
  @IsIn(AWS_LOG_SERVICE_KEYS)
  service!: AwsLogServiceKey;

  @ApiProperty({ description: 'Range start, epoch ms' })
  @Type(() => Number)
  @IsInt()
  startTime!: number;

  @ApiProperty({ description: 'Range end, epoch ms' })
  @Type(() => Number)
  @IsInt()
  endTime!: number;

  @ApiProperty({ enum: AWS_LOG_LEVELS, required: false })
  @IsOptional()
  @IsIn(AWS_LOG_LEVELS)
  level?: AwsLogLevel;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logStreamName?: string;

  @ApiProperty({ required: false, description: 'Free-text search term' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nextToken?: string;

  @ApiProperty({ required: false, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 200;
}

export class AwsLogStreamsQueryDto {
  @ApiProperty({ enum: AWS_LOG_SERVICE_KEYS })
  @IsIn(AWS_LOG_SERVICE_KEYS)
  service!: AwsLogServiceKey;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nextToken?: string;
}

export class AwsLogEventDto {
  @ApiProperty()
  timestamp!: number;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  logStreamName!: string;

  @ApiProperty()
  eventId!: string;
}

export class AwsLogsResponseDto {
  @ApiProperty({ type: AwsLogEventDto, isArray: true })
  events!: AwsLogEventDto[];

  @ApiProperty({ required: false })
  nextToken?: string;
}

export class AwsLogStreamDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false })
  lastEventTime?: number;
}

export class AwsLogStreamsResponseDto {
  @ApiProperty({ type: AwsLogStreamDto, isArray: true })
  streams!: AwsLogStreamDto[];

  @ApiProperty({ required: false })
  nextToken?: string;
}
