import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { BlogStatus } from '../enum/blog-status.enum';

export class CreateBlogDto {
  @ApiProperty({ description: 'Post title', example: 'Introducing Blogs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({
    description:
      'URL-friendly slug. Auto-generated from the title when omitted; must be unique.',
    example: 'introducing-blogs',
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  slug?: string;

  @ApiPropertyOptional({ description: 'Short summary shown in listings' })
  @IsOptional()
  @IsString()
  tldr?: string;

  @ApiPropertyOptional({ description: 'Rich-text HTML body' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    description: 'Tags for discovery/filtering',
    type: [String],
    example: ['release', 'announcement'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Category', example: 'Product Updates' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ description: 'Header image URL (from upload-url)' })
  @IsOptional()
  @IsString()
  headerImageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Initial status. Defaults to DRAFT. Set PUBLISHED to publish immediately.',
    enum: BlogStatus,
    default: BlogStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(BlogStatus)
  status?: BlogStatus;
}
