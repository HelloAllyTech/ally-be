import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import {
  ROADMAP_BOARD_DEFAULTS,
  ROADMAP_LIMITS,
} from '../constants/product-roadmap.constants';

/**
 * 'YYYY-MM'. Mirrors CHK_roadmap_opps_planned_month, so a bad month is a friendly 400 here and
 * an impossible row there.
 */
const MONTH_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_KEY_MESSAGE = "must be a month key in 'YYYY-MM' form, e.g. 2026-09";

/**
 * Comma-separated OR repeated query params both arrive here; normalise to an array so
 * `?stage=new&stage=released` and `?stage=new,released` behave identically.
 */
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(','));
  return String(value).split(',');
};

/**
 * toArray, coerced to numbers.
 *
 * `@Type(() => Number)` does NOT do this when `@Transform` is also on the property:
 * class-transformer lets the explicit transform win, so the value stayed an array of STRINGS and
 * `@IsInt({ each: true })` rejected even `?createdBy=1` with a 400. The creator filter was
 * therefore unusable from the moment it was added — caught when building its UI.
 *
 * Non-numeric input is passed through untouched so @IsInt still produces its own clear message
 * rather than this silently turning junk into NaN.
 */
const toIntArray = ({ value }: { value: unknown }): unknown => {
  const parsed = toArray({ value });
  if (parsed === undefined) return undefined;
  return (parsed as unknown[]).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  });
};

/**
 * Every filter the board understands, shared by BOTH layouts.
 *
 * Extracted rather than duplicated so the table and the month board cannot drift apart: the
 * filter chips are rendered once on the frontend and sent to whichever endpoint is active, and a
 * field that existed on only one of these would silently stop filtering when the user flipped
 * the layout toggle. Sorting and pagination are NOT here — those are layout-specific (the month
 * board orders by lane position and pages by month, not by offset).
 */
export class RoadmapOpportunityFiltersDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring of the description',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: RoadmapOpportunityType, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(RoadmapOpportunityType, { each: true })
  type?: RoadmapOpportunityType[];

  @ApiPropertyOptional({ enum: RoadmapOpportunityStage, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(RoadmapOpportunityStage, { each: true })
  stage?: RoadmapOpportunityStage[];

  /** Who filed it — 'staff' (the admin /opportunities path) or 'consumer' (/bug-reports). */
  @ApiPropertyOptional({ enum: RoadmapOpportunitySource, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(RoadmapOpportunitySource, { each: true })
  source?: RoadmapOpportunitySource[];

  @ApiPropertyOptional({
    description: 'Product goal NAMES (not ids)',
    isArray: true,
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  productGoal?: string[];

  @ApiPropertyOptional({ description: 'Owner NAMES (not ids)', isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  owner?: string[];

  @ApiPropertyOptional({
    description: 'Ally user ids of the creators',
    isArray: true,
  })
  @IsOptional()
  @Transform(toIntArray)
  @IsArray()
  @IsInt({ each: true })
  createdBy?: number[];

  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() releasedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() releasedTo?: string;

  @ApiPropertyOptional({ description: 'Minimum priority score (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priorityMin?: number;

  @ApiPropertyOptional({ description: 'Maximum priority score (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priorityMax?: number;
}

export class ListOpportunitiesQueryDto extends RoadmapOpportunityFiltersDto {
  @ApiPropertyOptional({
    enum: ['priority', 'createdAt', 'releasedAt', 'myCoins', 'description'],
    default: 'priority',
  })
  @IsOptional()
  @IsEnum(['priority', 'createdAt', 'releasedAt', 'myCoins', 'description'])
  sortBy?: 'priority' | 'createdAt' | 'releasedAt' | 'myCoins' | 'description';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateOpportunityDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({
    enum: RoadmapOpportunityType,
    default: RoadmapOpportunityType.IDEA,
  })
  @IsOptional()
  @IsEnum(RoadmapOpportunityType)
  type?: RoadmapOpportunityType;

  @ApiProperty({ description: 'Product goal NAME; must already exist' })
  @IsString()
  @MinLength(1)
  productGoal!: string;
}

/**
 * Auto-captured client context for a consumer bug report, sent verbatim by the app —
 * ally-be does not infer any of this beyond a User-Agent fallback in the controller.
 * Stored as-is in `roadmap_opportunities.reporterContext` (jsonb), admin-visible only.
 * Every field is optional: an app that cannot determine one just omits it.
 */
export class ReporterContextDto {
  @ApiPropertyOptional({
    description: 'Screen or route name the report was filed from',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  screen?: string;

  @ApiPropertyOptional({ description: 'Calling app version/build string' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appVersion?: string;

  @ApiPropertyOptional({ description: 'Device model, e.g. "iPhone 15"' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  device?: string;

  @ApiPropertyOptional({ description: 'OS name/version, e.g. "iOS 18.1"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  os?: string;

  @ApiPropertyOptional({
    description: "The client's local timestamp, ISO 8601",
  })
  @IsOptional()
  @IsISO8601()
  clientTimestamp?: string;
}

/**
 * A bug report filed by any logged-in user — a consumer in web/mobile/helpline, or a staff
 * member using the admin roadmap's "Report a bug" button. POST /product-roadmap/bug-reports.
 *
 * Deliberately NOT CreateOpportunityDto: `type` is always forced to BUG server-side and
 * every board-oriented field (productGoal, owner, prd, claudePrompt, …) is irrelevant to a
 * bug now that bugs are triaged in Bug Hunter rather than voted on, so accepting them would
 * just be dead input no client could legitimately send.
 *
 * No severity/category picker by design — this is the answer to one guided prompt
 * ("What were you trying to do?"), not a support ticket form.
 */
export class CreateBugReportDto {
  @ApiProperty({
    maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX,
    description: 'Free text answer to "What were you trying to do?"',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({ type: ReporterContextDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ReporterContextDto)
  context?: ReporterContextDto;
}

/**
 * Note `stage` IS updatable here and the endpoint is gated on edit:admin:product-roadmap.
 * That means the AUTHOR of an opportunity cannot fix their own typo unless they also hold
 * edit: — a faithful port of the source's RLS (UPDATE was admin-only), flagged deliberately
 * because it is the most likely "is that intentional?" question in review. If the answer is
 * no, the fix is a description-only patch path with an author-or-manager check.
 */
export class UpdateOpportunityDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({ enum: RoadmapOpportunityType })
  @IsOptional()
  @IsEnum(RoadmapOpportunityType)
  type?: RoadmapOpportunityType;

  @ApiPropertyOptional({ enum: RoadmapOpportunityStage })
  @IsOptional()
  @IsEnum(RoadmapOpportunityStage)
  stage?: RoadmapOpportunityStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  productGoal?: string;

  /**
   * Assign the owner by Ally user id. Explicit null un-assigns.
   *
   * An owner must be a SUPER_ADMIN / SUPER_DUPER_ADMIN user — the service rejects anyone else, so
   * this cannot be used to point an opportunity at an arbitrary account. The legacy free-text
   * `owner` field is deliberately NOT writable any more: accepting both would let a caller set a
   * display name that disagrees with the linked user.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'Ally user id of a super-admin; null un-assigns',
  })
  @IsOptional()
  @IsInt()
  ownerUserId?: number | null;

  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.PRD_MAX, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.PRD_MAX)
  prd?: string | null;

  @ApiPropertyOptional({
    maxLength: ROADMAP_LIMITS.CLAUDE_PROMPT_MAX,
    nullable: true,
    description:
      'AI-generated Claude Code implementation prompt, saved verbatim alongside the rest of ' +
      'the opportunity.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.CLAUDE_PROMPT_MAX)
  claudePrompt?: string | null;

  /**
   * Plan this into a month, as 'YYYY-MM'. Explicit null moves it back to Unscheduled.
   *
   * Rejected with 422 once the opportunity has actually shipped — a released card's lane is its
   * release month, which is a fact rather than a plan. The board enforces the same rule on drag,
   * via isMonthPinned; this path exists so the drawer can schedule something without a drag.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: "Planned month as 'YYYY-MM'; null moves it to Unscheduled",
  })
  @IsOptional()
  @Matches(MONTH_KEY_REGEX, { message: `plannedMonth ${MONTH_KEY_MESSAGE}` })
  plannedMonth?: string | null;
}

/**
 * The month board read. Same filters as the table, but windowed by month instead of paginated by
 * offset — a lane has to be COMPLETE to be honest, and an offset window would fill the first
 * lane and leave the rest looking empty.
 */
export class MonthBoardQueryDto extends RoadmapOpportunityFiltersDto {
  @ApiPropertyOptional({
    description:
      "First month lane, 'YYYY-MM'. Defaults to one month before the current month.",
  })
  @IsOptional()
  @Matches(MONTH_KEY_REGEX, { message: `from ${MONTH_KEY_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({
    description:
      "Last month lane, 'YYYY-MM'. Defaults to four months after the current month.",
  })
  @IsOptional()
  @Matches(MONTH_KEY_REGEX, { message: `to ${MONTH_KEY_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({
    default: ROADMAP_BOARD_DEFAULTS.LANE_LIMIT,
    description:
      'Cards returned per lane. Each lane reports its true total regardless, so a truncated ' +
      'lane can say how many it is hiding rather than pretending to be complete.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  laneLimit?: number;
}

/**
 * Drop a card into a lane.
 *
 * `orderedIds` is the FULL resulting order of the destination lane, not a delta — the same
 * whole-array-overwrite shape as PUT views/tab-order and PUT product-goals/order. A delta
 * ("insert after X") reads as cheaper but needs the server to reconstruct the lane it was
 * computed against, and two people dragging in the same lane would interleave into an order
 * neither of them saw. An absolute order is idempotent and the last write plainly wins.
 *
 * Stale ids are tolerated, not rejected: an id that is no longer in this lane is skipped rather
 * than 409'd, because the alternative is a drag that fails because somebody else moved an
 * unrelated card while this one was mid-air.
 */
export class MoveOpportunityDto {
  @ApiProperty()
  @IsUUID()
  opportunityId!: string;

  @ApiProperty({
    nullable: true,
    description:
      "Destination lane as 'YYYY-MM'; null is the Unscheduled lane. Must be sent explicitly.",
  })
  @ValidateIf((o: MoveOpportunityDto) => o.month !== null)
  @IsString()
  @Matches(MONTH_KEY_REGEX, { message: `month ${MONTH_KEY_MESSAGE}` })
  month!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Every card id in the destination lane, in its new top-to-bottom order',
  })
  @IsArray()
  @ArrayMaxSize(ROADMAP_BOARD_DEFAULTS.MAX_LANE_IDS)
  // Plain @IsUUID, matching MergeOpportunitiesDto: migrated ids come from the source database
  // and a version assertion would reject legitimate historical rows.
  @IsUUID(undefined, { each: true })
  orderedIds!: string[];
}

export class SplitPartDto {
  @ApiPropertyOptional({
    description:
      'Set on EXACTLY ONE part — the original opportunity, which is kept and reworded. ' +
      'Omit on every new part.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description!: string;

  @ApiProperty({
    description: 'Relative weight; the coin split is proportional to this',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weight!: number;
}

export class SplitOpportunityDto {
  @ApiProperty({ type: [SplitPartDto], minItems: 2 })
  @IsArray()
  @Type(() => SplitPartDto)
  parts!: SplitPartDto[];
}

export class MergeOpportunitiesDto {
  @ApiProperty({ description: 'The surviving opportunity' })
  @IsUUID()
  primaryId!: string;

  @ApiProperty({
    description: 'Opportunities to fold in and soft-delete',
    type: [String],
  })
  @IsArray()
  // Plain @IsUUID, not version-pinned: migrated ids come from the source database and we do
  // not want a version assertion rejecting legitimate historical rows.
  @IsUUID(undefined, { each: true })
  sourceIds!: string[];

  @ApiPropertyOptional({
    description: "Optional rewrite of the primary's description",
    maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description?: string;
}

/**
 * Setting a coin allocation. Note there is deliberately NO periodKey field: the server
 * computes it in UTC. The source's RLS allowed writes to any period_key, and because the
 * priority score sums every period forever, that was unbounded score inflation; it also used
 * browser-local time, so a tab open across midnight on the 1st voted into the wrong month.
 * Historical periods are read-only by construction.
 *
 * coins = 0 deletes the allocation row rather than storing a zero.
 */
export class SetAllocationDto {
  @ApiProperty()
  @IsUUID()
  opportunityId!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coins!: number;
}
