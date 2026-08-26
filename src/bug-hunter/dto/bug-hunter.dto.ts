import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BUG_FINDING_DESCRIPTION_MAX_LENGTH } from '../constants/bug-hunter.constants';

export class BugHuntEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugHuntEventStage })
  stage!: BugHuntEventStage;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: Object, nullable: true })
  payload!: Record<string, any> | null;

  @ApiProperty({ nullable: true })
  suggestionId!: string | null;

  @ApiProperty({ nullable: true })
  findingId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Body of `POST pipeline/runs/:id/report` — one progress event from the
 * external Claude Code pipeline.
 *
 * `stage` is validated against the enum on purpose, unlike most inbound
 * values in this repo, which are deliberately lenient (see CLAUDE.md: a
 * tightened enum can lock out a released mobile build that sends the old
 * value verbatim). Nothing here is a released client — the only callers are
 * `buildSweepPrompt` and `buildFixSessionPrompt`, both compiled from this
 * same enum — and the column carries a CHECK constraint matching it, so an
 * unrecognised stage was never going to be stored either way. Without this
 * it reached Postgres and came back as a 500 `Database query failed`, which
 * is how `verify_result` sat in the sweep prompt for a week silently
 * dropping every Phase-2 verification event: the pipeline treats the failed
 * POST as a transient blip and carries on. A 400 naming the bad value fails
 * the drift loudly, at the edge, for the price of one decorator.
 */
export class ReportBugHuntEventDto {
  @ApiPropertyOptional({
    description:
      "Repo this event is about. Defaults to the run's own repo when omitted.",
  })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({ enum: BugHuntEventStage })
  @IsEnum(BugHuntEventStage)
  stage!: BugHuntEventStage;

  @ApiProperty({ description: 'One line, for the run timeline.' })
  @IsString()
  summary!: string;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Structured detail only — never raw log or PII content, which this table must not carry.',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  suggestionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  findingId?: string;
}

/**
 * ── The machine surface's bodies ────────────────────────────────────────────
 *
 * `POST pipeline/runs`, `.../runs/:id/findings`, `.../runs/:id/close`,
 * `.../runs/:id/cost` and `PATCH pipeline/findings/:id` all used to declare
 * their body as an inline object type. TypeScript erases those at runtime, so
 * the global ValidationPipe had no decorated class to inspect and handed the
 * raw JSON straight through to the database — the same gap that let the sweep
 * prompt's `verify_result` reach a CHECK constraint and come back as a generic
 * 500 for a week. Every caller here is an LLM following prose instructions in
 * a prompt, which is precisely the caller most likely to send a plausible
 * wrong value.
 *
 * Where the line is drawn, deliberately — the aim is to change how these
 * requests FAIL, not which ones succeed:
 *
 *   - STRICT on enum-backed fields. Each already has a CHECK constraint behind
 *     it, so an unrecognised value was never going to be stored; it only chose
 *     between failing clearly and failing cryptically.
 *   - LENIENT — optional, type-checked only — wherever the column is nullable
 *     or carries a default. Requiring more than the schema does would reject
 *     bodies that work today, which is the trap CLAUDE.md warns about.
 *   - REQUIRED only where absence crashes or silently corrupts: a finding's
 *     `description` (sliced for the row title, so `undefined` throws) and a
 *     run's close `status` (see CloseBugHuntRunDto).
 *
 * None of this is the be-lenient-on-inbound-enums exception being ignored:
 * that rule protects released mobile builds that send a frozen value verbatim.
 * There is no released client on this controller — it is `x-api-key` guarded
 * and reachable only by the pipeline, whose prompts are compiled from these
 * same enums.
 */
export class StartBugHuntRunDto {
  @ApiProperty({ enum: BugHuntTrigger })
  @IsEnum(BugHuntTrigger)
  trigger!: BugHuntTrigger;

  @ApiProperty({ example: 'ally-be' })
  @IsString()
  @IsNotEmpty()
  repo!: string;
}

export class RawBugFindingDto {
  @ApiProperty({ enum: BugFindingSource })
  @IsEnum(BugFindingSource)
  source!: BugFindingSource;

  @ApiProperty({
    description:
      'Plain-language paragraph, blank line, then the technical detail. Sliced to 200 chars for the table title.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    description:
      'Optional because the column is nullable and BugFindingRepository.dedupeKey takes null: a production-log cluster often spans no single file.',
  })
  @IsOptional()
  @IsString()
  file?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  evidence?: string;

