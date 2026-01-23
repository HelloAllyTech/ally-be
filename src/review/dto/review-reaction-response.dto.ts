import { ApiProperty } from '@nestjs/swagger';
import { CreatedByDto } from './created-user.dto';

export class ReviewReactionItemDto {
  @ApiProperty({ example: '1f44d' })
  reaction!: string;

  @ApiProperty({ type: CreatedByDto })
  createdBy!: CreatedByDto;

  @ApiProperty({ example: '2026-01-15T10:30:00Z' })
  createdAt!: Date;
}

export class GetReviewReactionsResponseDto {
  @ApiProperty({ type: [ReviewReactionItemDto] })
  data!: ReviewReactionItemDto[];

  @ApiProperty({ example: 45 })
  count!: number;
}
