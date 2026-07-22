import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

  @ApiProperty({
    required: false,
    description: 'true = only V2V test sessions, false = only real sessions',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isV2VTest?: boolean;
}

/**
 * Derived, read-model outcome of a session — richer than the binary
 * ScenarioSessionStatus (ACTIVE|ENDED), which can't distinguish a healthy
 * finished session from one that ended with no conversation (e.g. the agent
 * never joined). Computed at read time; not persisted.
 */
export enum RoleplaySessionOutcome {
  /** Session is still ACTIVE. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** ENDED with at least one transcript message. */
  COMPLETED = 'COMPLETED',
  /** ENDED with zero messages — no conversation happened (agent may never have joined). */
  NO_CONVERSATION = 'NO_CONVERSATION',
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
  @ApiProperty({
    enum: RoleplaySessionOutcome,
    description:
      'Derived outcome. NO_CONVERSATION flags ENDED sessions with zero ' +
      'transcript messages (e.g. the agent never joined) — invisible in the ' +
      'raw ACTIVE|ENDED status.',
  })
  outcome!: RoleplaySessionOutcome;
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

  @ApiProperty({ description: 'True when this session was a V2V test run' })
  isV2VTest!: boolean;
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

/** One infrastructure lifecycle milestone in a session's timeline. */
export class RoleplaySessionLifecycleEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    description:
      'ROOM_CREATED | AGENT_DISPATCHED | PARTICIPANT_JOINED | AGENT_JOINED | ' +
      'RECORDING_STARTED | ROOM_FINISHED',
  })
  type!: string;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Small context payload (participant identity, egress id, …)',
  })
  detail!: Record<string, any> | null;
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

  @ApiProperty({
    nullable: true,
    description:
      'Short-lived presigned S3 URL for playback; null when the audio storage bucket is not configured',
  })
  url!: string | null;
}

/** Post-session learner feedback (most recent), when present. */
export class RoleplaySessionFeedbackDto {
  @ApiProperty() rating!: number;
  @ApiProperty({ nullable: true }) feedback!: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
}

/** A superadmin-configured agent test case the actor is scored against. */
export class RoleplaySessionAgentTestCaseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ nullable: true }) description!: string | null;
}

