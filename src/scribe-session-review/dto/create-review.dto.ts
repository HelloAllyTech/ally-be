import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateScribeSessionReviewDto {
  @ApiProperty({
    description: 'The ID of the scribe session',
    example: 1,
  })
  @IsNumber()
  @IsNotEmpty()
  scribeSessionId!: number;

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

export class CreateScribeSessionReviewResponseDto {
  @ApiProperty({ description: 'The ID of the review' })
  id!: string;
}
