import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';

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

  @ApiProperty({ type: CreatedByDto })
  createdBy!: CreatedByDto;

  @ApiProperty({
    example: '1f44d',
    nullable: true,
    description: "Current user's reaction on this comment",
  })
  myReaction!: string | null;

  @ApiProperty({
    example: { '1f44d': 5 },
    description: 'Reaction counts by type',
  })
  reactions!: Record<string, number>;

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
