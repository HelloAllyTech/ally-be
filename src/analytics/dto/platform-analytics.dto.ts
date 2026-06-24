import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Supported time windows for the super-admin analytics overview.
 * - 30d / 90d  -> weekly buckets
 * - 12m        -> monthly buckets
 */
export const ANALYTICS_RANGES = ['30d', '90d', '12m'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Bucket granularities a client may explicitly request for a trend. */
export const ANALYTICS_BUCKETS = ['day', 'week', 'month'] as const;
export type AnalyticsBucketParam = (typeof ANALYTICS_BUCKETS)[number];

export class AnalyticsOverviewQueryDto {
  @ApiProperty({
    description: 'Time window for the analytics overview',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

export class ConversationDriftQueryDto {
  @ApiProperty({ enum: ANALYTICS_RANGES, default: '90d', required: false })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description: 'Filter by language value (e.g. ta, hi)',
    required: false,
  })
  @IsOptional()
  language?: string;

  @ApiProperty({ description: 'Filter by scenario id', required: false })
  @IsOptional()
  scenarioId?: number;

  @ApiProperty({
    description:
      'Filter by scenario version id (uuid). Use with scenarioId to scope ' +
      'drift to one version of a scenario.',
    required: false,
  })
  @IsOptional()
  scenarioVersionId?: string;

  @ApiProperty({ description: 'Filter by agent LLM model', required: false })
  @IsOptional()
  llmModel?: string;

  @ApiProperty({
    description: 'Filter by provider (openai/gemini/anthropic)',
    required: false,
  })
  @IsOptional()
  llmProvider?: string;

  @ApiProperty({ description: 'Filter by prompt version', required: false })
  @IsOptional()
  promptVersion?: string;
}

export class DriftRateByLanguageDto {
  @ApiProperty() language!: string;
  @ApiProperty() totalSessions!: number;
  @ApiProperty() driftedSessions!: number;
  @ApiProperty({ description: 'driftedSessions / totalSessions, 0..1' })
  driftRate!: number;
}

export class DriftCountDto {
  @ApiProperty({
    description:
      'category value (topic / coherence / attribution / failure / STT)',
  })
  key!: string;
  @ApiProperty({
    description: 'distinct sessions with >=1 turn in this category',
  })
  count!: number;
}

/** Drift rate grouped by an experiment dimension (model / provider / prompt version). */
export class DriftRateByDimensionDto {
  @ApiProperty({ description: "dimension value, or 'unknown' if not captured" })
  key!: string;
  @ApiProperty() totalSessions!: number;
  @ApiProperty() driftedSessions!: number;
  @ApiProperty({ description: 'driftedSessions / totalSessions, 0..1' })
  driftRate!: number;
}

export class DriftSummaryDto {
  @ApiProperty() totalSessions!: number;
  @ApiProperty() driftedSessions!: number;
  @ApiProperty() driftRate!: number;
}

export class DriftHistogramBinDto {
  @ApiProperty({ description: 'First-drift turn index' }) turn!: number;
  @ApiProperty() sessions!: number;
}

export class DriftTrendPointDto {
  @ApiProperty({ description: 'Bucket start, yyyy-mm-dd' }) bucket!: string;
  @ApiProperty({
    description:
      "session source: 'pipeline' (live) | 'transcript' (historical)",
  })
  source!: string;
  @ApiProperty() totalSessions!: number;
  @ApiProperty() driftedSessions!: number;
  @ApiProperty({ description: 'driftedSessions / totalSessions, 0..1' })
  driftRate!: number;
}

export class ConversationDriftResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;
  @ApiProperty({ type: DriftSummaryDto }) summary!: DriftSummaryDto;
  @ApiProperty({ type: [DriftRateByLanguageDto] })
  driftRateByLanguage!: DriftRateByLanguageDto[];
  @ApiProperty({ type: [DriftCountDto] }) attributionMix!: DriftCountDto[];
  @ApiProperty({ type: [DriftCountDto] })
  failureModeBreakdown!: DriftCountDto[];
  // Consolidated "kinds of drift" (sessions affected by each kind, drift-only).
  @ApiProperty({ type: [DriftCountDto] }) kindsOfDrift!: DriftCountDto[];
  // Consolidated "root cause" (drift attribution, drifted sessions only).
  @ApiProperty({ type: [DriftCountDto] }) rootCause!: DriftCountDto[];
  // Per-dimension session distributions (detail; kindsOfDrift is the summary).
  @ApiProperty({ type: [DriftCountDto] }) topicMix!: DriftCountDto[];
  @ApiProperty({ type: [DriftCountDto] }) coherenceMix!: DriftCountDto[];
  // STT failure detail (garble severity + error type).
  @ApiProperty({ type: [DriftCountDto] }) sttGarbleMix!: DriftCountDto[];
  @ApiProperty({ type: [DriftCountDto] }) sttErrorTypeMix!: DriftCountDto[];
  // When drift starts + whether it's improving over time.
  @ApiProperty({ type: [DriftHistogramBinDto] })
  firstDriftTurnHistogram!: DriftHistogramBinDto[];
  @ApiProperty({ type: [DriftTrendPointDto] })
  driftTrend!: DriftTrendPointDto[];
  // Experiment slices.
  @ApiProperty({ type: [DriftRateByDimensionDto] })
  driftRateByModel!: DriftRateByDimensionDto[];
  @ApiProperty({ type: [DriftRateByDimensionDto] })
  driftRateBySttModel!: DriftRateByDimensionDto[];
  @ApiProperty({ type: [DriftRateByDimensionDto] })
  driftRateByPromptVersion!: DriftRateByDimensionDto[];
  // Drift rate per scenario version (compare v1 vs v2 …). Populated only when a
  // scenarioId filter is set; empty otherwise (labels collide across scenarios).
  @ApiProperty({ type: [DriftRateByDimensionDto] })
  driftRateByScenarioVersion!: DriftRateByDimensionDto[];
}

export class StartDriftBackfillDto {
  @ApiProperty({
    required: false,
    default: 90,
    description:
      'Judge sessions created in the last N days (default 90 = ~3 months).',
  })
  sinceDays?: number;
}

export class DriftBackfillJobDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ description: 'queued | running | done | error' })
  status!: string;
  @ApiProperty() total!: number;
  @ApiProperty() processed!: number;
  @ApiProperty() judged!: number;
  @ApiProperty() drifted!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty({ required: false, nullable: true }) error?: string | null;
}

