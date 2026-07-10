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

  @ApiPropertyOptional()
  category?: string | null;

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

export class GetBlogsResponseDto {
  @ApiProperty({ type: [BlogResponseDto] })
  blogs!: BlogResponseDto[];

  @ApiProperty({ description: 'Total count matching the filter' })
  count!: number;
}
