import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  ValidateNested,
  Min,
  Max,
  IsArray,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddDocumentDto {
  @ApiProperty({
    description: 'Heading of the document',
  })
  @IsNotEmpty()
  @IsString()
  heading!: string;

  @ApiProperty({
    description: 'Content of the document',
  })
  @IsNotEmpty()
  @IsString()
  content!: string;

  @ApiProperty({
    description: 'Category of the document',
  })
  @IsNotEmpty()
  @IsString()
  category!: string;

  @ApiProperty({
    description: 'Tags of the document',
  })
  @IsOptional()
  tags?: string[];

  @ApiProperty({
    description: 'Whether the document is public',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class SearchFiltersDto {
  @ApiProperty({
    description: 'Category filter (optional)',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'Tags filter (optional)',
  })
  @IsOptional()
  tags?: string[];
}

enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class SearchDocumentsDto {
  @ApiProperty({
    description: 'Search query for semantic similarity',
  })
  @IsNotEmpty()
  @IsString()
  query!: string;

  @ApiProperty({
    description: 'Maximum number of results to return',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    description:
      'List of document IDs to exclude from results (for pagination)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  excludedIds?: string[];

  @ApiProperty({
    description: 'Search filters',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFiltersDto)
  filters?: SearchFiltersDto;

  @ApiProperty({
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiProperty({
    description: 'Sort order',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}

export class SearchResultDocumentDto {
  @ApiProperty({
    description: 'Document ID',
  })
  id!: string;

  @ApiProperty({
    description: 'Document heading',
  })
  heading!: string;

  @ApiProperty({
    description: 'Document content',
  })
  content!: string;

  @ApiProperty({
    description: 'Document category',
    example: 'Technology',
  })
  category!: string;

  @ApiProperty({
    description: 'Document tags',
  })
  tags!: string[];

  @ApiProperty({
    description: 'Semantic similarity score',
  })
  score!: number;
}

export class SearchDocumentsResponseDto {
  @ApiProperty({
    description: 'Array of matching documents',
    type: [SearchResultDocumentDto],
  })
  documents!: SearchResultDocumentDto[];

  @ApiProperty({
    description: 'Total number of matching documents',
  })
  total!: number;

  @ApiProperty({
    description: 'Limit used for the search',
  })
  limit!: number;
}

export class GetDocumentResponseDto {
  @ApiProperty({
    description: 'Document ID',
  })
  id!: string;

  @ApiProperty({
    description: 'Document heading',
  })
  heading!: string;

  @ApiProperty({
    description: 'Document content',
  })
  content!: string;

  @ApiProperty({
    description: 'Document category',
  })
  category!: string;

  @ApiProperty({
    description: 'Document tags',
  })
  tags?: string[];
}
