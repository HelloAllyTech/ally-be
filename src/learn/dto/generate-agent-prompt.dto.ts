import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AGENT_BUILDER_DESCRIPTION_MAX_LENGTH } from '../constants/agent-builder.constants';

export class GenerateAgentPromptDto {
  @ApiProperty({
    description:
      'Free-text description of the mental-health-training roleplay actor to build a system prompt for',
    example:
      'A 28-year-old new mother struggling with postpartum anxiety who is reluctant to admit she needs help.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_BUILDER_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiProperty({
    description:
      'Model override for generation (e.g. gpt-4o, claude-sonnet-4-6)',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'AI provider to use for generation',
    enum: ['openai', 'anthropic'],
    required: false,
    default: 'openai',
  })
  @IsEnum(['openai', 'anthropic'])
  @IsOptional()
  provider?: 'openai' | 'anthropic';
}

export class GenerateAgentPromptResponseDto {
  @ApiProperty({ description: 'The generated comprehensive system prompt' })
  systemPrompt!: string;

  @ApiProperty({ description: 'AI provider used for generation' })
  provider!: string;

  @ApiProperty({ description: 'Model used for generation' })
  model!: string;
}
