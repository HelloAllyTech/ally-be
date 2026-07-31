import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Request body for the provider-config registries (STT, LLM).
 *
 * Deliberately thin: `provider` and `config` are validated against that
 * registry's field schema in ProviderConfigService, not here. A DTO can only
 * check a field in isolation, but the rules are cross-field — which keys are
 * required depends on which provider was chosen — so encoding them here would
 * mean either a custom constraint per registry or fixed fields that silently
 * drift from the runtime. One schema, one validator.
 */
export class CreateProviderConfigDto {
  @ApiProperty({
    description:
      'Label shown in the Languages and simulation pickers. Must be unique within the registry.',
    example: 'ElevenLabs — Scribe v2 (realtime)',
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description:
      'Provider key. Validated against the registry schema — an unsupported provider is rejected with the supported list.',
    example: 'elevenlabs',
  })
  @IsString()
  provider!: string;

  @ApiProperty({
    description:
      'Provider settings forwarded verbatim to ally-ai-learn. Required keys depend on the provider.',
    example: { model: 'scribe_v2_realtime' },
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  config!: Record<string, any>;

  @ApiProperty({
    description:
      'Inactive configs stay resolvable for anything already pointing at them but drop out of the pickers.',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class UpdateProviderConfigDto {
  @ApiProperty({
    example: 'ElevenLabs — Scribe v2 (realtime)',
    required: false,
  })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'elevenlabs', required: false })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({
    example: { model: 'scribe_v2_realtime' },
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
