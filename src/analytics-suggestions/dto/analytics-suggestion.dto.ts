import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  ANALYTICS_RANGES,
  AnalyticsRange,
} from 'src/analytics/dto/platform-analytics.dto';
import { MAX_CUSTOM_RANGE_DAYS } from 'src/analytics/util/analytics-window.util';
import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import {
  ANALYTICS_SUGGESTION_STATUS_FILTERS,
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
  AnalyticsSuggestionStatusFilter,
} from '../enum/analytics-suggestion.enum';
import {
  MAX_SUGGESTIONS_PER_RUN,
  SUGGESTION_FIELD_LIMITS,
} from '../constants/analytics-suggestions.constants';

/**
 * Which window to read.
 *
 * Deliberately the same contract as every windowed analytics endpoint (`range`
 * preset, or an explicit `from`/`to` pair) minus `bucket`, `compare` and
 * `tenantId`. Those three are per-chart reading choices; this is one question
 * about one period at platform scope, and offering a grain control here would
 * imply the model reads the series differently at a different grain.
 *
 * Pairing and the {@link MAX_CUSTOM_RANGE_DAYS} cap are enforced by
 * `resolveAnalyticsWindow`, so there is one implementation of those rules.
 */
export class GenerateSuggestionsDto {
  @ApiProperty({
    description:
      'Rolling window to read. Ignored when `from`/`to` are supplied.',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Custom window start (yyyy-mm-dd, inclusive). Must be sent with `to`.',
    required: false,
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'from must be an ISO date (yyyy-mm-dd)' },
  )
  from?: string;

  @ApiProperty({
    description:
      'Custom window end (yyyy-mm-dd, INCLUSIVE). Must be sent with `from`. ' +
      `Windows are capped at ${MAX_CUSTOM_RANGE_DAYS} days.`,
    required: false,
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'to must be an ISO date (yyyy-mm-dd)' },
  )
  to?: string;
}

/**
 * File an accepted suggestion as a roadmap opportunity.
 *
 * All three fields are supplied by the reviewer rather than read from the stored
 * suggestion, because accept opens an editable form: the model's draft is a
 * proposal, and what gets filed is what the human agreed to. Mirrors
 * CreateOpportunityDto's rules so a body that validated here cannot fail there.
 */
export class AcceptSuggestionDto {
  @ApiProperty({
    description:
      'The opportunity description to file — the reviewer’s edited version of ' +
      'the suggestion body.',
    maxLength: SUGGESTION_FIELD_LIMITS.BODY,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SUGGESTION_FIELD_LIMITS.BODY)
  description!: string;

  @ApiProperty({
    description:
      'Product goal NAME; must be a live goal. Re-validated here because a goal ' +
      'can be renamed or retired while a suggestion waits in the queue.',
  })
  @IsString()
  @MinLength(1)
  productGoal!: string;

  @ApiProperty({
    description: 'Opportunity type. Defaults to idea.',
    enum: RoadmapOpportunityType,
    required: false,
  })
  @IsOptional()
  @IsEnum(RoadmapOpportunityType)
  type?: RoadmapOpportunityType;
}

/**
 * Reject a suggestion, optionally saying why.
 *
 * The reason is optional but load-bearing: it is fed to the next generation as a
 * standing decision. A rejection without one still suppresses this exact
 * suggestion, but tells the model nothing about the class of suggestion to avoid.
 */
export class RejectSuggestionDto {
  @ApiProperty({
    description:
      'Why this was rejected. Optional, and fed into future generations so the ' +
      'same idea is not re-proposed.',
    required: false,
    maxLength: SUGGESTION_FIELD_LIMITS.REJECTED_REASON,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SUGGESTION_FIELD_LIMITS.REJECTED_REASON)
  reason?: string;
}

export class ListSuggestionsQueryDto {
  @ApiProperty({
    description:
      'Which part of the queue to read. Defaults to `pending` — the decisions ' +
      'still outstanding.',
    enum: ANALYTICS_SUGGESTION_STATUS_FILTERS,
    default: AnalyticsSuggestionStatus.PENDING,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_SUGGESTION_STATUS_FILTERS)
  status?: AnalyticsSuggestionStatusFilter;
}

/** The window a suggestion was derived from, echoed on every row. */
export class SuggestionWindowDto {
  @ApiProperty({ nullable: true, type: String })
  range!: string | null;

