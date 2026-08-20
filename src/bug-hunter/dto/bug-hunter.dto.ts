import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';

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
