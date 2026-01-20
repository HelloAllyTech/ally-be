import { ApiProperty } from '@nestjs/swagger';

export class UserInfoDto {
  @ApiProperty({ example: 123 })
  id!: number;

  @ApiProperty({ example: 'John Doe', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 'https://example.com/profile.jpg', nullable: true })
  profileImage!: string | null;
}

export class CommentReactionsDto {
  [reaction: string]: number;
}

export class ReviewCommentItemDto {
  @ApiProperty({ example: 'comment-uuid-123' })
  id!: string;

  @ApiProperty({ example: 'This is a great comment!' })
  content!: string;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ type: UserInfoDto })
  createdBy!: UserInfoDto;

  reactions?: Record<string, number>;

  @ApiProperty({ example: 8 })
  replyCount!: number;

  @ApiProperty({ example: false })
  hidden!: boolean;
}

export class GetReviewCommentsResponseDto {
  @ApiProperty({ type: [ReviewCommentItemDto] })
  data!: ReviewCommentItemDto[];

  @ApiProperty({ example: 45 })
  count!: number;
}
