import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateScenarioSessionReviewDto {
  @ApiProperty({
    description: 'The ID of the scenario session',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  scenarioSessionId!: string;

  @ApiProperty({
    description: 'Optional note to provide context for reviewers',
    example: 'I struggled with the empathy section and would like feedback.',
    required: false,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateScenarioSessionReviewResponseDto {
  @ApiProperty({ description: 'The ID of the review' })
  id!: string;
}
