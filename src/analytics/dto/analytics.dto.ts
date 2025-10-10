import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsDateString,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DashboardData } from 'src/common/entities/type/dashboard.data.type';
import { ApiProperty } from '@nestjs/swagger';

export class DashboardDataDto {
  @ApiProperty({
    description: 'Array of parameter keys for the dashboard',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  params?: string[];
}

export class DashboardParamsDto {
  @ApiProperty({
    description: 'Dashboard parameters as JSON object',
    required: false,
  })
  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  })
  params?: Record<string, any>;
}

export class CreateDashboardDto {
  @ApiProperty({
    description: 'Name of the dashboard',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'External ID for the dashboard (from Metabase)',
  })
  @IsString()
  @IsNotEmpty()
  externalId!: string;

  @ApiProperty({
    description: 'Optional description of the dashboard',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Order of the dashboard in the list',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  order?: number;

  @ApiProperty({
    description: 'Group ID that has access to this dashboard',
  })
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @ApiProperty({
    description: 'Additional data for the dashboard',
    type: DashboardDataDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardDataDto)
  data?: DashboardData;
}

export class DashboardIdParamDto {
  @ApiProperty({
    description: 'The unique identifier of the dashboard',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  dashboardId!: string;
}

export class CounselorStatsQueryDto {
  @ApiProperty({
    description: 'Start date for the statistics query (ISO 8601 format)',
    required: false,
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date for the statistics query (ISO 8601 format)',
    required: false,
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CounselorStatsResponseDto {
  @ApiProperty({
    description: 'Name of the counselor',
    example: 'John Doe',
  })
  counselorName!: string;

  @ApiProperty({
    description: 'Total listening duration in seconds',
    example: 3600,
  })
  counselorListeningDuration!: number;

  @ApiProperty({
    description: 'Total sharing/speaking duration in seconds',
    example: 1800,
  })
  counselorSharingDuration!: number;

  @ApiProperty({
    description: 'Percentage of time spent sharing/speaking',
    example: 33.33,
  })
  counselorSharingPercentage!: number;
}