  @ApiPropertyOptional({ enum: BugFindingSeverity })
  @IsOptional()
  @IsEnum(BugFindingSeverity)
  severity?: BugFindingSeverity;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  proven?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  touchesGuardedPath?: boolean;

  @ApiPropertyOptional({
    description:
      'Function, class, route, component or endpoint. Omitting it drops dedup back to a description fingerprint.',
  })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({
    description:
      'Only for source=reported_bug — the roadmap row this came from.',
  })
  @IsOptional()
  @IsUUID()
  reportedBugId?: string;
}

/**
 * One Discover round, persisted in a single call.
 *
 * Validating the whole batch up front is a real improvement on what it
 * replaced, not just a nicer error: `persistFindings` saves in a loop, so a
 * bad finding halfway through left the earlier ones written, threw, and
 * returned no `items` at all — leaving the agent with rows it cannot name and
 * no ids to report against. All-or-nothing matches what the prompt already
 * asks for ("persist them all in ONE call") and is recoverable by retrying.
 */
export class PersistBugFindingsDto {
  @ApiProperty({ example: 'ally-be' })
  @IsString()
  @IsNotEmpty()
  repo!: string;

  @ApiProperty({ type: [RawBugFindingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RawBugFindingDto)
  findings!: RawBugFindingDto[];
}

export class PatchBugFindingDto {
  @ApiPropertyOptional({ enum: BugFindingStatus })
  @IsOptional()
  @IsEnum(BugFindingStatus)
  status?: BugFindingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  escalationQuestion?: string;
}

export class BugHuntModelUsageDto {
  @ApiProperty({ example: 'claude-opus-4-5' })
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  inputTokens!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  outputTokens!: number;

  @ApiPropertyOptional({
    description: 'Prompt-cache read tokens (subset of input), when reported.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cacheReadInputTokens?: number;

  @ApiPropertyOptional({
    description: 'Prompt-cache write tokens (subset of input), when reported.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cacheCreationInputTokens?: number;
}

export class RecordBugHuntRunCostDto {
  @ApiProperty({ type: [BugHuntModelUsageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BugHuntModelUsageDto)
  modelUsage!: BugHuntModelUsageDto[];

  @ApiPropertyOptional({
    description:
      "The CLI's own cost figure, kept alongside ours for comparison.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cliReportedCostUsd?: number;
}

/** The only two states a run may be closed into. */
export const BUG_HUNT_RUN_CLOSE_STATUSES = ['completed', 'failed'] as const;

export type BugHuntRunCloseStatus =
  (typeof BUG_HUNT_RUN_CLOSE_STATUSES)[number];

/**
 * `status` is the one REQUIRED field here, and the reason is worth stating:
 * the handler maps anything that is not `'failed'` to COMPLETED, so before
 * this DTO a malformed or missing status silently recorded a sweep that died
 * as a clean night. That is bad data rather than a bad error message, and it
 * is invisible — nobody goes looking at a run that says it succeeded.
 *
 * Refusing the call instead leaves the run OPEN, which the prompts already
 * describe as the loud failure ("a run left open looks to an admin like a
 * sweep still working"). Honest and visible beats silent and wrong.
 *
 * The four totals stay optional for the opposite reason: they land in an
 * UPDATE that skips undefined, so omitting one has always meant "leave it at
 * zero", and a close that 400s over a missing count would strand the run open
 * for no real gain. Both prompts send all four anyway.
 */
export class CloseBugHuntRunDto {
  @ApiProperty({ enum: BUG_HUNT_RUN_CLOSE_STATUSES })
  @IsIn(BUG_HUNT_RUN_CLOSE_STATUSES)
  status!: BugHuntRunCloseStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  foundCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoMergedCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  prOpenedCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  dismissedCount?: number;

  @ApiPropertyOptional({
    description: 'Recorded into run metadata on a FAILED close.',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;
}

export class BugHunterSettingsDto {
  @ApiProperty({
    enum: BugHunterMode,
    description:
      'OFF blocks every trigger. MANUAL and AI both let discovery run; only MANUAL gates the fix stage on an admin approval.',
  })
  mode!: BugHunterMode;

  @ApiProperty({ nullable: true })
  updatedBy!: number | null;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpdateBugHunterSettingsDto {
  @ApiProperty({ enum: BugHunterMode })
  @IsEnum(BugHunterMode)
  mode!: BugHunterMode;
}

export class BugFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugFindingSource })
  source!: BugFindingSource;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({
    nullable: true,
    description:
      "The finder's or reporter's own words, before an admin rewrote them. Null when nobody has edited this bug — `description` is then still original.",
  })
  originalDescription!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who last rewrote the description.',
  })
  descriptionEditedBy!: number | null;

  @ApiProperty({ nullable: true })
  descriptionEditedAt!: Date | null;

  @ApiProperty({ nullable: true })
  file!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Function/class/route/component the finding sits on. Part of the dedupe key.',
  })
  symbol!: string | null;

  @ApiProperty({ nullable: true })
  evidence!: string | null;

  @ApiProperty({ enum: BugFindingSeverity, nullable: true })
  severity!: BugFindingSeverity | null;

  @ApiProperty()
  proven!: boolean;

  @ApiProperty()
  touchesGuardedPath!: boolean;

  @ApiProperty({ nullable: true })
  reportedBugId!: string | null;

  @ApiProperty({ enum: BugFindingStatus })
  status!: BugFindingStatus;

  @ApiProperty({ nullable: true })
  prUrl!: string | null;

  @ApiProperty({ nullable: true })
  escalationQuestion!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnswer!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredBy!: number | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredAt!: Date | null;

  @ApiProperty({ nullable: true })
  decidedBy!: number | null;

  @ApiProperty({ nullable: true })
  decidedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'GitHub Actions run doing the fixing. Null until the reconcile task correlates the dispatch to a run.',
  })
  sessionRunUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'GitHub Actions run id for the fix session, once resolved. What "Stop fix session" cancels.',
  })
  sessionRunId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'e.g. `v1.4.2` or `admin-v2.1.0`.',
  })
  releaseTag!: string | null;