export class VoiceLatencyQueryDto {
  @ApiProperty({
    description: 'Time window for the voice-to-voice latency trend',
    enum: ANALYTICS_RANGES,
    default: '90d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Bucket granularity. Defaults to the range default ' +
      '(30d -> day, 90d -> week, 12m -> month) when omitted.',
    enum: ANALYTICS_BUCKETS,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_BUCKETS)
  bucket?: AnalyticsBucketParam;

  @ApiProperty({
    description: "Filter by the session's language value (e.g. en-IN, hi-IN)",
    required: false,
  })
  @IsOptional()
  language?: string;
}

export class VoiceLatencyPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      "How the metric was produced: 'pipeline' (live agent, full breakdown) " +
      "or 'transcript' (historical, derived from message timings)",
  })
  source!: string;

  @ApiProperty({ description: 'Turns aggregated into this bucket' })
  turns!: number;

  @ApiProperty({ description: 'Mean voice-to-voice latency (ms)' })
  avgMs!: number;

  @ApiProperty({ description: 'Median (p50) voice-to-voice latency (ms)' })
  p50Ms!: number;

  @ApiProperty({ description: 'p95 voice-to-voice latency (ms)' })
  p95Ms!: number;
}

export class VoiceLatencyResponseDto {
  @ApiProperty({
    description: 'Time window the trend was computed over',
    enum: ANALYTICS_RANGES,
  })
  range!: AnalyticsRange;

  @ApiProperty({
    description: 'Bucket granularity (day / week / month) for this range',
  })
  bucket!: string;

  @ApiProperty({
    description: 'Latency target line for reference (ms)',
  })
  targetMs!: number;

  @ApiProperty({
    description:
      'Per-bucket, per-source latency points (sorted by bucket then source). ' +
      'Buckets with no turns are omitted — latency has no meaningful zero.',
    type: [VoiceLatencyPointDto],
  })
  points!: VoiceLatencyPointDto[];
}

