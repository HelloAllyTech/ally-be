import { ApiProperty } from '@nestjs/swagger';

export class ReviewReactionUserDto {
  @ApiProperty({ example: 123 })
  id!: number;

  @ApiProperty({ example: 'John Doe' })
  name!: string;

  @ApiProperty({ example: 'https://example.com/profile.jpg', nullable: true })
  profileImage!: string | null;
}

export class ReviewReactionItemDto {
  @ApiProperty({ example: '1f44d' })
  reaction!: string;

  @ApiProperty({ type: ReviewReactionUserDto })
  createdBy!: ReviewReactionUserDto;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  createdAt!: Date;
}

export class GetReviewReactionsResponseDto {
  @ApiProperty({ type: [ReviewReactionItemDto] })
  data!: ReviewReactionItemDto[];

  @ApiProperty({ example: 45 })
  count!: number;
}