  @ApiProperty({ nullable: true })
  releaseRunUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who promoted this fix to production.',
  })
  releasedBy!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'When the release workflow finished green — not when it was dispatched.',
  })
  releasedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who pressed "Stop fix session".',
  })
  cancelledBy!: number | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BugFixStepDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '0-based position in the plan.' })
  stepIndex!: number;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ nullable: true })
  stepSummary!: string | null;

  @ApiProperty({ enum: BugFindingStatus })
  status!: BugFindingStatus;

  @ApiProperty({ nullable: true })
  prUrl!: string | null;

  @ApiProperty({ nullable: true })
  releaseTag!: string | null;

  @ApiProperty({ nullable: true })
  sessionRunUrl!: string | null;

  @ApiProperty({ nullable: true })
  releaseRunUrl!: string | null;
}

export class BugFindingDetailDto extends BugFindingDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];

  @ApiProperty({
    type: [BugFixStepDto],
    description:
      "A coordinated fix's ordered steps, one per repo. Empty for an ordinary single-repo bug — its presence is what makes this a multi-repo fix.",
  })
  steps!: BugFixStepDto[];

  @ApiProperty({
    description:
      'Whether "Release to production" should be offered right now. False both when the fix is not merged yet and when it is merged but this repo/file cannot be mapped to one deployable.',
  })
  releasable!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'What would be deployed, e.g. "Admin dashboard (CloudFront)" — shown in the release confirmation so the admin sees the blast radius before confirming.',
  })
  releaseTarget!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Why releasing is unavailable despite the fix being merged. Null when releasable, or when the fix simply is not merged yet (no explanation needed for that).',
  })
  releaseBlockedReason!: string | null;
}

