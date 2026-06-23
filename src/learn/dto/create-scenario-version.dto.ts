import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateScenarioVersionDto {
  @ApiPropertyOptional({
    description: 'Optional human label for the new version',
    example: 'warmer opener',
  })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Version to branch from. Its config is cloned into the new draft. ' +
      'Defaults to the published version, or the live scenario state if none.',
  })
  @IsUUID()
  @IsOptional()
  fromVersionId?: string;

  @ApiPropertyOptional({
    description:
      'Create a blank draft authored from scratch (no cloned data). Takes ' +
      'precedence over fromVersionId.',
  })
  @IsBoolean()
  @IsOptional()
  empty?: boolean;
}
