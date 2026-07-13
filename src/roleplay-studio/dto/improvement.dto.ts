import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { RehearsalTraineeProfile } from '../enum/rehearsal-status.enum';
import { IMPROVEMENT_MAX_ROUNDS_LIMIT } from '../constants/roleplay-studio.constants';

export class ImprovementTargetsDto {
  @ApiPropertyOptional({ description: 'Minimum judged overall (0-100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minOverall?: number;

  @ApiPropertyOptional({
    description:
      'Per-dimension minimums, e.g. { disclosure_discipline: 80 } (0-100)',
  })
  @IsOptional()
  @IsObject()
  minDimensions?: Record<string, number>;

  @ApiPropertyOptional({
    description:
      'Every selected agent test case must be PASSED (deterministic primary gate)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  requireAllTestCasesPass?: boolean;
}

export class StartImprovementRunDto {
  @ApiPropertyOptional({ default: 3, maximum: IMPROVEMENT_MAX_ROUNDS_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(IMPROVEMENT_MAX_ROUNDS_LIMIT)
  maxRounds?: number;

  @ApiPropertyOptional({ type: ImprovementTargetsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImprovementTargetsDto)
  targets?: ImprovementTargetsDto;

  @ApiPropertyOptional({
    description: 'Agent test cases every round exercises (snapshotted)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  agentTestCaseIds?: string[];

  @ApiPropertyOptional({
    enum: RehearsalTraineeProfile,
    isArray: true,
    description: 'Omitted → all three profiles',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RehearsalTraineeProfile, { each: true })
  traineeProfiles?: RehearsalTraineeProfile[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  turnsPerProfile?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({ description: 'LLM judge model override' })
  @IsOptional()
  @IsString()
  judgeModel?: string;

  @ApiPropertyOptional({
    description:
      'Intermediate rounds re-rehearse only the failing profiles/test cases ' +
      '(the final verification round always runs the full scope)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  cheapIntermediateRounds?: boolean;
}

export class ResolveImprovementRunDto {
  @ApiPropertyOptional({
    description:
      "Optimistic-concurrency token: the draft's updatedAt observed by the " +
      'client. A mismatch 409s so the trainer can confirm overwriting a ' +
      'draft that changed during the loop. Omit to force.',
  })
  @IsOptional()
  @IsString()
  expectedDraftUpdatedAt?: string;
}
