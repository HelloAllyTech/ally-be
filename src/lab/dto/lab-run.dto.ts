import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One variable's chosen value for a run. */
export class LabRunVariableValueDto {
  @ApiProperty({ description: 'Variable name (as referenced by {{name}})' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'The value to substitute for the variable' })
  @IsString()
  value!: string;
}

/**
 * Executes ONE skill. A multi-skill "Run" is submitted as several of these
 * (one per skill), optionally sharing a `batchId`, and each produces its own
 * runs-log row.
 */
export class CreateLabRunDto {
  @ApiProperty({ description: 'The skill to run' })
  @IsUUID()
  skillId!: string;

  @ApiPropertyOptional({
    description: 'Groups the rows from a single multi-skill run submission',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description: 'Chosen value for every variable referenced by the skill',
    type: [LabRunVariableValueDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabRunVariableValueDto)
  variableValues?: LabRunVariableValueDto[];
}
