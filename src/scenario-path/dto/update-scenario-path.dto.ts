import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { ScenarioPathStatus } from '../type/scenario-paths.type';
import { UpdateScenarioPathItemDto } from './update-scenario-path-item.dto';

export class UpdateScenarioPathDto {
  @ApiProperty({ description: 'Title of the scenario path' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiProperty({ description: 'Whether the path is available globally' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiProperty({
    description: 'Status of the scenario path',
    enum: ScenarioPathStatus,
  })
  @IsNotEmpty()
  @IsEnum(ScenarioPathStatus)
  status!: ScenarioPathStatus;

  @ApiProperty({
    description: 'List of scenarios in the path',
    type: [UpdateScenarioPathItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateScenarioPathItemDto)
  scenarios?: UpdateScenarioPathItemDto[];
}

export class UpdateScenarioPathResponseDto {
  @ApiProperty({ description: 'ID of the scenario path' })
  id!: string;

  @ApiProperty({ description: 'Title of the scenario path' })
  title?: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the scenario path' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the scenario path' })
  @IsEnum(ScenarioPathStatus)
  status!: ScenarioPathStatus;
}
