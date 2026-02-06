import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsDateString,
  ValidateNested,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DashboardMetadata } from 'src/analytics/type/dashboard.data.type';
import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsTypeEnum } from '../constants/analytics.constants';

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
  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    try {
      return JSON.parse(value);
    } catch {
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
    description: 'Analytics type',
    enum: AnalyticsTypeEnum,
    required: true,
  })
  @IsEnum(AnalyticsTypeEnum)
  analyticsType!: AnalyticsTypeEnum;

  @ApiProperty({
    description: 'Additional data for the dashboard',
    type: DashboardDataDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardDataDto)
  metadata?: DashboardMetadata;

  @ApiProperty({
    description: 'Tenant IDs to enable this analytics',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tenantIds?: string[];

  @ApiProperty({
    description:
      'Array of group IDs (roles) that have access to this analytics',
    example: [1, 2],
    type: [Number],
    required: false,
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  groupIds?: number[];
}

export class CreateDashboardResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the created dashboard',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;
}

export class DashboardIdParamDto {
  @ApiProperty({
    description: 'External ID for the dashboard',
  })
  @IsString()
  @IsNotEmpty()
  externalId!: string;
}

export class CounselorStatsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CounselorStatsResponseDto {
  counselorName!: string;

  counselorListeningDuration!: number;

  counselorSharingDuration!: number;

  counselorSharingPercentage!: number;
}

export class UpdateDashboardDto {
  @ApiProperty({
    description: 'Name of the dashboard',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'External ID for the dashboard (from Metabase)',
  })
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiProperty({
    description: 'Optional description of the dashboard',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Analytics type',
    enum: AnalyticsTypeEnum,
    required: false,
  })
  @IsEnum(AnalyticsTypeEnum)
  @IsOptional()
  analyticsType?: AnalyticsTypeEnum;

  @ApiProperty({
    description: 'Additional data for the dashboard',
    type: DashboardDataDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardDataDto)
  metadata?: DashboardMetadata;

  @ApiProperty({
    description: 'Tenant IDs to enable this analytics',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tenantIds?: string[];

  @ApiProperty({
    description:
      'Array of group IDs (roles) that have access to this analytics',
    example: [1, 2],
    type: [Number],
    required: false,
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  groupIds?: number[];
}

export class DashboardResponseDTO {
  @ApiProperty({
    description: 'Dashboard ID',
  })
  id!: string;

  @ApiProperty({
    description: 'External ID',
  })
  externalId!: string;

  @ApiProperty({
    description: 'Name',
  })
  name!: string;

  @ApiProperty({
    description: 'Description',
  })
  description?: string;

  @ApiProperty({
    description: 'Data',
  })
  data?: DashboardMetadata;
}
