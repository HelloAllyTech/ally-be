import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class UpdateLanguageDto {
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
}
