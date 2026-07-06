import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSinglePromptDto {
  @ApiProperty({ description: 'Prompt code (unique identifier)' })
  @IsString()
  @IsNotEmpty()
  promptCode!: string;

  @ApiProperty({ description: 'Prompt name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Prompt description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Prompt category', required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Initial prompt content' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiProperty({
    description:
      'Prompt-level LLM provider override ("openai" | "gemini" | "anthropic"). ' +
      'Null/omitted means infer from the model name.',
    required: false,
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({
    description:
      'Prompt-level LLM model override (e.g. "gpt-4o", "gemini-2.5-flash").',
    required: false,
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({
    description: 'Prompt-level LLM sampling temperature override (0–2).',
    example: 0.7,
    minimum: 0,
    maximum: 2,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
