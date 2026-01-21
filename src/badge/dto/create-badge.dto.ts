import { ApiProperty } from '@nestjs/swagger';
import {
  BadgeCategory,
  BadgeStatus,
  BadgeVisibilityType,
} from '../constants/badge.constants';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  ValidateNested,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BadgeAchievementParamsDto {
  @ApiProperty({
    description:
      'Count of comments, reactions, or simulation minutes required for achievement',
    example: 10,
    required: false,
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  count?: number;
}

export class CreateBadgeDto {
  @ApiProperty({
    description: 'Unique code identifier for the badge',
    example: 'first-simulation',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    description: 'Display name of the badge',
    example: 'First Simulation',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Detailed description of the badge',
    example: 'Awarded for completing your first simulation session',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'URL to the badge image',
    example: 'https://example.com/badges/first-simulation.png',
    required: false,
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({
    description: 'Status of the badge',
    enum: BadgeStatus,
    example: BadgeStatus.ACTIVE,
    required: false,
  })
  @IsEnum(BadgeStatus)
  @IsOptional()
  status?: BadgeStatus = BadgeStatus.ACTIVE;

  @ApiProperty({
    description: 'Visibility type of the badge',
    enum: BadgeVisibilityType,
    example: BadgeVisibilityType.PUBLIC,
    required: false,
  })
  @IsEnum(BadgeVisibilityType)
  @IsOptional()
  visibilityType?: BadgeVisibilityType = BadgeVisibilityType.PUBLIC;

  @ApiProperty({
    description: 'Category of the badge',
    enum: BadgeCategory,
    example: BadgeCategory.SIMULATION_MINUTES,
  })
  @IsEnum(BadgeCategory)
  @IsNotEmpty()
  category!: BadgeCategory;

  @ApiProperty({
    description: 'Tenant IDs to assign this badge to (used for private badges)',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tenantIds?: string[] = [];

  @ApiProperty({
    description: 'The achievement parameters for earning this badge',
    type: BadgeAchievementParamsDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BadgeAchievementParamsDto)
  achievementParams?: BadgeAchievementParamsDto;

  @ApiProperty({
    description: 'Array of group IDs (roles) to assign',
    example: [1, 2],
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  groupIds?: number[];
}

export class CreateBadgeResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the created badge',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;
}

export class BadgeDto {}
