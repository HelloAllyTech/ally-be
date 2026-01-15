import { IsEnum, IsNotEmpty } from 'class-validator';
import { ReviewStatus } from '../type/review.type';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateReviewStatusDto {
  @ApiProperty({
    description: 'New status of the review',
    example: ReviewStatus.HIDDEN,
  })
  @IsNotEmpty()
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;
}
