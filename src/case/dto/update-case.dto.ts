import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaseStatus } from '../type/cases.type';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateCaseItemDto } from './update-case-item.dto';

export class UpdateCaseDto {
  @ApiProperty({ description: 'Title of the case' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'Description of the case' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiProperty({ description: 'Whether the case is available globally' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiProperty({
    description: 'Status of the case',
    enum: CaseStatus,
  })
  @IsNotEmpty()
  @IsEnum(CaseStatus)
  status!: CaseStatus;

  @ApiProperty({
    description: 'List of scenarios in the case',
    type: [UpdateCaseItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCaseItemDto)
  scenarios?: UpdateCaseItemDto[];
}

export class UpdateCaseResponseDto {
  @ApiProperty({ description: 'ID of the case' })
  id!: string;

  @ApiProperty({ description: 'Title of the case' })
  title?: string;

  @ApiProperty({ description: 'Description of the case' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the case' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the case' })
  @IsEnum(CaseStatus)
  status!: CaseStatus;
}
