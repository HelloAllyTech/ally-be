import { IsString, IsOptional } from 'class-validator';
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
}
