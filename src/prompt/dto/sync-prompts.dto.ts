import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
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

  @ApiPropertyOptional({ description: 'Prompt category used for dashboard filtering' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Prompt content (template)' })
  @IsString()
  prompt!: string;

  @ApiPropertyOptional({
    description: 'Variable placeholders in the prompt (e.g. {var_name})',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableVariables?: string[];

  @ApiPropertyOptional({ description: 'Kind of prompt (e.g. block)' })
  @IsOptional()
  @IsString()
  kind?: string;

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
