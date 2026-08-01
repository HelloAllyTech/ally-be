import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLlmModelDto {
  @ApiProperty({
    example: 'openai',
    description: 'Provider key; must be one the runtimes can execute.',
  })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({
    example: 'gpt-5-mini',
    description: 'Model id passed to the provider.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model!: string;

  @ApiProperty({
    example: 'GPT-5 mini',
    required: false,
    description: 'Picker label; defaults to the model id.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  supportsTemperature?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class UpdateLlmModelDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  provider?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(200)
  model?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  supportsTemperature?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
