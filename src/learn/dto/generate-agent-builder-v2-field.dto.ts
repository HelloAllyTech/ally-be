import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AgentBuilderV2Field } from '../enum/agent-builder-v2-field.enum';

/**
 * One parallel field-generation call for Agent Builder Copilot V2. The frontend
 * fires one of these per target field (role instruction, title, challenge
 * description, knowledge sources, persona) concurrently, each rendering its own
 * editable prompt template with the shared runtime variables below.
 */
export class GenerateAgentBuilderV2FieldDto {
  @ApiProperty({
    description: 'Which Basic Settings field to generate',
    enum: AgentBuilderV2Field,
    example: AgentBuilderV2Field.TITLE,
  })
  @IsEnum(AgentBuilderV2Field)
  @IsNotEmpty()
  field!: AgentBuilderV2Field;

  @ApiProperty({
    description: 'Free-text "Describe roleplay actor" brief from the wizard',
  })
  @IsString()
  @IsNotEmpty()
  actorDescription!: string;

  @ApiProperty({
    description: 'Selected competency name (steers generation)',
    required: false,
  })
  @IsString()
  @IsOptional()
  competency?: string;

  @ApiProperty({
    description:
      'Selected optimisation goals as a human-readable, comma-joined string',
    required: false,
  })
  @IsString()
  @IsOptional()
  optimisationGoals?: string;

  @ApiProperty({
    description:
      'Number of knowledge source documents to produce (only used by the ' +
      'knowledge_sources field). Defaults to 3.',
    required: false,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  numKnowledgeSources?: number;

  @ApiProperty({
    description: 'Model override for generation',
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

export class GenerateAgentBuilderV2FieldResponseDto {
  @ApiProperty({ enum: AgentBuilderV2Field })
  field!: AgentBuilderV2Field;

  @ApiProperty({
    description:
      'Parsed field value. Shape depends on `field`: string for ' +
      'role_instruction / title / challenge_description; ' +
      '{name,age,gender,profession,currentLocation} for persona; ' +
      '[{title,content}] for knowledge_sources.',
  })
  value!: unknown;
}
