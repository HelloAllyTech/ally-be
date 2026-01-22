import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';

export class ReplyReactionsDto {
  [reaction: string]: number;
}

export class ReviewReplyItemDto {
  @ApiProperty({ example: 'reply-uuid-789' })
  id!: string;

  @ApiProperty({ example: 'This is a reply to the comment' })
  content!: string;

  @ApiProperty({ example: '2026-01-15T11:00:00Z' })
  createdAt!: Date;

  @ApiProperty({ type: CreatedByDto })
  createdBy!: CreatedByDto;

  reactions?: Record<string, number>;

  @ApiProperty({ example: false })
  hidden!: boolean;
}

export class GetReviewRepliesResponseDto {
  @ApiProperty({ type: [ReviewReplyItemDto] })
  data!: ReviewReplyItemDto[];

  @ApiProperty({ example: 15 })
  count!: number;
}
