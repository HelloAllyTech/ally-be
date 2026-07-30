import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';

export class RoadmapUserRefDto {
  @ApiProperty() id!: number;
  /** Falls back to a placeholder when the Ally user no longer exists — createdBy has no FK. */
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
}

export class OpportunityResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: RoadmapOpportunityType }) type!: RoadmapOpportunityType;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
  @ApiProperty() productGoal!: string;
  @ApiPropertyOptional({ nullable: true }) owner?: string | null;
  @ApiPropertyOptional({ nullable: true }) prd?: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt?: Date | null;

  /** SUM(coins) over ALL users and ALL periods. Computed in SQL, never stored. */
  @ApiProperty() priorityScore!: number;
  /** The CALLER's coins on this opportunity in the CURRENT period only. */
  @ApiProperty() myCoins!: number;
  @ApiProperty() commentCount!: number;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiPropertyOptional({ type: RoadmapUserRefDto, nullable: true })
  creator?: RoadmapUserRefDto | null;
}

export class GetOpportunitiesResponseDto {
  @ApiProperty({ type: [OpportunityResponseDto] })
  items!: OpportunityResponseDto[];
  @ApiProperty() count!: number;

  /**
   * MAX priority score across ALL non-deleted opportunities — deliberately unfiltered, so the
   * priority bars keep a stable scale when the user applies a filter.
   */
  @ApiProperty() maxScore!: number;

  /** Server-computed 'YYYY-MM'. The client must never derive this itself. */
  @ApiProperty() periodKey!: string;
}

export class CoinBudgetDto {
  @ApiProperty() periodKey!: string;
  @ApiProperty() coinsPerMonth!: number;
  @ApiProperty() used!: number;
  @ApiProperty() remaining!: number;
}

/**
 * Returned by PUT /allocations. Carries BOTH the updated opportunity aggregate and the
 * caller's budget, so the frontend can reconcile its optimistic patch in one round-trip
 * instead of refetching the list (which would stomp an in-flight coin edit).
 */
export class SetAllocationResponseDto {
  @ApiProperty() opportunityId!: string;
  @ApiProperty() periodKey!: string;
  @ApiProperty() coins!: number;
  @ApiProperty() priorityScore!: number;
  @ApiProperty({ type: CoinBudgetDto }) budget!: CoinBudgetDto;
}

export class RoadmapFacetsDto {
  @ApiProperty({ type: [RoadmapUserRefDto] }) creators!: RoadmapUserRefDto[];
  @ApiProperty({ type: [String] }) goals!: string[];
  @ApiProperty({ type: [String] }) owners!: string[];
}

export class DuplicateMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty() productGoal!: string;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
  @ApiProperty({ description: 'Why the model judged this a duplicate' })
  reason!: string;
  @ApiProperty() similarity!: number;
}

export class DuplicatesResponseDto {
  @ApiProperty({ type: [DuplicateMatchDto] }) matches!: DuplicateMatchDto[];
}

export class AiReviewSuggestionDto {
  @ApiProperty() issue!: string;
  @ApiProperty() tip!: string;
}

export class AiReviewResponseDto {
  @ApiProperty({ type: [AiReviewSuggestionDto] })
  suggestions!: AiReviewSuggestionDto[];
}

export class AiEnhanceResponseDto {
  @ApiProperty() enhanced!: string;
}

export class AiTextResponseDto {
  @ApiProperty() text!: string;
}

export class ReindexResponseDto {
  @ApiProperty() queued!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
}
