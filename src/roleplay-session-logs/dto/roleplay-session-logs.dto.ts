import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ScenarioSessionStatus } from '../../learn/enum/scenario-session-status.enum';
import { SortOrder } from '../../common/type/common.type';

/**
 * Columns a super-admin may sort the roleplay-session-logs list by. Whitelisted
 * (never raw user input interpolated into SQL) — the repository maps each to a
 * concrete column.
 */
export enum RoleplaySessionLogSortBy {
  CREATED_AT = 'createdAt',
  STARTED_AT = 'startedAt',
  ENDED_AT = 'endedAt',
  SCORE = 'score',
  STATUS = 'status',
}

export class ListRoleplaySessionLogsQueryDto {
  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    required: false,
    description:
      'Free-text search over user name, user email and scenario title',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, enum: ScenarioSessionStatus })
  @IsOptional()
  @IsEnum(ScenarioSessionStatus)
  status?: ScenarioSessionStatus;

  @ApiProperty({
    required: false,
    description:
      'Inclusive lower bound (ISO date/datetime) on the session start',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiProperty({
    required: false,
    description:
      'Exclusive-end (ISO date/datetime) upper bound on the session start',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiProperty({
    required: false,
    description: 'Restrict to a single organization (tenant id)',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({
    required: false,
    enum: RoleplaySessionLogSortBy,
    default: RoleplaySessionLogSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(RoleplaySessionLogSortBy)
  sortBy?: RoleplaySessionLogSortBy;

  @ApiProperty({ required: false, enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder;
}

export class RoleplaySessionLogRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() counselorId!: number;
  @ApiProperty({ nullable: true }) counselorName!: string | null;
  @ApiProperty({ nullable: true }) counselorEmail!: string | null;
  @ApiProperty() tenantId!: string;
  @ApiProperty({ nullable: true }) orgName!: string | null;
  @ApiProperty() scenarioId!: number;
  @ApiProperty({ nullable: true }) scenarioTitle!: string | null;
  @ApiProperty({ enum: ScenarioSessionStatus }) status!: ScenarioSessionStatus;
  @ApiProperty({ nullable: true }) startedAt!: Date | null;
  @ApiProperty({ nullable: true }) endedAt!: Date | null;
  @ApiProperty({ nullable: true, description: 'Effective duration in seconds' })
  durationSeconds!: number | null;
  @ApiProperty({ nullable: true }) score!: number | null;
  @ApiProperty({ nullable: true }) platform!: string | null;
  @ApiProperty() createdAt!: Date;

  @ApiProperty({
    nullable: true,
    description:
      'Total LLM tokens (prompt+completion) consumed by the session, summed ' +
      'from `llm_usage`. Null when no usage rows are correlated to the session.',
  })
  totalTokens!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Estimated total USD cost across LLM/STT/TTS, derived at read time from ' +
      'the per-service pricing tables. Null when no usage rows are correlated.',
  })
  estimatedCostUsd!: number | null;

  @ApiProperty({
    description:
      'False when at least one usage row had no pricing entry (cost is then a ' +
      'lower-bound approximation).',
  })
  costPriced!: boolean;
}

export class ListRoleplaySessionLogsResponseDto {
  @ApiProperty({ type: [RoleplaySessionLogRowDto] })
  data!: RoleplaySessionLogRowDto[];

  @ApiProperty({
    description: 'Total rows matching the filters (ignores paging)',
  })
  total!: number;
}

export class RoleplaySessionLogEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty({ nullable: true }) eventName!: string | null;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty({ nullable: true }) score!: number | null;
  @ApiProperty({ nullable: true }) emoji!: string | null;
  @ApiProperty({ nullable: true }) message!: string | null;
}

export class RoleplaySessionLogMessageDto {
  @ApiProperty() id!: number;
  @ApiProperty() senderId!: number;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true }) startSeconds!: number | null;
  @ApiProperty({ nullable: true }) endSeconds!: number | null;
  @ApiProperty() createdAt!: Date;
}

/** A (provider, model) pair used by one of the AI services in the session. */
export class RoleplaySessionModelRefDto {
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
}

/** Distinct models the session used, grouped by AI service. */
export class RoleplaySessionModelsDto {
  @ApiProperty({ type: [RoleplaySessionModelRefDto] })
  llm!: RoleplaySessionModelRefDto[];

  @ApiProperty({ type: [RoleplaySessionModelRefDto] })
  stt!: RoleplaySessionModelRefDto[];

  @ApiProperty({ type: [RoleplaySessionModelRefDto] })
  tts!: RoleplaySessionModelRefDto[];
}

/** One usage bucket of the session, grouped by (service, provider, model). */
export class RoleplaySessionServiceUsageDto {
  @ApiProperty({ description: "'llm' | 'stt' | 'tts'" }) service!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
  @ApiProperty() promptTokens!: number;
  @ApiProperty() completionTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty() cachedTokens!: number;
  @ApiProperty({ description: 'STT billable audio duration (ms)' })
  audioMs!: number;
  @ApiProperty({ description: 'TTS billable synthesized characters' })
  characters!: number;
  @ApiProperty() calls!: number;
  @ApiProperty() estimatedCostUsd!: number;
  @ApiProperty({ description: 'False when this model had no pricing entry' })
  priced!: boolean;
}

/** Token / audio / character consumption + estimated cost for the session. */
export class RoleplaySessionUsageDto {
  @ApiProperty() llmPromptTokens!: number;
  @ApiProperty() llmCompletionTokens!: number;
  @ApiProperty() llmTotalTokens!: number;
  @ApiProperty() llmCachedTokens!: number;
  @ApiProperty({
    description: 'Total STT billable audio across the session (ms)',
  })
  sttAudioMs!: number;
  @ApiProperty({
    description: 'Total TTS billable characters across the session',
  })
  ttsCharacters!: number;
  @ApiProperty({ description: 'Convenience alias of llmTotalTokens' })
  totalTokens!: number;
  @ApiProperty({ description: 'Estimated USD cost summed across all buckets' })
  estimatedCostUsd!: number;
  @ApiProperty({ description: 'False when any bucket was unpriced' })
  priced!: boolean;
  @ApiProperty({ type: [RoleplaySessionServiceUsageDto] })
  byServiceModel!: RoleplaySessionServiceUsageDto[];
}

/**
 * Per-session voice-pipeline latency + quality, aggregated over
 * `scenario_session_turn_metrics` (source='pipeline' only). All *Ms values are
 * milliseconds; null when no pipeline turns were recorded.
 */
export class RoleplaySessionLatencyDto {
  @ApiProperty() turnCount!: number;
  @ApiProperty({ nullable: true }) avgResponseLatencyMs!: number | null;
  @ApiProperty({ nullable: true }) p50ResponseLatencyMs!: number | null;
  @ApiProperty({ nullable: true }) p95ResponseLatencyMs!: number | null;
  @ApiProperty({ nullable: true }) avgEouDelayMs!: number | null;
  @ApiProperty({ nullable: true }) avgLlmTtftMs!: number | null;
  @ApiProperty({ nullable: true }) avgTtsTtfbMs!: number | null;
  @ApiProperty({ nullable: true }) avgOrchestrationMs!: number | null;
  @ApiProperty({ nullable: true }) avgLlmResponseMs!: number | null;
  @ApiProperty({ nullable: true }) avgProsodyMs!: number | null;
  @ApiProperty({ nullable: true }) avgBranchingMs!: number | null;
  @ApiProperty({ nullable: true }) avgKnowledgeRetrievalMs!: number | null;
  @ApiProperty({ nullable: true }) avgProcessEventsMs!: number | null;
  @ApiProperty({ nullable: true }) avgBehaviorsMs!: number | null;
  @ApiProperty() interruptedTurns!: number;
  @ApiProperty() llmTimedOutTurns!: number;
  @ApiProperty() prosodySkippedTurns!: number;
}

/** Pointer to the LiveKit egress recording (S3), when one exists. */
export class RoleplaySessionRecordingDto {
  @ApiProperty() storageKey!: string;
  @ApiProperty() egressId!: string;
}

/** Post-session learner feedback (most recent), when present. */
export class RoleplaySessionFeedbackDto {
  @ApiProperty() rating!: number;
  @ApiProperty({ nullable: true }) feedback!: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
}

/** A superadmin-configured optimisation goal the actor is scored against. */
export class RoleplaySessionOptimisationGoalDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() category!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
}

/**
 * LLM-judge evaluation of the roleplay ACTOR agent for a real session, scored
 * against the configured optimisation goals. `metrics` maps each goal/metric
 * name to a 0-100 score; `compositeScore` is round(mean(metrics)).
 */
export class RoleplaySessionActorEvaluationDto {
  @ApiProperty({
    nullable: true,
    description: 'round(mean(metrics)); null until the evaluation completes',
  })
  compositeScore!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    nullable: true,
    description: 'Goal/metric name -> 0-100 score',
  })
  metrics!: Record<string, number> | null;

  @ApiProperty({ nullable: true, description: 'Human-readable judge feedback' })
  markdown!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'IN_PROGRESS | COMPLETED | FAILED',
  })
  status!: string | null;

  @ApiProperty({ nullable: true }) evaluatedAt!: Date | null;

  @ApiProperty({
    description: 'Composite score the session must reach to pass',
  })
  passThreshold!: number;

  @ApiProperty({
    nullable: true,
    description: 'compositeScore >= passThreshold; null until evaluated',
  })
  pass!: boolean | null;
}

