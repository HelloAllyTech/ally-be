import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty({
    description: 'Feedback content or comment',
    example: 'This feature was very helpful!',
    required: false,
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({
    description: 'Whether the user found the response helpful',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isHelpful?: boolean;

  @ApiProperty({
    description: 'Numerical rating (e.g. 1-5)',
    example: 5,
    minimum: 1,
    maximum: 5,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  rating?: number;
}
