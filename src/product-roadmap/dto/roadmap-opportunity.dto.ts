import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';

/**
 * Comma-separated OR repeated query params both arrive here; normalise to an array so
 * `?stage=new&stage=released` and `?stage=new,released` behave identically.
 */
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(','));
  return String(value).split(',');
};

export class ListOpportunitiesQueryDto {
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
  @Transform(toArray)
  @IsArray()
  @Type(() => Number)
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

  /** Explicit null clears the owner. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  owner?: string | null;

  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.PRD_MAX, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.PRD_MAX)
  prd?: string | null;
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
