import { ApiProperty } from '@nestjs/swagger';

export class UserInfoDto {
  @ApiProperty({ example: 123 })
  id!: number;

  @ApiProperty({ example: 'John Doe', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 'https://example.com/profile.jpg', nullable: true })
  profileImage?: string | null;
}

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

  @ApiProperty({ type: UserInfoDto })
  createdBy!: UserInfoDto;

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