export class BugHunterNotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, description: 'Opens this bug when clicked.' })
  findingId!: string | null;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({
    enum: BugHunterNotificationLevel,
    description:
      'Only ACTION_NEEDED means Bug Hunter has stopped and is waiting on you.',
  })
  level!: BugHunterNotificationLevel;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  body!: string | null;

  @ApiProperty({ nullable: true })
  readAt!: Date | null;

  @ApiProperty({ nullable: true })
  readBy!: number | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ListBugHunterNotificationsQueryDto {
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Show only what has not been read. Off by default — coming back to the tab, you want what happened while you were away, not only what nobody has clicked.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class ListBugHunterNotificationsResponseDto {
  @ApiProperty({ type: [BugHunterNotificationDto] })
  items!: BugHunterNotificationDto[];

  @ApiProperty({ description: 'Drives the badge — unread across all levels.' })
  unreadCount!: number;
}

export class BugFixPlanStepDto {
  @ApiProperty({ description: 'Repo this step changes.' })
  @IsString()
  repo!: string;

  @ApiProperty({
    description: 'What has to change here, in one or two sentences.',
  })
  @IsString()
  summary!: string;
}

export class RecordBugFixPlanDto {
  @ApiProperty({
    type: [BugFixPlanStepDto],
    description:
      'In DEPENDENCY order — the step that has to ship first comes first. Bug Hunter fixes and releases them in exactly this order.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BugFixPlanStepDto)
  steps!: BugFixPlanStepDto[];
}

export class StartBugFixSessionDto {
  @ApiProperty({
    required: false,
    description:
      'Override for which repo the session should run in. Not sent by the admin dashboard — when the finding has no repo yet (the usual case for a freshly reported bug), Bug Hunter classifies it itself rather than asking the caller to.',
  })
  @IsOptional()
  @IsString()
  repo?: string;
}

export class TriggerBugHuntSweepDto {
  @ApiProperty({
    description:
      'Repo to sweep. Must be one Bug Hunter is configured for — see GET pipeline/repo-commands.',
    example: 'ally-be',
  })
  @IsString()
  repo!: string;

  @ApiPropertyOptional({
    description:
      'Read the whole repo rather than only the last day of commits. Much more expensive, so it is off by default.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deep?: boolean;
}

export class ListBugFindingsQueryDto {
  @ApiProperty({
    enum: [...Object.values(BugFindingStatus), 'all'],
    required: false,
  })
  @IsOptional()
  @IsIn([...Object.values(BugFindingStatus), 'all'])
  status?: BugFindingStatus | 'all';

  @ApiProperty({ enum: BugFindingSource, required: false })
  @IsOptional()
  @IsEnum(BugFindingSource)
  source?: BugFindingSource;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({
    required: false,
    description:
      "Only the findings one sweep touched. A run's own findings are NOT " +
      'necessarily recent: re-triaging a human-reported bug stamps this run ' +
      'onto a row created the day the bug was filed, so this is the only ' +
      'honest way to answer "what did last night produce?".',
  })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListBugFindingsResponseDto {
  @ApiProperty({ type: [BugFindingDto] })
  items!: BugFindingDto[];

  @ApiProperty()
  count!: number;
}

export class AnswerBugFindingDto {
  @ApiProperty()
  @IsString()
  answer!: string;
}

export class EditBugFindingDescriptionDto {
  @ApiProperty({
    description:
      "The bug as you want Bug Hunter to understand it. This becomes the fix agent's entire brief, so it is worth being specific: what breaks, when, and what should happen instead.",
    maxLength: BUG_FINDING_DESCRIPTION_MAX_LENGTH,
  })
  @IsString()
  // Trimmed BEFORE validation, not after: `@IsNotEmpty` is happy with "   ",
  // so without this a whitespace-only body passed the pipe and stored a blank
  // brief — leaving the fix agent's prompt saying "Bug:" and nothing else.
  // Caught by exercising the real endpoint, not by the unit tests.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  // The cap is here because this text is pasted into that same prompt — an
  // accidental log-dump paste would otherwise crowd out the protocol after it.
  @MaxLength(BUG_FINDING_DESCRIPTION_MAX_LENGTH)
  description!: string;
}

export class BugHuntRunDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BugHuntTrigger })
  trigger!: BugHuntTrigger;

  @ApiProperty()
  repo!: string;

  @ApiProperty({ enum: BugHuntRunStatus })
  status!: BugHuntRunStatus;

  @ApiProperty({ nullable: true })
  finishedAt!: Date | null;

  @ApiProperty()
  foundCount!: number;

  @ApiProperty()
  autoMergedCount!: number;

  @ApiProperty()
  prOpenedCount!: number;

  @ApiProperty()
  dismissedCount!: number;

  @ApiProperty({
    description:
      'USD, snapshotted from llm_usage at close time. Cache-blind (see cliReportedCostUsd) — an approximation, not a billed amount.',
  })
  totalTokenCostUsd!: string;

  @ApiProperty({
    nullable: true,
    description:
      "USD, from the Claude Code CLI's own total_cost_usd for this run — prices prompt-cache reads/writes at their real discounted rate, so this is closer to what the Anthropic console shows. Null for runs closed before this was captured, or if the CLI never reported one.",
  })
  cliReportedCostUsd!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Raw input token count backing totalTokenCostUsd. Null for runs closed before this was tracked.',
  })
  totalInputTokens!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Raw output token count backing totalTokenCostUsd. Null for runs closed before this was tracked.',
  })
  totalOutputTokens!: number | null;

  @ApiProperty()
  createdAt!: Date;
}

export class BugHuntRunDetailDto extends BugHuntRunDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];
}

export class ListBugHuntRunsResponseDto {
  @ApiProperty({ type: [BugHuntRunDto] })
  items!: BugHuntRunDto[];
}
