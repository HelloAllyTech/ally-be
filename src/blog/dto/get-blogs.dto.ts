import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { BlogStatus } from '../enum/blog-status.enum';

export enum BlogSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  PUBLISHED_AT = 'publishedAt',
  TITLE = 'title',
}

export enum BlogSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// Admin listing query — supports search, status filter and pagination.
export class GetBlogsQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on title/tldr' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: BlogStatus,
  })
  @IsOptional()
  @IsEnum(BlogStatus)
  status?: BlogStatus;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Number of records to return' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: BlogSortBy,
    default: BlogSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(BlogSortBy)
  sortBy?: BlogSortBy = BlogSortBy.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: BlogSortOrder,
    default: BlogSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(BlogSortOrder)
  sortOrder?: BlogSortOrder = BlogSortOrder.DESC;
}

// Public listing query — always scoped to published posts server-side.
export class GetPublicBlogsQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search on title/tldr' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by tag' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: 'Number of records to return' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}
