import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsArray,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class DashboardParamsDto {
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
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  externalId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @IsArray()
  @IsOptional()
  data?: string[];
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
