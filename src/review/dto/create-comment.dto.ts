import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SelectionDto {
  @ApiProperty({ example: 10, description: 'Start index of selected text' })
  @IsInt()
  @Min(0)
  startIndex!: number;

  @ApiProperty({ example: 30, description: 'End index of selected text' })
  @IsInt()
  @Min(0)
  endIndex!: number;
}

export class CreateReviewCommentDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Existing thread ID (omit to create new thread)',
  })
  @IsUUID()
  @IsOptional()
  threadId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Parent comment ID for replies',
  })
  @IsUUID()
  @IsOptional()
  parentCommentId?: string;

  @ApiPropertyOptional({
    example: 123,
    description: 'Message ID (required when creating new thread)',
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  messageId?: number;

  @ApiPropertyOptional({
    type: SelectionDto,
    description: 'Text selection data (required for new threads)',
  })
  @ValidateNested()
  @Type(() => SelectionDto)
  @IsOptional()
  selection?: SelectionDto;

  @ApiProperty({
    example: 'This is a great review comment!',
    description: 'Comment content (always required)',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreatedCommentEntityDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: '2026-01-23T12:34:56.000Z' })
  createdAt!: Date;
}

export class CreateCommentResponseDto {
  @ApiProperty({ type: CreatedCommentEntityDto })
  comment?: CreatedCommentEntityDto;

  @ApiProperty({ type: CreatedCommentEntityDto })
  reply?: CreatedCommentEntityDto;

  @ApiProperty({ type: CreatedCommentEntityDto })
  thread?: CreatedCommentEntityDto;
}
