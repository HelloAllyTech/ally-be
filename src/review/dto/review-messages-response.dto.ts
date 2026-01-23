import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';

export class CommentReactionsDto {
  [reaction: string]: number;
}

export class ReviewCommentDto {
  @ApiProperty({ example: 'comment-uuid-123' })
  id!: string;

  @ApiProperty({ example: 'This is a great point!' })
  content!: string;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  createdAt!: Date;

  @ApiProperty({ type: CreatedByDto })
  createdBy!: CreatedByDto;

  @ApiProperty({ type: CommentReactionsDto })
  reactions?: Record<string, number>;

  @ApiProperty({ example: false })
  hidden!: boolean;

  @ApiProperty({ example: 8 })
  replyCount!: number;
}

export class ReviewThreadDto {
  @ApiProperty({ example: 'thread-uuid-456' })
  id!: string;

  @ApiProperty({ type: [ReviewCommentDto] })
  comments?: ReviewCommentDto[];

  @ApiProperty({
    example: { startIndex: 0, endIndex: 10, text: 'selected text' },
    description: 'JSON object containing selection details',
  })
  selection!: Record<string, any>;

  @ApiProperty({ type: CreatedByDto })
  createdBy!: CreatedByDto;
}

export class ReviewMessageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'This is a message content' })
  content!: string;

  @ApiProperty({ example: '2026-01-15T10:00:00Z' })
  createdAt!: Date;

  @ApiProperty({ example: 0, nullable: true })
  startSeconds?: number;

  @ApiProperty({ example: 5.5, nullable: true })
  endSeconds?: number;

  @ApiProperty({ example: 123 })
  senderId!: number;

  @ApiProperty({ type: [ReviewThreadDto] })
  threads?: ReviewThreadDto[];
}

export class GetReviewMessagesResponseDto {
  @ApiProperty({ type: [ReviewMessageDto] })
  data!: ReviewMessageDto[];

  @ApiProperty({ example: 25 })
  count!: number;
}
