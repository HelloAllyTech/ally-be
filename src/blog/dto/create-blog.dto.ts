import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  BLOG_COVER_COLOR_PATTERN,
  BLOG_DEFAULT_COVER_COLOR,
} from '../constants/blog.constants';
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

  @ApiPropertyOptional({
    description:
      'Cover fill (#RRGGBB) shown in place of the header image when there is none',
    example: BLOG_DEFAULT_COVER_COLOR,
  })
  @IsOptional()
  @Matches(BLOG_COVER_COLOR_PATTERN, {
    message: 'coverColor must be a #RRGGBB hex colour',
  })
  coverColor?: string;

  @ApiPropertyOptional({
    description: 'Author display name shown as the byline',
    example: 'Jane Doe',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorName?: string;

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
