import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  BuilderLessonCategory,
  BuilderLessonStatus,
  BuilderSessionStatus,
} from '../enum/builder.enum';
import {
  BUILDER_SLUG_MAX_LENGTH,
  BUILDER_TITLE_MAX_LENGTH,
} from '../constants/builder.constants';

/**
 * Structured answer for option-card questions. The FE also sends a
 * human-readable `message`; the orchestrator renders ids + custom values into
 * the persisted content so the agent acts on exact selections, and keeps the
 * raw payload in metadata for resume fidelity.
 */
export class BuilderAnswerDto {
  @ApiPropertyOptional({ type: [String], description: 'Selected option ids' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom free-text values the admin added',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customValues?: string[];

  @ApiPropertyOptional({ description: 'Admin chose "None of these"' })
  @IsOptional()
  @IsBoolean()
  none?: boolean;
}

/** The admin's verdict on one situation-brief line. */
export class BuilderBriefLineVerdictDto {
  @ApiProperty({ example: 'X2' })
  @IsString()
  @MaxLength(20)
  id!: string;

  @ApiProperty({ enum: ['confirm', 'correct'] })
  @IsIn(['confirm', 'correct'])
  verdict!: 'confirm' | 'correct';

  @ApiPropertyOptional({
    description: 'What is true instead — required for a correction',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correction?: string;
}

/** The admin's response to a situation brief, line by line. */
export class BuilderBriefResponseDto {
  @ApiProperty({ description: 'The brief being answered' })
  @IsString()
  @MaxLength(64)
  briefId!: string;

  @ApiProperty({ type: [BuilderBriefLineVerdictDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => BuilderBriefLineVerdictDto)
  lines!: BuilderBriefLineVerdictDto[];

  @ApiPropertyOptional({ description: 'Anything else, in their words' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class CreateBuilderMessageDto {
  @ApiProperty({ description: "The admin's message for this turn" })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description: 'When answering an ask_admin question, the question id',
  })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({ type: BuilderAnswerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuilderAnswerDto)
  answer?: BuilderAnswerDto;
  @ApiPropertyOptional({
    type: BuilderBriefResponseDto,
    description: 'When answering a situation brief: a verdict per line',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuilderBriefResponseDto)
  briefResponse?: BuilderBriefResponseDto;
}

export class CreateBuilderSessionDto {
  @ApiPropertyOptional({
    description:
      'Working title. Also seeds the branch slug, so it is worth being ' +
      'descriptive — the agent refines the title as the PRD takes shape.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_TITLE_MAX_LENGTH)
  title?: string;
}

export class UpdateBuilderSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Repos this build will touch',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repos?: string[];

  @ApiPropertyOptional({ description: 'Model for build runs' })
  @IsOptional()
  @IsString()
  @MaxLength(BUILDER_SLUG_MAX_LENGTH)
  model?: string;
}

/** One RFC-6902 operation. Only add/replace/remove — see json-patch.util. */
export class BuilderPrdPatchOpDto {
  @ApiProperty({ enum: ['add', 'replace', 'remove'] })
  @IsIn(['add', 'replace', 'remove'])
  op!: 'add' | 'replace' | 'remove';

  @ApiProperty({ description: 'JSON Pointer into the PRD, e.g. "/problem"' })
  @IsString()
  path!: string;

  @ApiPropertyOptional({ description: 'Required for add/replace' })
  @IsOptional()
  value?: any;
}

export class PatchBuilderPrdDto {
  @ApiProperty({ type: [BuilderPrdPatchOpDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BuilderPrdPatchOpDto)
  ops!: BuilderPrdPatchOpDto[];

  @ApiPropertyOptional({ description: 'One line for the version history' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeSummary?: string;
}

export class DismissBuilderReviewFindingDto {
  @ApiProperty({
    description:
      'Why the finding is wrong. Kept beside the finding as the record of ' +
      'where the reviewer misjudged.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class StartBuilderBuildDto {
  @ApiPropertyOptional({
    description:
      'The coder model to record for this build. The build itself runs as an ' +
      "issue in its repo, on that repo's own opencode model.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @ApiPropertyOptional({
    description:
      'Spend ceiling for the session. Once reached, no further runs dispatch until it is raised.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetUsd?: number;
}

export class RaiseBuilderBudgetDto {
  @ApiProperty({
    description:
      'The new spend ceiling for the session, USD. Must be above what the session has already spent — anything at or below it would stop the build again immediately. 0 removes the ceiling.',
  })
  @IsNumber()
  @Min(0)
  budgetUsd!: number;
}

export class UpdateBuilderSettingsDto {
  @ApiPropertyOptional({
    description:
      'The kill switch. Off means no build will dispatch, whatever the feature toggle says.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Ceiling on concurrent builds' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxConcurrentBuilds?: number;

  @ApiPropertyOptional({
    description: 'Default per-session spend ceiling, USD',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultBudgetUsd?: number;

  @ApiPropertyOptional({
    description:
      'Ceiling on GitHub Actions minutes per session. Separate from the dollar budget: a run can be cheap in tokens and still hold a runner for two hours.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxRunnerMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Whether Builder may act on its own open pull requests — self-fixing red CI and answering review comments. Separate from the kill switch on purpose.',
  })
  @IsOptional()
  @IsBoolean()
  autoFixEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether Builder reviews its own open pull requests. The safer half of ' +
      'autonomy — a review run reads the diff and writes findings, touching no ' +
      'branch — so it is worth enabling on its own, with fixes still off.',
  })
  @IsOptional()
  @IsBoolean()
  autoReviewEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether a clean review may submit an approving review. Only fires when ' +
      'Builder read the full diff, reported no findings, and every required ' +
      'check is green. Never forces: other required checks still apply and a ' +
      'human can dismiss it.',
  })
  @IsOptional()
  @IsBoolean()
  autoApproveEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether a clean review may merge the pull request. The last click ' +
      'Builder waits on, and the one step that cannot be undone from here, so ' +
      'it is its own switch. Checks green checks, a review that passed on this ' +
      "exact commit, nothing actionable outstanding and GitHub's own " +
      'mergeable_state afresh at merge time; declines to the human merge ' +
      'button rather than forcing. With auto-release on, this ships.',
  })
  @IsOptional()
  @IsBoolean()
  autoMergeEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether a merged pull request releases itself to production. The only ' +
      'switch here that changes what real users are running. Refuses rather ' +
      'than guesses when a change cannot be attributed to exactly the ' +
      'deployables being released, and a failed release notifies loudly — ' +
      '"merged but not deployed" is worse than not having released at all.',
  })
  @IsOptional()
  @IsBoolean()
  autoReleaseEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Fix runs allowed per pull request' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  maxFixRunsPerPr?: number;

  @ApiPropertyOptional({
    description:
      'Most Builder may spend (USD) on automated review and fixes for one ' +
      'pull request before handing it to a person. 0 means no limit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrAutomationUsd?: number;

  @ApiPropertyOptional({
    description:
      'How much Builder does on its own, as one level: off, assist (review, ' +
      'fix, approve), auto_merge (also merge), auto (also release). Sets the ' +
      'individual switches; given together with them, the level wins.',
    enum: ['off', 'assist', 'auto_merge', 'auto'],
  })
  @IsOptional()
  @IsIn(['off', 'assist', 'auto_merge', 'auto'])
  autonomyLevel?: 'off' | 'assist' | 'auto_merge' | 'auto';

  @ApiPropertyOptional({
    description: 'Planner-tier model for new runs (null = platform default)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  plannerModel?: string;

  @ApiPropertyOptional({
    description: 'Coder-tier model for new runs (null = platform default)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  coderModel?: string;

  @ApiPropertyOptional({
    description: 'Verifier-tier model for new runs (null = platform default)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  verifierModel?: string;

  @ApiPropertyOptional({
    description:
      "Validated interview turns: Builder's reply reaches the admin only after " +
      'every lookup it ran was read and none failed, and a claimed PRD change ' +
      'is checked against the document. Off falls back to the previous loop.',
  })
  @IsOptional()
  @IsBoolean()
  validatedTurns?: boolean;

  @ApiPropertyOptional({
    description:
      'The interview protocol, on top of validated turns: a new interview opens with a ' +
      'discovery sweep and a situation brief the admin confirms or corrects line by line, ' +
      'and every later question names its type, its basis and why research cannot settle it.',
  })
  @IsOptional()
  @IsBoolean()
  situationBrief?: boolean;
}

export class ListBuilderSessionsQueryDto {
  @ApiPropertyOptional({
    enum: BuilderSessionStatus,
    isArray: true,
    description: 'Filter to these statuses',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(BuilderSessionStatus, { each: true })
  @Type(() => String)
  status?: BuilderSessionStatus[];

  @ApiPropertyOptional({
    description:
      'Switch from the default (non-archived) feed to the archived-only view.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  archived?: boolean = false;

  @ApiPropertyOptional({
    description:
      "Only the caller's own sessions. Sessions are shared across Builder users; this narrows the feed back to the ones the caller started.",
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean = false;

  // limit/offset apply only to the archived view — the default feed stays
  // unpaginated.
  @ApiPropertyOptional({
    description: 'Archived view page size',
    default: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({
    description: 'Archived view page offset',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}

export class ListBuilderLessonsQueryDto {
  @ApiPropertyOptional({
    enum: BuilderLessonStatus,
    description: 'Defaults to the active set — what runs actually read.',
  })
  @IsOptional()
  @IsEnum(BuilderLessonStatus)
  status?: BuilderLessonStatus;

  @ApiPropertyOptional({ enum: BuilderLessonCategory })
  @IsOptional()
  @IsEnum(BuilderLessonCategory)
  category?: BuilderLessonCategory;

  @ApiPropertyOptional({ description: 'Only lessons scoped to this repo' })
  @IsOptional()
  @IsString()
  repo?: string;
}

export class UpdateBuilderLessonDto {
  @ApiPropertyOptional({ description: 'Rewrite the lesson text' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  lesson?: string;

  @ApiPropertyOptional({ enum: BuilderLessonCategory })
  @IsOptional()
  @IsEnum(BuilderLessonCategory)
  category?: BuilderLessonCategory;

  @ApiPropertyOptional({
    enum: BuilderLessonStatus,
    description:
      'Activate or retire it by hand. The curator respects a human decision.',
  })
  @IsOptional()
  @IsEnum(BuilderLessonStatus)
  status?: BuilderLessonStatus;

  @ApiPropertyOptional({
    description:
      'Pinned lessons are always in context and the curator may never edit or retire them.',
  })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class BuilderResearchDto {
  @ApiPropertyOptional({
    enum: ['technical_plan', 'draft_prd'],
    description:
      'technical_plan fills in the codebase half of an interviewed PRD; draft_prd writes a first draft from the opening message for the admin to correct.',
  })
  @IsOptional()
  @IsIn(['technical_plan', 'draft_prd'])
  mode?: 'technical_plan' | 'draft_prd';
}
