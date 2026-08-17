import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const FIELD_SCOPES = ['track', 'section', 'item'] as const;

export class SetTrackLanguagesDto {
  @ApiProperty({
    type: [Number],
    description:
      'The complete set of `languages.id` this course should be available in. Omitted languages are removed; a published language cannot be removed.',
  })
  @IsArray()
  @IsInt({ each: true })
  languageIds!: number[];
}

export class TranslateTrackDto {
  @ApiPropertyOptional({
    type: [Number],
    description:
      'Languages to (re-)translate. Defaults to every language selected for the course.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  languageIds?: number[];
}

export class TrackFieldRefDto {
  @ApiProperty({ enum: FIELD_SCOPES })
  @IsIn(FIELD_SCOPES)
  scope!: (typeof FIELD_SCOPES)[number];

  @ApiPropertyOptional({
    description: 'Section or item id. Omitted for `track` scope.',
  })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiProperty({
    description:
      'Stable-id path into the entity, e.g. `content.questions[q3].options[o1].text`.',
  })
  @IsString()
  @IsNotEmpty()
  path!: string;
}

export class TrackFieldEditDto extends TrackFieldRefDto {
  @ApiProperty({ description: 'The trainer-authored translation.' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class UpdateTrackTranslationFieldsDto {
  @ApiProperty({ type: [TrackFieldEditDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TrackFieldEditDto)
  edits!: TrackFieldEditDto[];
}

export class MarkTrackTranslationReviewedDto {
  @ApiPropertyOptional({
    type: [TrackFieldRefDto],
    description:
      'Fields to confirm. Omit to confirm every field awaiting review in this language.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackFieldRefDto)
  fields?: TrackFieldRefDto[];
}

export class SetTrackTranslationMediaDto {
  @ApiProperty()
  @IsUUID()
  trackItemId!: string;

  @ApiPropertyOptional({
    description:
      'Localised media URL for this video component, or null to clear it and fall back to the English cut.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  url?: string | null;
}

export class EnrollTrackDto {
  @ApiPropertyOptional({
    description:
      "The learner's current app language, used to seed the course's language when it is published in it.",
  })
  @IsOptional()
  @IsString()
  languageCode?: string;
}

export class SetTrackLanguageDto {
  @ApiProperty({
    description:
      'A published language code for this course (e.g. `hi`), or `en` for the English source.',
  })
  @IsString()
  @IsNotEmpty()
  languageCode!: string;
}
