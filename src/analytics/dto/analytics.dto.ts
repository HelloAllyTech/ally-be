import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsDateString,
  ValidateNested,
  IsArray,
  IsUUID,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DashboardData } from 'src/analytics/type/dashboard.data.type';
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

  @ApiProperty({
    description: 'Tenant ID for the dashboard',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  tenantId!: string;
}

export class DashboardIdParamDto {
  @IsString()
  @IsNotEmpty()
  dashboardId!: string;
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
