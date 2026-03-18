import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usesBlocks?: string[];
}
