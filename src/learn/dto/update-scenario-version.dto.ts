import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Autosave payload for a draft version. `config` is the full studio form
 * snapshot (an UpdateScenarioDto-shaped object). Stored verbatim on the
 * draft's `config` column; the live scenario is untouched until publish.
 */
export class UpdateScenarioVersionDto {
  @ApiPropertyOptional({
    description: 'Rename the version',
    example: 'warmer opener v2',
  })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Full editable scenario configuration snapshot (UpdateScenarioDto shape)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}
