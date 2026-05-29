import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncPromptItemDto {
  @ApiProperty({
    description: 'Unique prompt code',
    example: 'openai_simulation_character_profile_text',
  })
  @IsString()
  @IsNotEmpty()
  promptCode!: string;

  @ApiProperty({ description: 'Display name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Prompt description' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({
    description: 'Prompt category used for dashboard filtering',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Prompt content (template)' })
  @IsString()
  prompt!: string;

  @ApiPropertyOptional({
    description:
      'Variable placeholders in the prompt. Each entry is either a bare ' +
      'placeholder name (string, legacy) or an object with shape ' +
      '`{ name, label?, required? }` used by the studio for label + ' +
      'mandatoriness rendering.',
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  // Permit both strings and objects; deeper validation happens at the
  // normalize step in the service.
  availableVariables?: (
    | string
    | { name: string; label?: string; required?: boolean }
  )[];

  @ApiPropertyOptional({ description: 'Kind of prompt (e.g. block)' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({
    description:
      'Role/category of this prompt in the agent pipeline. Examples: ' +
      "'main_agent', 'branching', 'multilingual'. Variants share the same " +
      'promptType.',
  })
  @IsOptional()
  @IsString()
  promptType?: string;

  @ApiPropertyOptional({
    description:
      'When true, this prompt declares a States section; the studio renders ' +
      'the state editor and runtime substitutes the matched state guidelines.',
  })
  @IsOptional()
  @IsBoolean()
  hasStates?: boolean;

  @ApiPropertyOptional({
    description: 'List of block codes used by this prompt',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usesBlocks?: string[];
}

export class SyncPromptsDto {
  @ApiProperty({ type: [SyncPromptItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncPromptItemDto)
  prompts!: SyncPromptItemDto[];
}