/**
 * LLM-judge evaluation of the roleplay ACTOR agent for a real session, scored
 * against the configured agent test cases. `metrics` maps each goal/metric
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

export class RoleplaySessionLanguageAnnotationDto {
  @ApiProperty({ description: 'AI-turn ordinal within the session' })
  turnIndex!: number;

  @ApiProperty({
    nullable: true,
    description:
      'scenario_session_messages.id of the AI turn (badge anchor in the UI)',
  })
  messageId!: number | null;

  @ApiProperty({ description: 'comprehension | content | appropriateness' })
  layer!: string;

  @ApiProperty() dimension!: string;
  @ApiProperty() category!: string;
  @ApiProperty({ description: 'minor | major | critical' }) severity!: string;

  @ApiProperty({ nullable: true }) isolationBasis!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'STT quality of the counselor input: none | partial | severe',
  })
  inputGarbled!: string | null;

  @ApiProperty({
    description:
      'True when excluded from the dimension error rate (garbled-input conditioning)',
  })
  conditionedOut!: boolean;

  @ApiProperty({ nullable: true }) evidenceQuote!: string | null;
  @ApiProperty({ nullable: true }) reasoning!: string | null;
}

export class RoleplaySessionLanguageQualityDto {
  @ApiProperty() judgeModel!: string;
  @ApiProperty() judgePromptVersion!: string;
  @ApiProperty() turnsJudged!: number;
  @ApiProperty() turnsGarbled!: number;
  @ApiProperty() errorCount!: number;
  @ApiProperty({
    nullable: true,
    description: '% of turns rendered cleanly in the target script (FR2)',
  })
  scriptFidelityPct!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'Round-trip WER/CER % over a sample of this session turns (FR2); null = unmeasured',
  })
  roundTripWerPct!: number | null;
  @ApiProperty({ type: [RoleplaySessionLanguageAnnotationDto] })
  annotations!: RoleplaySessionLanguageAnnotationDto[];
}

export class RoleplaySessionDriftTurnDto {
  @ApiProperty() turnIndex!: number;
  @ApiProperty({ nullable: true }) messageId!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'fully_coherent | minor_disfluency | degrading | mostly_incoherent | gibberish',
  })
  coherence!: string | null;
  @ApiProperty({ nullable: true }) topicLabel!: string | null;
  @ApiProperty({ nullable: true }) inCharacter!: boolean | null;
  @ApiProperty({
    nullable: true,
    description: 'STT garble on the counselor input: none | partial | severe',
  })
  counselorUtteranceGarbled!: string | null;
  @ApiProperty({ nullable: true }) sttErrorType!: string | null;
  @ApiProperty({ nullable: true }) aiReplyFailureMode!: string | null;
  @ApiProperty({ nullable: true }) rootAttribution!: string | null;
  @ApiProperty({ nullable: true }) reasoning!: string | null;
}

export class RoleplaySessionDriftDto {
  @ApiProperty() judgeModel!: string;
  @ApiProperty() judgePromptVersion!: string;
  @ApiProperty({ nullable: true }) sessionDrifted!: boolean | null;
  @ApiProperty({ nullable: true }) firstDriftTurn!: number | null;
  @ApiProperty({ type: [RoleplaySessionDriftTurnDto] })
  turns!: RoleplaySessionDriftTurnDto[];
}

export class RoleplaySessionScenarioVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) versionNumber!: number | null;
  @ApiProperty({ nullable: true }) name!: string | null;
}

export class RoleplaySessionRunConfigDto {
  @ApiProperty({
    type: RoleplaySessionScenarioVersionDto,
    nullable: true,
    description: 'The scenario/metadata version this session ran against',
  })
  scenarioVersion!: RoleplaySessionScenarioVersionDto | null;

  @ApiProperty({
    nullable: true,
    description:
      'Prompt versions the session ran with, as {promptCode: version} ' +
      '(captured at session start). null when not recorded.',
  })
  promptVersions!: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    description:
      'promptCode of the main-agent prompt this simulation selected. null when unset (default prompt).',
  })
  selectedMainPromptCode!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "Effective main-agent prompt variant this session ran: 'GENERIC' " +
      "(English source) or 'MULTILINGUAL' (translated). null for older sessions.",
  })
  mainPromptVariant!: string | null;

  @ApiProperty({ nullable: true }) llmProvider!: string | null;
  @ApiProperty({ nullable: true }) llmModel!: string | null;
  @ApiProperty({ nullable: true }) temperature!: number | null;
  @ApiProperty({ nullable: true }) topP!: number | null;
  @ApiProperty({ nullable: true }) maxTokens!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "STT provider/model configured for the session's language " +
      '(languages.sttProviderConfig) — config source, so it is shown for ' +
      'every session regardless of per-call usage emission.',
  })
  sttProvider!: string | null;
  @ApiProperty({ nullable: true }) sttModel!: string | null;
}

export class RoleplaySessionLogDetailDto extends RoleplaySessionLogRowDto {
  @ApiProperty({
    type: RoleplaySessionRunConfigDto,
    nullable: true,
    description:
      'The configuration this session ran under (prompt versions, scenario ' +
      'version, effective LLM settings). Read from capture at generation time.',
  })
  runConfig!: RoleplaySessionRunConfigDto | null;

  @ApiProperty({
    type: RoleplaySessionDriftDto,
    nullable: true,
    description:
      'Conversation-drift judgment for this session (latest judge run); ' +
      'null when the session has not been drift-judged. Session-level view ' +
      'of the same rows the analytics Drift tab aggregates.',
  })
  drift!: RoleplaySessionDriftDto | null;

  @ApiProperty({
    type: RoleplaySessionLanguageQualityDto,
    nullable: true,
    description:
      'Language-quality judge result for this session (latest judge run); ' +
      'null when the session has not been judged. Session-level view of the ' +
      'same rows the analytics Language tab aggregates.',
  })
  languageQuality!: RoleplaySessionLanguageQualityDto | null;

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
    type: [RoleplaySessionAgentTestCaseDto],
    description: 'The agent test cases the actor is scored against',
  })
  agentTestCases!: RoleplaySessionAgentTestCaseDto[];

  @ApiProperty({ type: [RoleplaySessionLogEventDto] })
  events!: RoleplaySessionLogEventDto[];

  @ApiProperty({
    type: [RoleplaySessionLifecycleEventDto],
    description:
      'Infrastructure lifecycle timeline (room/agent/participant/recording). ' +
      'A missing AGENT_JOINED entry indicates the agent never joined.',
  })
  lifecycle!: RoleplaySessionLifecycleEventDto[];

  @ApiProperty({
    description:
      'Suspected mid-session freeze: the conversation ended on a human turn ' +
      'the agent never answered, or an LLM call timed out during the session.',
  })
  suspectedFreeze!: boolean;

  @ApiProperty({ type: [RoleplaySessionLogMessageDto] })
  transcript!: RoleplaySessionLogMessageDto[];
}
