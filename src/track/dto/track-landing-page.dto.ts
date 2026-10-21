import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  LandingSittingLength,
  StoryBeat,
  TRACK_LANDING_LIMITS,
} from '../type/track-landing-page.type';

/**
 * The input side of `tracks.landingPage`: the stored shape with every key
 * optional at every level. `null` or an empty string clears a field; the
 * service normalises the whole thing (defaults, trims, drops empties) before
 * it is stored, so validation here only has to reject what could not be
 * normalised — a value of the wrong type or over a limit.
 *
 * The app's ValidationPipe does not whitelist, so unknown keys pass through
 * validation; `normaliseTrackLandingPage` copies only the keys it knows, so
 * none of them is stored.
 */

/** An optional text field: absent, null or any string up to `max` characters. */
const OptionalText = (max: number, description?: string) =>
  applyDecorators(
    ApiPropertyOptional({
      type: String,
      nullable: true,
      maxLength: max,
      description,
    }),
    IsOptional(),
    IsString(),
    MaxLength(max),
  );

/** An optional id: absent, null or `""` (a cleared field) skip the uuid check. */
const OptionalUuid = (description: string) =>
  applyDecorators(
    ApiPropertyOptional({ type: String, nullable: true, description }),
    IsOptional(),
    ValidateIf((_object, value) => value !== ''),
    IsUUID(),
  );

const OptionalEnabled = (description: string) =>
  applyDecorators(
    ApiPropertyOptional({ type: Boolean, description }),
    IsOptional(),
    IsBoolean(),
  );

export class TrackLandingHeroDto {
  @OptionalText(
    TRACK_LANDING_LIMITS.hook,
    'The opening line. A non-empty hook is what turns story mode on.',
  )
  hook?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.question)
  question?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.courseLine)
  courseLine?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.buttonLabel)
  buttonLabel?: string | null;
}

export class TrackLandingPersonaDto {
  @OptionalText(TRACK_LANDING_LIMITS.personaName)
  name?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.personaDescriptor)
  descriptor?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.personaImageUrl)
  imageUrl?: string | null;

  @OptionalUuid(
    'Character Library id (scenario_characters.id), kept for traceability only.',
  )
  characterId?: string | null;
}

export class TrackLandingReplyDto {
  @OptionalText(TRACK_LANDING_LIMITS.replyText)
  text?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.replyLabel)
  label?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.replyWhy)
  why?: string | null;
}

export class TrackLandingFirstMoveDto {
  @OptionalEnabled('Show the first-move block (default true).')
  enabled?: boolean;

  @OptionalText(TRACK_LANDING_LIMITS.sceneLine)
  sceneLine?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.personaLine)
  personaLine?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.prompt)
  prompt?: string | null;

  @ApiPropertyOptional({
    type: () => [TrackLandingReplyDto],
    maxItems: TRACK_LANDING_LIMITS.replies,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRACK_LANDING_LIMITS.replies)
  @ValidateNested({ each: true })
  @Type(() => TrackLandingReplyDto)
  replies?: TrackLandingReplyDto[];
}

export class TrackLandingChapterDto {
  @OptionalUuid('The course section this chapter configures.')
  sectionId?: string;

  @ApiPropertyOptional({ enum: StoryBeat, nullable: true })
  @IsOptional()
  @IsEnum(StoryBeat)
  beat?: StoryBeat | null;

  @OptionalText(TRACK_LANDING_LIMITS.teaser)
  teaser?: string | null;
}

export class TrackLandingArcDto {
  @OptionalEnabled('Show the story-arc block (default true).')
  enabled?: boolean;

  @ApiPropertyOptional({
    type: () => [TrackLandingChapterDto],
    maxItems: TRACK_LANDING_LIMITS.chapters,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRACK_LANDING_LIMITS.chapters)
  @ValidateNested({ each: true })
  @Type(() => TrackLandingChapterDto)
  chapters?: TrackLandingChapterDto[];

  @OptionalUuid('The one section marked as the hard call.')
  hardCallSectionId?: string | null;
}

export class TrackLandingOutcomesDto {
  @OptionalEnabled('Show the outcomes block (default true).')
  enabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    maxItems: TRACK_LANDING_LIMITS.outcomes,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRACK_LANDING_LIMITS.outcomes)
  @IsString({ each: true })
  @MaxLength(TRACK_LANDING_LIMITS.outcome, { each: true })
  items?: string[];
}

export class TrackLandingHowItPlaysDto {
  @OptionalEnabled('Show the how-it-plays block (default true).')
  enabled?: boolean;

  @ApiPropertyOptional({ enum: LandingSittingLength, nullable: true })
  @IsOptional()
  @IsEnum(LandingSittingLength)
  sittingLength?: LandingSittingLength | null;
}

export class TrackLandingGuideDto {
  @OptionalText(TRACK_LANDING_LIMITS.guideName)
  name?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.guideRole)
  role?: string | null;

  @OptionalText(TRACK_LANDING_LIMITS.guideLine)
  line?: string | null;
}

export class TrackLandingCastDto {
  @OptionalEnabled('Show the cast block (default true).')
  enabled?: boolean;

  @OptionalText(TRACK_LANDING_LIMITS.callerLine)
  callerLine?: string | null;

  @ApiPropertyOptional({ type: () => TrackLandingGuideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingGuideDto)
  guide?: TrackLandingGuideDto;
}

export class TrackLandingXpDto {
  @OptionalEnabled('Show the XP line (default true).')
  enabled?: boolean;
}

export class TrackLandingContentNotesDto {
  @OptionalText(
    TRACK_LANDING_LIMITS.extraNote,
    'Shown under the automatic trigger-warning note. There is no switch for ' +
      'the automatic part: it appears whenever a roleplay carries a warning.',
  )
  extraNote?: string | null;
}

export class TrackLandingPageDto {
  @ApiPropertyOptional({ type: Number, description: 'Always stored as 1.' })
  @IsOptional()
  @IsInt()
  version?: number;

  @ApiPropertyOptional({ type: () => TrackLandingHeroDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingHeroDto)
  hero?: TrackLandingHeroDto;

  @ApiPropertyOptional({ type: () => TrackLandingPersonaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingPersonaDto)
  persona?: TrackLandingPersonaDto;

  @ApiPropertyOptional({ type: () => TrackLandingFirstMoveDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingFirstMoveDto)
  firstMove?: TrackLandingFirstMoveDto;

  @ApiPropertyOptional({ type: () => TrackLandingArcDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingArcDto)
  arc?: TrackLandingArcDto;

  @ApiPropertyOptional({ type: () => TrackLandingOutcomesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingOutcomesDto)
  outcomes?: TrackLandingOutcomesDto;

  @ApiPropertyOptional({ type: () => TrackLandingHowItPlaysDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingHowItPlaysDto)
  howItPlays?: TrackLandingHowItPlaysDto;

  @ApiPropertyOptional({ type: () => TrackLandingCastDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingCastDto)
  cast?: TrackLandingCastDto;

  @ApiPropertyOptional({ type: () => TrackLandingXpDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingXpDto)
  xp?: TrackLandingXpDto;

  @ApiPropertyOptional({ type: () => TrackLandingContentNotesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackLandingContentNotesDto)
  contentNotes?: TrackLandingContentNotesDto;
}
