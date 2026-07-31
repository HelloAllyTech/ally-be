import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsObject,
  IsNumber,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { TtsProvider } from '../enum/tts-provider.enum';

export class UpdateScenarioVoiceDto {
  @ApiProperty({
    description: 'Name of the scenario voice',
    example: 'Scenario Voice 1',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description:
      'TTS provider. Only providers the voice agent can dispatch to are ' +
      'accepted. Case-insensitive on write, normalised to upper-case.',
    enum: TtsProvider,
    example: TtsProvider.SARVAM,
    required: false,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(TtsProvider, {
    message: `provider must be one of: ${Object.values(TtsProvider).join(', ')}`,
  })
  @IsOptional()
  provider?: TtsProvider;

  @ApiProperty({
    description:
      'Provider-specific config. Validated against VOICE_CONFIG_SCHEMA ' +
      'using the incoming provider, or the stored one when omitted.',
    example: {
      gender: 'male',
      model: 'bulbul:v2',
      speaker: 'abhilash',
    },
    required: false,
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiProperty({
    description: 'Language ID for the scenario voice',
    example: 1,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  languageId?: number;

  @ApiProperty({
    description: 'Whether the scenario voice is active for calls',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
