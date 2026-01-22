import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateReviewCommentDto {
  @ApiProperty({
    description: 'Updated content of the review comment',
    example: 'This is an updated review comment',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;
}
