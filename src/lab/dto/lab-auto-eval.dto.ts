import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAutoEvalDto {
  @ApiProperty({
    description:
      'The rubric / criteria the LLM judge scores the run output against.',
  })
  @IsString()
  @IsNotEmpty()
  criteria!: string;

  @ApiPropertyOptional({
    description:
      'Judge model id (from the LLM registry). Omit for the AI Lab default.',
  })
  @IsOptional()
  @IsString()
  model?: string;
}
