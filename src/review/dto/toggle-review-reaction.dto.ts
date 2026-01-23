import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ReactionAction } from '../type/review.type';

export class ToggleReviewReactionDto {
  @ApiProperty({
    example: '1f44d',
    description: 'Reaction emoji code',
  })
  @IsString()
  @IsNotEmpty()
  reaction!: string;

  @ApiProperty({
    enum: ReactionAction,
    example: ReactionAction.ADD,
    description: 'Action to perform: add or remove reaction',
  })
  @IsEnum(ReactionAction)
  @IsNotEmpty()
  action!: ReactionAction;
}
