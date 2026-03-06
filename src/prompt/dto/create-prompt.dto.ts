import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
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

  @ApiProperty({ description: 'Initial prompt content' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;
}
