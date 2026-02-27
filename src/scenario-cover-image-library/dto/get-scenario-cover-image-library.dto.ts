import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ScenarioCoverImageLibrarySortBy {
  CREATED_AT = 'createdAt',
}

export enum ScenarioCoverImageLibrarySortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class GetScenarioCoverImageLibraryQueryDto {
  @ApiProperty({ description: 'Number of records to return', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({ description: 'Number of records to skip', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiProperty({
    description: 'Field to sort by',
    required: false,
    enum: ScenarioCoverImageLibrarySortBy,
    default: ScenarioCoverImageLibrarySortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(ScenarioCoverImageLibrarySortBy)
  sortBy?: ScenarioCoverImageLibrarySortBy =
    ScenarioCoverImageLibrarySortBy.CREATED_AT;

  @ApiProperty({
    description: 'Sort order',
    required: false,
    enum: ScenarioCoverImageLibrarySortOrder,
    default: ScenarioCoverImageLibrarySortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(ScenarioCoverImageLibrarySortOrder)
  sortOrder?: ScenarioCoverImageLibrarySortOrder =
    ScenarioCoverImageLibrarySortOrder.DESC;
}

export class ScenarioCoverImageLibraryItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'S3 object URL' })
  imageUrl!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class GetScenarioCoverImageLibraryResponseDto {
  @ApiProperty({ type: [ScenarioCoverImageLibraryItemDto] })
  coverImages!: ScenarioCoverImageLibraryItemDto[];

  @ApiProperty({ description: 'Count of cover images matching the filter' })
  count!: number;
}
