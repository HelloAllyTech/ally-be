import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { ScenarioPathStatus } from '../type/scenario-paths.type';
import { CreateScenarioPathItemDto } from './create-scenario-path-item.dto';

export class CreateScenarioPathDto {
  @ApiProperty({ description: 'Title of the scenario path' })
  @IsOptional()
  @IsString()
  title!: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  @IsOptional()
  @IsString()
  description!: string;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImageUrl!: string;

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
    type: [CreateScenarioPathItemDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateScenarioPathItemDto)
  scenarios!: CreateScenarioPathItemDto[];
}
