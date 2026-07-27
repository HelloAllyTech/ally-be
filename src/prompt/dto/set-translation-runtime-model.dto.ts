import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for setting the per-language runtime model that runs the main agent when
 * a translated prompt body is served. Empty/omitted clears the override (back to
 * the prompt's own model). Provider is sent alongside model (derived client-side)
 * so the runtime doesn't have to infer it.
 */
export class SetTranslationRuntimeModelDto {
  @ApiProperty({
    description:
      "Provider for the runtime model ('openai' | 'gemini'). Empty clears the override.",
    required: false,
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({
    description:
      'Model that runs the main agent for this language when the translated body is served (e.g. "gemini-2.5-pro"). Empty clears the override.',
    required: false,
  })
  @IsOptional()
  @IsString()
  model?: string;
}
