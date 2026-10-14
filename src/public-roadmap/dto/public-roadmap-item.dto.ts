import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  ROADMAP_CATEGORIES,
  ROADMAP_DESCRIPTION_MAX_LENGTH,
  ROADMAP_NOTE_MAX_LENGTH,
  ROADMAP_STAGES,
  ROADMAP_TITLE_MAX_LENGTH,
  RoadmapCategory,
  RoadmapStage,
} from '../constants/public-roadmap.constants';

export class CreatePublicRoadmapItemDto {
  @ApiProperty({ maxLength: ROADMAP_TITLE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROADMAP_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({ maxLength: ROADMAP_DESCRIPTION_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROADMAP_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiPropertyOptional({
    maxLength: ROADMAP_NOTE_MAX_LENGTH,
    nullable: true,
    description: 'One-line callout, e.g. "Current priority". Empty clears it.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(ROADMAP_NOTE_MAX_LENGTH)
  note?: string | null;

  @ApiProperty({ enum: ROADMAP_CATEGORIES })
  @IsIn(ROADMAP_CATEGORIES)
  category!: RoadmapCategory;

  @ApiProperty({ enum: ROADMAP_STAGES })
  @IsIn(ROADMAP_STAGES)
  stage!: RoadmapStage;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdatePublicRoadmapItemDto {
  @ApiPropertyOptional({ maxLength: ROADMAP_TITLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROADMAP_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: ROADMAP_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROADMAP_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: ROADMAP_NOTE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(ROADMAP_NOTE_MAX_LENGTH)
  note?: string | null;

  @ApiPropertyOptional({ enum: ROADMAP_CATEGORIES })
  @IsOptional()
  @IsIn(ROADMAP_CATEGORIES)
  category?: RoadmapCategory;

  @ApiPropertyOptional({ enum: ROADMAP_STAGES })
  @IsOptional()
  @IsIn(ROADMAP_STAGES)
  stage?: RoadmapStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * The new order of one category × stage cell: every card in that cell, top to
 * bottom. Sending the whole cell (not a single move) keeps a reorder atomic and
 * leaves no gaps or ties in `sortOrder`.
 */
export class ReorderPublicRoadmapItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}

/** A card as the public page sees it — no visibility flag, no audit fields. */
export class PublicRoadmapCardDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ enum: ROADMAP_CATEGORIES }) category!: RoadmapCategory;
  @ApiProperty({ enum: ROADMAP_STAGES }) stage!: RoadmapStage;
  @ApiProperty() sortOrder!: number;
}

export class GetPublicRoadmapResponseDto {
  @ApiProperty({ type: [PublicRoadmapCardDto] })
  items!: PublicRoadmapCardDto[];

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When a card on the page last changed (ISO 8601); null when the page is empty.',
  })
  updatedAt!: string | null;
}

/** A card as the admin console sees it. */
export class PublicRoadmapItemDto extends PublicRoadmapCardDto {
  @ApiProperty() isPublic!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
