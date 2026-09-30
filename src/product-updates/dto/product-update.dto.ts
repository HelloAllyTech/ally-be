import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  SUMMARY_MAX,
  TEAM_NOTES_MAX,
  TITLE_MAX,
  UPDATE_AREAS,
  UPDATE_AUDIENCES,
  UPDATE_KINDS,
  UPDATE_SURFACES,
  UpdateArea,
  UpdateAudience,
  UpdateKind,
  UpdateSurface,
} from '../constants/product-update.constants';

const toBoolean = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

// ---- Public ------------------------------------------------------------------

/**
 * Limit/offset are clamped rather than rejected, like the old changelog feed:
 * this endpoint is public, and an unauthenticated caller asking for too much
 * should get a page, not a 400.
 */
export class GetPublicProductUpdatesDto {
  @ApiPropertyOptional({
    description: 'Updates to return (default 30, clamped to 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional({ description: 'Updates to skip (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  offset?: number;

  @ApiPropertyOptional({
    enum: UPDATE_SURFACES,
    description: 'Only updates that show up here',
  })
  @IsOptional()
  @IsIn(UPDATE_SURFACES)
  surface?: UpdateSurface;
}

export class PublicProductUpdateDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ enum: UPDATE_KINDS }) kind!: UpdateKind;
  @ApiProperty({ enum: UPDATE_SURFACES, isArray: true })
  surfaces!: UpdateSurface[];
  @ApiProperty({ enum: UPDATE_AREAS }) area!: string;
  @ApiProperty({ description: 'When it reached production' }) liveAt!: Date;
}

export class GetPublicProductUpdatesResponseDto {
  @ApiProperty({ type: [PublicProductUpdateDto] })
  updates!: PublicProductUpdateDto[];
  @ApiProperty({ description: 'Total matching updates' }) count!: number;
}

// ---- Admin -------------------------------------------------------------------

export class GetProductUpdatesDto {
  @ApiPropertyOptional({ enum: ['live', 'merged'] })
  @IsOptional()
  @IsIn(['live', 'merged'])
  status?: 'live' | 'merged';

  @ApiPropertyOptional({ enum: UPDATE_AUDIENCES })
  @IsOptional()
  @IsIn(UPDATE_AUDIENCES)
  audience?: UpdateAudience;

  @ApiPropertyOptional({ enum: UPDATE_SURFACES })
  @IsOptional()
  @IsIn(UPDATE_SURFACES)
  surface?: UpdateSurface;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ description: 'Matches title, summary or team notes' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class ProductUpdateSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() repo!: string;
  @ApiPropertyOptional() prNumber?: number | null;
  @ApiPropertyOptional() prUrl?: string | null;
  @ApiPropertyOptional() author?: string | null;
  @ApiProperty({ type: [String] }) subjects!: string[];
  @ApiProperty() mergedAt!: Date;
  @ApiPropertyOptional() liveAt?: Date | null;
  @ApiProperty({ type: [String] }) deployables!: string[];
  @ApiProperty() gatesLiveness!: boolean;
}

export class ProductUpdateDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() teamNotes!: string;
  @ApiProperty({ enum: UPDATE_KINDS }) kind!: UpdateKind;
  @ApiProperty({ enum: UPDATE_AUDIENCES }) audience!: UpdateAudience;
  @ApiProperty({ enum: UPDATE_SURFACES, isArray: true })
  surfaces!: UpdateSurface[];
  @ApiProperty() area!: string;
  @ApiProperty() confidence!: number;
  @ApiProperty() hidden!: boolean;
  @ApiProperty({ description: 'On the public page right now' })
  isPublic!: boolean;
  @ApiProperty({ type: [String] }) editedFields!: string[];
  @ApiProperty() firstMergedAt!: Date;
  @ApiProperty() lastMergedAt!: Date;
  @ApiPropertyOptional() liveAt?: Date | null;
  @ApiPropertyOptional() publishedAt?: Date | null;
  @ApiPropertyOptional() decisionReason?: string | null;
  @ApiPropertyOptional() model?: string | null;
  @ApiProperty() sourceCount!: number;
  @ApiPropertyOptional({ type: [ProductUpdateSourceDto] })
  sources?: ProductUpdateSourceDto[];
}

export class GetProductUpdatesResponseDto {
  @ApiProperty({ type: [ProductUpdateDto] }) updates!: ProductUpdateDto[];
  @ApiProperty() count!: number;
}

/** Every field optional; each one sent is locked against the consolidation job from then on. */
export class UpdateProductUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SUMMARY_MAX)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEAM_NOTES_MAX)
  teamNotes?: string;

  @ApiPropertyOptional({ enum: UPDATE_KINDS })
  @IsOptional()
  @IsIn(UPDATE_KINDS)
  kind?: UpdateKind;

  @ApiPropertyOptional({ enum: UPDATE_AUDIENCES })
  @IsOptional()
  @IsIn(UPDATE_AUDIENCES)
  audience?: UpdateAudience;

  @ApiPropertyOptional({ enum: UPDATE_SURFACES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(UPDATE_SURFACES, { each: true })
  surfaces?: UpdateSurface[];

  @ApiPropertyOptional({ enum: UPDATE_AREAS })
  @IsOptional()
  @IsIn(UPDATE_AREAS)
  area?: UpdateArea;

  @ApiPropertyOptional({
    description: 'Withdraw from (true) or return to (false) the public page',
  })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class TriggerProductUpdatesRunDto {
  @ApiPropertyOptional({
    description:
      'Replay the whole journal with backfill limits instead of one scheduled-size pass',
  })
  @IsOptional()
  @IsBoolean()
  backfill?: boolean;
}

export class TriggerProductUpdatesRunResponseDto {
  @ApiProperty() started!: boolean;
  @ApiPropertyOptional() reason?: string;
}

export class ProductUpdatesStatusDto {
  @ApiProperty({
    description: 'PRODUCT_UPDATES_ENABLED — the schedule runs only when true',
  })
  enabled!: boolean;
  @ApiProperty({ description: 'Digest recipients are configured' })
  digestConfigured!: boolean;
  @ApiProperty({ description: 'Merges by pipeline status' })
  sources!: Record<string, number>;
  @ApiProperty() updates!: { total: number; public: number; waiting: number };
  @ApiProperty({ description: 'A pipeline pass is running right now' })
  running!: boolean;
  @ApiPropertyOptional({ description: 'The last pipeline pass, as recorded' })
  lastRun?: Record<string, unknown> | null;
}
