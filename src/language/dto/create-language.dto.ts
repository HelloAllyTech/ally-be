import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateLanguageDto {
  @ApiProperty({
    description: 'Value of the Language en-IN',
    example: 'en-IN',
  })
  @IsString()
  @IsNotEmpty()
  value!: string;

  @ApiProperty({
    description: 'Label of the Language',
    example: 'English (India)',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Active status of the language',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  active!: boolean;

  @ApiProperty({
    description: 'Google Translation Code for the language',
    example: 'hi',
  })
  @IsString()
  @IsNotEmpty()
  translationCode!: string;

  @ApiProperty({
    description: 'LLM Provider Configuration for the language',
    example: {
      provider: 'openai',
      config: {
        model: 'gpt-4',
      },
    },
  })
  @IsNotEmpty()
  llmProviderConfig?: Record<string, any>;

  @ApiProperty({
    description: 'STT Provider Configuration for the language',
    example: {
      provider: 'google',
      config: {
        model: 'google-cloud-stt-basic',
      },
    },
  })
  @IsNotEmpty()
  sttProviderConfig?: Record<string, any>;

  @ApiProperty({
    description:
      "This language's default STT, referencing an stt_configs registry row. Supersedes sttProviderConfig, which is only read when this is null. Send null to fall back to the legacy column (or, failing that, the platform default).",
    example: '3f1b0c8e-77a1-4d2b-9a55-1c0f6c2e4d90',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  sttConfigId?: string | null;

  @ApiProperty({
    description:
      "This language's default LLM, referencing an llm_configs registry row. Supersedes llmProviderConfig, which is only read when this is null.",
    example: 'd41b0c8e-77a1-4d2b-9a55-1c0f6c2e4d91',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  llmConfigId?: string | null;
}
