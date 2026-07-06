import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePromptDto {
  @ApiProperty({ description: 'Prompt code', required: false })
  @IsOptional()
  @IsString()
  promptCode?: string;

  @ApiProperty({ description: 'Prompt name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Prompt description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Prompt category', required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Prompt content', required: false })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({
    description:
      'When true, use prompt from dashboard (DB). When false, use prompt from folder.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  useDashboardOverride?: boolean;

  @IsOptional()
  @IsString()
  kind?: string;

  @ApiProperty({
    description:
      'Role/category of this prompt in the agent pipeline. Examples: ' +
      "'main_agent', 'branching', 'multilingual'. Variants share the same " +
      'promptType.',
    required: false,
  })
  @IsOptional()
  @IsString()
  promptType?: string;

  @ApiProperty({
    description:
      'When true, this prompt declares a States section; the studio shows ' +
      'the state editor and runtime substitutes the matched state’s ' +
      'guidelines into {state_x_guidelines} and gates RAG per state.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasStates?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usesBlocks?: string[];

  @ApiProperty({
    description:
      'Prompt-level LLM provider override ("openai" | "gemini" | "anthropic"). ' +
      'Explicit provider for the model; null/omitted means infer from the model name.',
    required: false,
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({
    description:
      'Prompt-level LLM model override (e.g. "gpt-4o", "gemini-2.0-flash"). ' +
      'Overrides the code/language default for the LLM call site this prompt ' +
      'drives. Only OpenAI/Gemini models are supported by the voice runtime. ' +
      'Null/omitted keeps the existing default.',
    required: false,
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({
    description:
      'Prompt-level LLM sampling temperature override (0–2). Sits below any ' +
      'simulation-level temperature and above the code/language default. ' +
      'Null/omitted keeps the existing default.',
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
