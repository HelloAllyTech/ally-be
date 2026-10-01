import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BlogStatus } from '../enum/blog-status.enum';

export class BlogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional()
  tldr?: string | null;

  @ApiPropertyOptional()
  body?: string | null;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty({
    description: 'Cover fill (#RRGGBB) used when there is no header image',
  })
  coverColor!: string;

  @ApiPropertyOptional()
  authorName?: string | null;

  @ApiPropertyOptional()
  headerImageUrl?: string | null;

  @ApiProperty({ enum: BlogStatus })
  status!: BlogStatus;

  @ApiPropertyOptional()
  publishedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BlogTagCountDto {
  @ApiProperty()
  tag!: string;

  @ApiProperty({ description: 'Number of published posts carrying the tag' })
  count!: number;
}

export class GetBlogTagsResponseDto {
  @ApiProperty({ type: [BlogTagCountDto] })
  tags!: BlogTagCountDto[];
}

export class GetBlogsResponseDto {
  @ApiProperty({ type: [BlogResponseDto] })
  blogs!: BlogResponseDto[];

  @ApiProperty({ description: 'Total count matching the filter' })
  count!: number;
}
