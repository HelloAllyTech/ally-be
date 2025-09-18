import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class AddFeedbackToScenarioSessionRequestDto {
  @ApiProperty({
    description: 'The rating for the scenario session(1-5)',
    minimum: 1,
    maximum: 5,
    required: true,
  })
  @Min(1)
  @Max(5)
  @IsNumber()
  rating!: number;

  @ApiProperty({ description: 'The feedback for the scenario session' })
  @IsOptional()
  @IsString()
  feedback?: string;
}
