import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateDebriefFeedbackDto {
  @ApiProperty({
    description: 'Rating of the debrief',
    enum: ['positive', 'negative'],
    example: 'positive',
  })
  @IsEnum(['positive', 'negative'])
  rating!: 'positive' | 'negative';

  @ApiProperty({
    description: 'Optional comment from the user',
    example: 'Very helpful feedback!',
    required: false,
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