  @ApiProperty({ description: 'yyyy-mm-dd, inclusive' })
  from!: string;

  @ApiProperty({ description: 'yyyy-mm-dd, inclusive' })
  to!: string;

  @ApiProperty({ example: 'Last 30 days' })
  label!: string;
}

export class SuggestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The Generate run this came from' })
  batchId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  rationale!: string;

  @ApiProperty({
    description: 'Metric observations the model cited from the payload',
    type: [String],
  })
  evidence!: string[];

  @ApiProperty({
    description:
      'Product goal the model classified this into, or null when its answer ' +
      'was not a live goal.',
    nullable: true,
    type: String,
  })
  suggestedGoal!: string | null;

  @ApiProperty({ enum: RoadmapOpportunityType })
  suggestedType!: RoadmapOpportunityType;

  @ApiProperty({ enum: AnalyticsSuggestionStatus })
  status!: AnalyticsSuggestionStatus;

  @ApiProperty({
    enum: AnalyticsSuggestionSource,
    description:
      'Which pipeline drafted this: an analytics-window Generate run, or the UX ' +
      'Signals scan over PostHog telemetry. Both share this queue and one ' +
      'accept/reject flow — this only tells a reviewer what kind of evidence ' +
      'backs the card.',
  })
  source!: AnalyticsSuggestionSource;

  @ApiProperty({ nullable: true, type: String })
  rejectedReason!: string | null;

  @ApiProperty({
    description:
      'The roadmap opportunity this became, or null. Also null for an accepted ' +
      'suggestion whose opportunity was later deleted.',
    nullable: true,
    type: String,
  })
  opportunityId!: string | null;

  @ApiProperty({
    description:
      'The analytics window this was derived from. Stored per row so a ' +
      'suggestion read later still states the evidence it rests on.',
    type: SuggestionWindowDto,
  })
  window!: SuggestionWindowDto;

  @ApiProperty({ description: 'The model that drafted it' })
  model!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class ListSuggestionsResponseDto {
  @ApiProperty({ type: [SuggestionDto] })
  items!: SuggestionDto[];

  @ApiProperty()
  count!: number;
}

/** Which analytics sections made it into the prompt, and which did not. */
export class SuggestionSourceSectionsDto {
  @ApiProperty({
    description: 'Analytics sections that were read for this run',
    type: [String],
  })
  included!: string[];

  @ApiProperty({
    description:
      'Sections that could not be read or were too large, with the reason. ' +
      'Named rather than omitted: a reader judging a suggestion needs to know ' +
      'what the model could not see.',
    type: [String],
  })
  failed!: string[];
}

export class GenerateSuggestionsResponseDto {
  @ApiProperty({ description: 'The run these suggestions belong to' })
  batchId!: string;

  @ApiProperty({ type: SuggestionWindowDto })
  window!: SuggestionWindowDto;

  @ApiProperty()
  model!: string;

  @ApiProperty({
    description:
      `Up to ${MAX_SUGGESTIONS_PER_RUN} suggestions, most important first. ` +
      'An empty array is a legitimate result: the data supported nothing worth ' +
      'proposing, and the list is never padded to reach the cap.',
    type: [SuggestionDto],
  })
  suggestions!: SuggestionDto[];

  @ApiProperty({ type: SuggestionSourceSectionsDto })
  sections!: SuggestionSourceSectionsDto;
}

export class AcceptSuggestionResponseDto {
  @ApiProperty({ type: SuggestionDto })
  suggestion!: SuggestionDto;

  @ApiProperty({
    description: 'The roadmap opportunity that was filed, as the board sees it',
  })
  opportunity!: Record<string, unknown>;
}