export class TokenConsumptionQueryDto {
  @ApiProperty({
    description: 'Time window for the token-consumption breakdown',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

export class TokenConsumptionPointDto {
  @ApiProperty({ description: "AI service: 'llm' | 'stt' | 'tts'" })
  service!: string;
  @ApiProperty({ description: 'Model id (LLM/STT) or voice/model id (TTS)' })
  model!: string;
  @ApiProperty({
    description:
      'Provider, e.g. openai / anthropic / gemini / deepgram / elevenlabs',
  })
  provider!: string;
  @ApiProperty({ description: 'LlmTask value (operation type)' }) task!: string;
  @ApiProperty() promptTokens!: number;
  @ApiProperty() completionTokens!: number;
  @ApiProperty() totalTokens!: number;
  @ApiProperty({ description: 'Cached/prompt-cache tokens (subset of prompt)' })
  cachedTokens!: number;
  @ApiProperty({ description: 'STT billable audio duration (ms)' })
  audioMs!: number;
  @ApiProperty({ description: 'TTS billable synthesized characters' })
  characters!: number;
  @ApiProperty({ description: 'Number of calls in this slice' })
  calls!: number;
  @ApiProperty({ description: 'Estimated cost (USD) from the pricing tables' })
  estimatedCostUsd!: number;
  @ApiProperty({ description: 'false when the row has no pricing entry' })
  priced!: boolean;
}

export class TokenConsumptionResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES }) range!: AnalyticsRange;
  @ApiProperty({ description: 'Sum of estimatedCostUsd across all points' })
  totalEstimatedCostUsd!: number;
  @ApiProperty({ description: 'Sum of totalTokens across all points' })
  totalTokens!: number;
  @ApiProperty({ type: [TokenConsumptionPointDto] })
  points!: TokenConsumptionPointDto[];
}

export class AnalyticsSummaryDto {
  @ApiProperty({ description: 'Total registered users on the platform' })
  totalUsers!: number;

  @ApiProperty({ description: 'Distinct users active in the last 30 days' })
  activeUsers30d!: number;

  @ApiProperty({ description: 'Simulations completed in the current ISO week' })
  simsThisWeek!: number;

  @ApiProperty({
    description:
      'Retention rate (%) — returning active users ÷ all active users over the last 30 days',
  })
  retentionRatePct!: number;
}

export class UserGrowthPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  date!: string;

  @ApiProperty({ description: 'New users registered in this bucket' })
  newUsers!: number;

  @ApiProperty({
    description: 'Cumulative users up to and including this bucket',
  })
  cumulativeUsers!: number;
}

export class ActiveUsersPointDto {
  @ApiProperty({ description: 'Day (ISO yyyy-mm-dd)' })
  date!: string;

  @ApiProperty({ description: 'Daily active users' })
  dau!: number;

  @ApiProperty({ description: 'Weekly active users (trailing 7 days)' })
  wau!: number;

  @ApiProperty({ description: 'Monthly active users (trailing 30 days)' })
  mau!: number;
}

export class SimulationsCompletedPointDto {
  @ApiProperty({ description: 'ISO week start date (yyyy-mm-dd)' })
  weekStart!: string;

  @ApiProperty({ description: 'Number of simulations completed in the week' })
  count!: number;
}

export class RetentionPointDto {
  @ApiProperty({ description: 'ISO week start date (yyyy-mm-dd)' })
  weekStart!: string;

  @ApiProperty({
    description: 'Active users whose account was created in this week',
  })
  newUsers!: number;

  @ApiProperty({ description: 'Active users whose account predates this week' })
  returningUsers!: number;
}

export class UsersByRolePointDto {
  @ApiProperty({ description: 'Role / group name (e.g. SUPER_ADMIN, LEARNER)' })
  role!: string;

  @ApiProperty({ description: 'Distinct users in this role' })
  count!: number;
}

export class AnalyticsOverviewResponseDto {
  @ApiProperty({ type: AnalyticsSummaryDto })
  summary!: AnalyticsSummaryDto;

  @ApiProperty({ type: [UserGrowthPointDto] })
  userGrowth!: UserGrowthPointDto[];

  @ApiProperty({ type: [ActiveUsersPointDto] })
  activeUsers!: ActiveUsersPointDto[];

  @ApiProperty({ type: [SimulationsCompletedPointDto] })
  simulationsCompleted!: SimulationsCompletedPointDto[];

  @ApiProperty({ type: [RetentionPointDto] })
  retention!: RetentionPointDto[];

  @ApiProperty({ type: [UsersByRolePointDto] })
  usersByRole!: UsersByRolePointDto[];
}