export class RoleplaySessionLogDetailDto extends RoleplaySessionLogRowDto {
  @ApiProperty({ nullable: true, description: 'Post-session summary (jsonb)' })
  summary!: Record<string, any> | null;

  @ApiProperty({
    nullable: true,
    description: 'Scenario version this session ran against',
  })
  scenarioVersionId!: string | null;

  @ApiProperty({
    nullable: true,
    description: "Display label of the session's language (e.g. 'English')",
  })
  language!: string | null;

  @ApiProperty({ nullable: true, description: 'Selected voice/persona id' })
  voiceId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Cumulative paused time during the session (ms)',
  })
  totalPausedMs!: number | null;

  @ApiProperty({ type: RoleplaySessionUsageDto, nullable: true })
  usage!: RoleplaySessionUsageDto | null;

  @ApiProperty({ type: RoleplaySessionModelsDto, nullable: true })
  models!: RoleplaySessionModelsDto | null;

  @ApiProperty({ type: RoleplaySessionLatencyDto, nullable: true })
  latency!: RoleplaySessionLatencyDto | null;

  @ApiProperty({ type: RoleplaySessionRecordingDto, nullable: true })
  recording!: RoleplaySessionRecordingDto | null;

  @ApiProperty({ type: RoleplaySessionFeedbackDto, nullable: true })
  feedback!: RoleplaySessionFeedbackDto | null;

  @ApiProperty({
    type: RoleplaySessionActorEvaluationDto,
    nullable: true,
    description: 'Goal-based actor evaluation; null when not yet evaluated',
  })
  actorEvaluation!: RoleplaySessionActorEvaluationDto | null;

  @ApiProperty({
    type: [RoleplaySessionOptimisationGoalDto],
    description: 'The optimisation goals the actor is scored against',
  })
  optimisationGoals!: RoleplaySessionOptimisationGoalDto[];

  @ApiProperty({ type: [RoleplaySessionLogEventDto] })
  events!: RoleplaySessionLogEventDto[];

  @ApiProperty({ type: [RoleplaySessionLogMessageDto] })
  transcript!: RoleplaySessionLogMessageDto[];
}
