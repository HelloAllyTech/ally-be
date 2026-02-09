import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BadgeCategory, BadgeStatus } from '../constants/badge.constants';

export class BadgeFilterDto {
  @ApiProperty({
    name: 'search',
    type: String,
    required: false,
    description: 'Search by name or code (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    name: 'category',
    required: false,
    enum: BadgeCategory,
    description: 'Filter by badge category',
  })
  @IsOptional()
  @IsEnum(BadgeCategory)
  category?: BadgeCategory;

  @ApiProperty({
    name: 'status',
    required: false,
    enum: BadgeStatus,
    description: 'Filter by badge status',
  })
  @IsOptional()
  @IsEnum(BadgeStatus)
  status?: BadgeStatus;
}
