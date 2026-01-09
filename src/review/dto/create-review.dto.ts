import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    description: 'The ID of the scenario session',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  scenarioSessionId!: string;
}

export class CreateReviewResponseDto {
  @ApiProperty({ description: 'The ID of the review' })
  id!: string;
}
