import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewStatus } from '../type/review.type';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateReviewDto {
  @ApiProperty({
    description: 'New status of the review',
    example: ReviewStatus.HIDDEN,
    required: false,
  })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiProperty({
    description:
      'Note to add or edit. Can only be edited within 10 minutes of review creation.',
    example: 'Updated context for reviewers.',
    required: false,
    maxLength: 250,
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  note?: string;
}
