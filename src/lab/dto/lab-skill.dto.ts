import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateLabSkillDto {
  @ApiProperty({ description: 'Display name for the skill' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Short description of what the skill does',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description:
      'The system-prompt template text. May embed {{variable}} placeholders.',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({
    description:
      'LLM model id to run this skill on (from the LLM model registry). Omit for the AI Lab default.',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description:
      'Sampling temperature (0–2). Only applied to models that support it.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ description: 'Output token cap for the run.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32000)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: 'Optional system message sent alongside the resolved prompt.',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

export class UpdateLabSkillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;

  @ApiPropertyOptional({
    description:
      'LLM model id to run this skill on (from the LLM model registry).',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Sampling temperature (0–2).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ description: 'Output token cap for the run.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32000)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: 'Optional system message sent alongside the resolved prompt.',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}
