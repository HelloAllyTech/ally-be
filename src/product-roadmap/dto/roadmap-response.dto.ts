import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoadmapBoardGroupBy,
  RoadmapOpportunityEffort,
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
  @ApiProperty({
    description:
      "Short human-quotable id, e.g. 'OPP-0042'. Unique, never reused.",
  })
  code!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Position in the queue (New / Prioritised / In development) by total votes — 1-based, ' +
      'unique, and null outside those stages. Computed per read, so it always reflects the ' +
      'current stages and vote totals.',
  })
  queueRank!: number | null;
  @ApiPropertyOptional({ nullable: true }) claudePrompt?: string | null;
  /** The Builder session started from this opportunity, or null. Drives the drawer's
   *  button between "Open in Builder Agent" and "Resume in Builder Agent". */
  @ApiPropertyOptional({ nullable: true }) builderSessionId?: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt?: Date | null;

  /** The month somebody planned this into, 'YYYY-MM'. Null means Unscheduled. */
  @ApiPropertyOptional({ nullable: true }) plannedMonth?: string | null;

  /** Rough size — S/M/L/XL/XXL. Null means nobody has sized it. */
  @ApiPropertyOptional({ nullable: true, enum: RoadmapOpportunityEffort })
  effort?: RoadmapOpportunityEffort | null;

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

  /** SUM(votes) over ALL users and ALL periods. Computed in SQL, never stored. */
  @ApiProperty() priorityScore!: number;
  /** The CALLER's votes on this opportunity in the CURRENT period only. */
  @ApiProperty() myVotes!: number;
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
 * The confirmation returned to whoever filed a bug report — one-time only, by design (see
 * CreateBugReportDto's docblock): no "my reports" listing, no full OpportunityResponseDto,
 * since a reporter has no further use for the roadmap fields. Staff track their report in
 * Bug Hunter's findings table, where it lands, rather than back on this form.
 */
export class BugReportResponseDto {
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

/**
 * One lane on the generic board.
 *
 * Supersedes MonthLaneDto's shape for every grouping including month — `key` is the month for a
 * month board, the stage/goal/owner value otherwise, and null is always the catch-all lane
 * (Unscheduled, or No goal / No owner). `label` is resolved server-side so the client is not
 * left mapping raw enum values, and so an empty lane can still be named.
 */
export class BoardLaneDto {
  @ApiProperty({
    nullable: true,
    description:
      "Lane value: 'YYYY-MM' for month, the stage/goal/owner value otherwise. Null is the " +
      'catch-all lane.',
  })
  key!: string | null;

  @ApiProperty({ type: [OpportunityResponseDto] })
  items!: OpportunityResponseDto[];

  @ApiProperty({ description: "The lane's true size, ignoring laneLimit" })
  total!: number;
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
    enum: RoadmapBoardGroupBy,
    description: 'The grouping these lanes were built with',
  })
  groupBy!: RoadmapBoardGroupBy;

  @ApiProperty({
    type: [BoardLaneDto],
    description:
      'Every lane, in display order, INCLUDING empty ones — a gap is information, and ' +
      'collapsing empty lanes would make March look adjacent to June (and would hide a product ' +
      'goal nobody is working on, which is the same fact about a different axis).\n\n' +
      'The catch-all (key: null) comes FIRST when grouping by month, because Unscheduled is the ' +
      'lane people drag out of and it has always been the leftmost. It comes LAST for the other ' +
      'groupings, where "no goal" / "no owner" is a residue rather than a starting point.',
  })
  lanes!: BoardLaneDto[];

  @ApiProperty({ type: MonthBoardBoundsDto })
  bounds!: MonthBoardBoundsDto;

  @ApiProperty({ description: "First month lane in this response, 'YYYY-MM'" })
  from!: string;

  @ApiProperty({ description: "Last month lane in this response, 'YYYY-MM'" })
  to!: string;

  /** Unfiltered MAX(priorityScore) — same stable-scale contract as the table's maxScore. */
  @ApiProperty() maxScore!: number;

  /** Server-computed 'YYYY-MM' vote period. The client must never derive this itself. */
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

export class VoteBudgetDto {
  @ApiProperty() periodKey!: string;
  @ApiProperty() votesPerMonth!: number;
  @ApiProperty() used!: number;
  @ApiProperty() remaining!: number;
}

/**
 * Returned by PUT /allocations. Carries BOTH the updated opportunity aggregate and the
 * caller's budget, so the frontend can reconcile its optimistic patch in one round-trip
 * instead of refetching the list (which would stomp an in-flight vote).
 */
export class SetAllocationResponseDto {
  @ApiProperty() opportunityId!: string;
  @ApiProperty() periodKey!: string;
  @ApiProperty() votes!: number;
  @ApiProperty() priorityScore!: number;
  @ApiProperty({ type: VoteBudgetDto }) budget!: VoteBudgetDto;
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

export class AiReadinessCriterionDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() hint!: string;
}

export class AiReadinessCriteriaResponseDto {
  @ApiProperty({ type: [AiReadinessCriterionDto] })
  criteria!: AiReadinessCriterionDto[];
}

export class AiReadinessResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() passed!: boolean;
  @ApiProperty() reason!: string;
}

export class AiReadinessResponseDto {
  /** One entry per criterion, in the order the criteria are defined. */
  @ApiProperty({ type: [AiReadinessResultDto] })
  results!: AiReadinessResultDto[];

  /**
   * A proposed size for the same draft, from the same call — null when the model gives
   * anything that is not a live effort value. A proposal, not a decision: the filer can
   * override it in the drawer before filing, and anyone can change it afterwards.
   */
  @ApiProperty({ enum: RoadmapOpportunityEffort, nullable: true })
  effort!: RoadmapOpportunityEffort | null;

  /** One sentence on why that size. Empty when there is no size to explain. */
  @ApiProperty() effortReason!: string;
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

/**
 * The result of pressing "Open in Builder Agent".
 *
 * `created` is the whole contract for whether the client seeds the interview: on a resume the
 * transcript already has the brief in it, and sending it again would open the session with the
 * same paragraph twice and the agent responding to the repeat. `seedMessage` is null in that case
 * for the same reason — there is nothing to send.
 */
export class OpenBuilderSessionResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty({
    description:
      'True only when this call created the session, so the client must seed it',
  })
  created!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The opening brief to send, when created',
  })
  seedMessage!: string | null;
}
