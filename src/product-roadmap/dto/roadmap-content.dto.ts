import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';
import { RoadmapSavedViewState } from '../type/roadmap-saved-view.type';

export class RoadmapListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

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

// ── comments ─────────────────────────────────────────────────────────────────
export class CreateCommentDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.COMMENT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.COMMENT_MAX)
  body!: string;
}

export class UpdateCommentDto extends CreateCommentDto {}

// ── interview notes ──────────────────────────────────────────────────────────
export class CreateInterviewNoteDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_TITLE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TITLE_MAX)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  interviewee?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  transcript?: string | null;

  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX)
  summary!: string;
}

export class UpdateInterviewNoteDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.INTERVIEW_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  interviewee?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  transcript?: string | null;

  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_SUMMARY_MAX)
  summary?: string;
}

// ── release notes ────────────────────────────────────────────────────────────
export class CreateReleaseNoteDto {
  @ApiPropertyOptional({
    maxLength: ROADMAP_LIMITS.RELEASE_NOTE_TITLE_MAX,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.RELEASE_NOTE_TITLE_MAX)
  title?: string | null;

  @ApiProperty({ maxLength: ROADMAP_LIMITS.RELEASE_NOTE_CONTENT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.RELEASE_NOTE_CONTENT_MAX)
  content!: string;

  @ApiProperty({
    type: [String],
    description:
      'Denormalised snapshot of the opportunities these notes were generated from. Stored ' +
      'verbatim; not a join table.',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  opportunityIds!: string[];
}

export class UpdateReleaseNoteDto {
  @ApiPropertyOptional({
    maxLength: ROADMAP_LIMITS.RELEASE_NOTE_TITLE_MAX,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ROADMAP_LIMITS.RELEASE_NOTE_TITLE_MAX)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.RELEASE_NOTE_CONTENT_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.RELEASE_NOTE_CONTENT_MAX)
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  opportunityIds?: string[];
}

// ── saved views ──────────────────────────────────────────────────────────────
export class CreateSavedViewDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX)
  name!: string;

  @ApiProperty({
    description: 'Filter/sort snapshot. Goal and owner entries are NAMES.',
  })
  @IsObject()
  state!: RoadmapSavedViewState;
}

/**
 * `pinned` is deliberately ABSENT. Pinning is a separate endpoint gated on
 * edit:admin:product-roadmap, so a view's owner cannot pin their own view for everyone by
 * PATCHing this field. That replaces the source's enforce_pin_admin() trigger, which existed
 * only because RLS let a creator update their own row including `pinned`. The service also
 * rejects the field explicitly if a client sends it.
 */
export class UpdateSavedViewDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.SAVED_VIEW_NAME_MAX)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  state?: RoadmapSavedViewState;
}

export class PinSavedViewDto {
  @ApiProperty()
  @IsBoolean()
  pinned!: boolean;
}

export class SetTabOrderDto {
  @ApiProperty({
    type: [String],
    description:
      'Saved-view ids in display order. Tolerant: stale ids are ignored and views missing ' +
      'from the list are appended by the client, so this need not be exhaustive.',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  viewIds!: string[];
}

// ── taxonomy ─────────────────────────────────────────────────────────────────
export class CreateTaxonomyItemDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.GOAL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.GOAL_NAME_MAX)
  name!: string;
}

export class RenameTaxonomyItemDto extends CreateTaxonomyItemDto {}

export class ReorderTaxonomyDto {
  @ApiProperty({
    type: [String],
    description: 'Goal/owner uuids in the desired display order',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  ids!: string[];
}

// ── AI ───────────────────────────────────────────────────────────────────────
export class AiDraftDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.DESCRIPTION_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({
    description: 'Scopes duplicate candidates to one goal',
  })
  @IsOptional()
  @IsString()
  productGoal?: string;
}

export class AiSummariseDto {
  @ApiProperty({ maxLength: ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX)
  transcript!: string;
}

export class AiReleaseNotesDto {
  @ApiProperty({
    type: [String],
    description:
      'Opportunities to summarise. The service filters these to rows that are actually ' +
      'stage=released, matching the source behaviour.',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  opportunityIds!: string[];
}
