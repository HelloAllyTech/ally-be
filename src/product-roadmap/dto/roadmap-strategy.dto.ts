import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';

export class CreateStrategyGoalDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.STRATEGY_GOAL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.STRATEGY_GOAL_NAME_MAX)
  name!: string;
}

export class RenameStrategyGoalDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.STRATEGY_GOAL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.STRATEGY_GOAL_NAME_MAX)
  name!: string;
}

export class ReorderStrategyGoalsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}

/**
 * Every weight is OPTIONAL so the settings UI can PATCH one slider without restating the other
 * three — a full-replacement body would make two admins tuning different factors overwrite each
 * other's work.
 *
 * The 0-10 range matches the CHECK. Zero is legal for any single factor (turning one lens off is
 * a real choice); all four at zero is rejected by the service with a readable message.
 */
export class UpdateRankWeightsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  votesWeight?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  votersWeight?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  effortWeight?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  goalImpactWeight?: number;
}

export class StrategyGoalDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() position!: number;
  /**
   * Rankable opportunities with no verdict against this goal yet. Non-zero means the board is
   * ranking with an incomplete numerator over a full denominator — i.e. scoring low for a
   * reason that has nothing to do with the opportunities themselves.
   */
  @ApiProperty() unassessed!: number;
}

export class StrategyGoalsResponseDto {
  @ApiProperty({ type: [StrategyGoalDto] }) goals!: StrategyGoalDto[];
  /** Rankable opportunities missing at least one verdict, across all goals. */
  @ApiProperty() needingAssessment!: number;
}

export class RankWeightsResponseDto {
  @ApiProperty() votesWeight!: number;
  @ApiProperty() votersWeight!: number;
  @ApiProperty() effortWeight!: number;
  @ApiProperty() goalImpactWeight!: number;
}

export class GoalImpactVerdictDto {
  @ApiProperty() goalName!: string;
  @ApiProperty() helped!: boolean;
  @ApiPropertyOptional({ nullable: true }) reason?: string | null;
  @ApiProperty() assessedAt!: Date;
}

export class BulkAssessResponseDto {
  @ApiProperty() assessed!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({
    description:
      'Still missing at least one verdict after this run. Non-zero means run it again — the ' +
      'run is bounded so one request cannot bill the whole board.',
  })
  remaining!: number;
}
