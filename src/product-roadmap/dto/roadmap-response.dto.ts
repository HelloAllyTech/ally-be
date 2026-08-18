import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoadmapOpportunitySource,
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
  /** Display name: the linked super-admin's current name, or a legacy migrated string. */
  @ApiPropertyOptional({ nullable: true }) owner?: string | null;

  /** Null for legacy migrated rows whose owner was never linked to an Ally account. */
  @ApiPropertyOptional({ nullable: true }) ownerUserId?: number | null;
  @ApiPropertyOptional({ nullable: true }) prd?: string | null;
  @ApiPropertyOptional({ nullable: true }) claudePrompt?: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt?: Date | null;

  /** The month somebody planned this into, 'YYYY-MM'. Null means Unscheduled. */
  @ApiPropertyOptional({ nullable: true }) plannedMonth?: string | null;

  /** Manual rank within its lane, ascending. Only meaningful against its own lane. */
  @ApiProperty() boardPosition!: number;

  /**
   * The lane the card actually appears in — its release month once shipped, else plannedMonth.
   * Derived, never stored; sent so the client never has to re-implement the rule.
   */
  @ApiPropertyOptional({ nullable: true }) effectiveMonth?: string | null;

  /**
   * True when the lane is a fact rather than a plan, so the card must not be dragged. The client
   * uses this to make the card undraggable instead of letting a drop fail with a 422.
   */
  @ApiProperty() monthPinned!: boolean;

  /** SUM(coins) over ALL users and ALL periods. Computed in SQL, never stored. */
  @ApiProperty() priorityScore!: number;
  /** The CALLER's coins on this opportunity in the CURRENT period only. */
  @ApiProperty() myCoins!: number;
  @ApiProperty() commentCount!: number;

  /** Who filed it — 'staff' (admin /opportunities) or 'consumer' (/bug-reports). Admin display only. */
  @ApiProperty({ enum: RoadmapOpportunitySource })
  source!: RoadmapOpportunitySource;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiPropertyOptional({ type: RoadmapUserRefDto, nullable: true })
  creator?: RoadmapUserRefDto | null;
}

/**
 * The confirmation returned to a consumer who filed a bug report — one-time only, by
 * design (see CreateConsumerBugReportDto's docblock): no "my reports" listing, no full
 * OpportunityResponseDto, since the consumer has no further use for the roadmap fields.
 */
export class ConsumerBugReportResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
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

export class MonthLaneDto {
  @ApiProperty({
    nullable: true,
    description: "'YYYY-MM', or null for the Unscheduled lane",
  })
  month!: string | null;

  @ApiProperty({ type: [OpportunityResponseDto] })
  items!: OpportunityResponseDto[];

  /**
   * How many cards this lane holds in total, which is NOT items.length when laneLimit truncates
   * it. Sent so a truncated lane can say "showing 50 of 63" — a lane that silently stops at its
   * limit is a board that lies about what is planned.
   */
  @ApiProperty() total!: number;
}

export class MonthBoardBoundsDto {
  @ApiProperty({
    nullable: true,
    description:
      'Earliest month any opportunity sits in; null when none are scheduled',
  })
  earliest!: string | null;

  @ApiProperty({ nullable: true }) latest!: string | null;
}

export class MonthBoardResponseDto {
  @ApiProperty({
    type: [MonthLaneDto],
    description:
      'One entry per month in the requested window, INCLUDING empty months — a gap in a plan is ' +
      'information, and collapsing empty lanes would make March look adjacent to June.',
  })
  months!: MonthLaneDto[];

  @ApiProperty({
    type: MonthLaneDto,
    description:
      'Everything with no month. Always present and always returned whole, because this is the ' +
      'lane people drag OUT of and hiding it would make the board unusable on first load.',
  })
  unscheduled!: MonthLaneDto;

  @ApiProperty({ type: MonthBoardBoundsDto })
  bounds!: MonthBoardBoundsDto;

  @ApiProperty({ description: "First month lane in this response, 'YYYY-MM'" })
  from!: string;

  @ApiProperty({ description: "Last month lane in this response, 'YYYY-MM'" })
  to!: string;

  /** Unfiltered MAX(priorityScore) — same stable-scale contract as the table's maxScore. */
  @ApiProperty() maxScore!: number;

  /** Server-computed 'YYYY-MM' coin period. The client must never derive this itself. */
  @ApiProperty() periodKey!: string;

  @ApiProperty({
    description:
      'True when the board hit its global row bound and some lanes are incomplete beyond their ' +
      'reported totals. Surfaced rather than swallowed.',
  })
  truncated!: boolean;
}

export class MonthBoardMoveResponseDto {
  @ApiProperty() opportunityId!: string;
  @ApiProperty({ nullable: true }) plannedMonth!: string | null;
  @ApiProperty({ nullable: true }) effectiveMonth!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'The ids whose position was actually rewritten, in their new order. Excludes ids the ' +
      'client sent that no longer belong to this lane, so a stale drag is visible as a short list ' +
      'rather than a silent success.',
  })
  reordered!: string[];
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

export class PruneVectorsResponseDto {
  @ApiProperty({ description: 'Ids enumerated in the vector index' })
  scanned!: number;

  @ApiProperty({
    description: 'Vectors with no Postgres row at all, deleted by this run',
  })
  orphansDeleted!: number;

  @ApiProperty({
    description: 'Orphans found but whose delete call failed; retry the sweep',
  })
  failed!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Set when the sweep REFUSED to delete anything. A high orphan ratio means the id set we ' +
      'diffed against was probably incomplete, and deleting on that basis would destroy good ' +
      'vectors. Nothing was deleted; investigate and re-run.',
  })
  abortedReason!: string | null;
}

export class RoadmapEligibleOwnerDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

export class RoadmapImportCheckDto {
  @ApiProperty() check!: string;
  @ApiProperty() expected!: string;
  @ApiProperty() actual!: string;
  @ApiProperty() ok!: boolean;
}

export class RoadmapImportResultDto {
  @ApiProperty({
    description:
      'True only when the data is durably written. False for a dry run AND for any failure.',
  })
  committed!: boolean;

  @ApiProperty() dryRun!: boolean;

  @ApiProperty({ type: [RoadmapImportCheckDto] })
  checks!: RoadmapImportCheckDto[];

  @ApiProperty({
    type: [RoadmapImportCheckDto],
    description:
      'Empty on success. Non-empty means the transaction was rolled back.',
  })
  failedChecks!: RoadmapImportCheckDto[];

  @ApiProperty({
    type: [String],
    description: 'The same progress output the CLI prints.',
  })
  log!: string[];
}
