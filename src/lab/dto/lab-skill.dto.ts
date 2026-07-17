import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
