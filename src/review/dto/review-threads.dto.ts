import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatedByDto } from './created-user.dto';

export class CommentDto {
  @ApiProperty({ description: 'Comment ID' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  id!: string;

  @ApiProperty({ description: 'Comment content' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({ description: 'Comment creation timestamp' })
  @IsDate()
  @Type(() => Date)
  createdAt!: Date;

  @ApiProperty({
    type: CreatedByDto,
    description: 'User who created the comment',
  })
  @ValidateNested()
  @Type(() => CreatedByDto)
  createdBy!: CreatedByDto;

  @ApiProperty({
    description: 'Reactions map with reaction code as key and count as value',
    example: { thumbsUp: 5, heart: 3 },
  })
  @IsObject()
  @IsOptional()
  reactions?: Record<string, number>;

  @ApiProperty({ description: 'Number of replies to this comment' })
  @IsNumber()
  replyCount!: number;
}

export class ReviewMessageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'This is a message content' })
  content!: string;
}

export class ReviewThreadDto {
  @ApiProperty({ description: 'Thread ID' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  id!: string;

  @ApiProperty({ description: 'Selection of the thread' })
  @IsObject()
  @IsOptional()
  selection?: Record<string, any>;

  @ApiProperty({ type: [CommentDto], description: 'Comments in the thread' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommentDto)
  @IsOptional()
  comments?: CommentDto[];

  @ApiProperty({ description: 'Total number of comments in the thread' })
  @IsNumber()
  commentCount!: number;

  @ApiProperty({ description: 'Message associated with the thread' })
  @ValidateNested()
  @Type(() => ReviewMessageDto)
  @IsOptional()
  message?: ReviewMessageDto;
}

export class ReviewThreadsResponseDto {
  @ApiProperty({
    type: [ReviewThreadDto],
    description: 'Array of review threads',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewThreadDto)
  data!: ReviewThreadDto[];

  @ApiProperty({ description: 'Total number of threads' })
  @IsNumber()
  count!: number;
}
