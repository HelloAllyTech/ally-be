import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SKILL_EXPERIMENT_LIMITS as L } from '../constants/skill-experiment.constants';

export class RubricCriterionDto {
  @ApiProperty({
    description: 'Stable id the judge answers under (snake_case).',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,39}$/, {
    message: 'key must be snake_case, start with a letter, up to 40 characters',
  })
  key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'What a 5 looks like, written for the judge.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  description!: string;

  @ApiProperty({ minimum: L.weightMin, maximum: L.weightMax })
  @IsInt()
  @Min(L.weightMin)
  @Max(L.weightMax)
  weight!: number;
}

/**
 * Create or update an experiment's configuration. Every field is optional so
 * the admin form can save one change at a time; a new experiment fills the
 * rest from SKILL_EXPERIMENT_DEFAULTS.
 */
export class ConfigureSkillExperimentDto {
  @ApiPropertyOptional({ type: [RubricCriterionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(L.rubricMin)
  @ArrayMaxSize(L.rubricMax)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  rubric?: RubricCriterionDto[];

  @ApiPropertyOptional({ minimum: L.targetScoreMin, maximum: L.targetScoreMax })
  @IsOptional()
  @IsNumber()
  @Min(L.targetScoreMin)
  @Max(L.targetScoreMax)
  targetScore?: number;

  @ApiPropertyOptional({ minimum: L.minSamplesMin, maximum: L.minSamplesMax })
  @IsOptional()
  @IsInt()
  @Min(L.minSamplesMin)
  @Max(L.minSamplesMax)
  minSamplesPerVariant?: number;

  @ApiPropertyOptional({ minimum: L.trafficMin, maximum: L.trafficMax })
  @IsOptional()
  @IsInt()
  @Min(L.trafficMin)
  @Max(L.trafficMax)
  challengerTrafficPercent?: number;

  @ApiPropertyOptional({ minimum: L.maxVariantsMin, maximum: L.maxVariantsMax })
  @IsOptional()
  @IsInt()
  @Min(L.maxVariantsMin)
  @Max(L.maxVariantsMax)
  maxVariants?: number;

  @ApiPropertyOptional({ minimum: L.maxLossesMin, maximum: L.maxLossesMax })
  @IsOptional()
  @IsInt()
  @Min(L.maxLossesMin)
  @Max(L.maxLossesMax)
  maxConsecutiveLosses?: number;

  @ApiPropertyOptional({
    minimum: L.minImprovementMin,
    maximum: L.minImprovementMax,
  })
  @IsOptional()
  @IsNumber()
  @Min(L.minImprovementMin)
  @Max(L.minImprovementMax)
  minImprovement?: number;

  @ApiPropertyOptional({
    description: 'Judge model id; empty string clears it (task default).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  judgeModel?: string;

  @ApiPropertyOptional({
    description:
      'Designer model id; empty string clears it (prompt/tier default).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  designerModel?: string;
}

export class SkillExperimentObservationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
