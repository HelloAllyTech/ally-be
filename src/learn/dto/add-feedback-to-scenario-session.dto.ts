import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'Tags selected by the user (free-form, multi-select)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  tags?: string[];
}
