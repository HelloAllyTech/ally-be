import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import { MAX_CUSTOM_RANGE_DAYS } from '../util/analytics-window.util';

/**
 * Supported time windows for the super-admin analytics overview.
 * - 30d / 90d  -> weekly buckets
 * - 12m        -> monthly buckets
 * - all        -> the platform's first row to today, monthly buckets
 *
 * `all` carries no comparison basis: there is no equal-length period before the
 * beginning of the data, so `compare=prev` is ignored for it and `previous`
 * comes back null rather than as a delta against empty history.
 *
 * For an arbitrary period use `from`/`to` on {@link AnalyticsWindowQueryDto}.
 */
export const ANALYTICS_RANGES = ['30d', '90d', '12m', 'all'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/**
 * Bucket granularities a client may explicitly request for a trend. This is the
 * per-chart grouping control on the surface: the window says WHAT period is
 * covered, the bucket says at what grain it is read.
 */
export const ANALYTICS_BUCKETS = ['day', 'week', 'month', 'year'] as const;
export type AnalyticsBucketParam = (typeof ANALYTICS_BUCKETS)[number];

/** Comparison basis a client may request alongside the current window. */
export const ANALYTICS_COMPARE = ['prev'] as const;
export type AnalyticsCompareParam = (typeof ANALYTICS_COMPARE)[number];

/**
 * Echoes the resolved window back to the client so every chart, caption and
 * export can state the period it covers instead of leaving the reader to infer
 * it from a dropdown that may since have moved.
 */
export class AnalyticsWindowDto {
  @ApiProperty({ description: 'Window start (yyyy-mm-dd, inclusive)' })
  from!: string;

  @ApiProperty({ description: 'Window end (yyyy-mm-dd, inclusive)' })
  to!: string;

  @ApiProperty({ description: 'Human-readable window, e.g. "Last 30 days"' })
  label!: string;

  @ApiProperty({ description: 'Whole days spanned' })
  days!: number;

  @ApiProperty({ enum: ANALYTICS_BUCKETS })
  bucket!: AnalyticsBucketParam;

  @ApiProperty({
    description:
      "True when the window spans all of the platform's history. Such a " +
      'window has no comparison basis, so `previous` is always null for it.',
  })
  allTime!: boolean;

  @ApiProperty({
    description:
      'Bucket start (yyyy-mm-dd) of the period that contains today, or null ' +
      'when the window ended in the past. That bucket is still accruing, so ' +
      'its figure can only rise: show it in tables (flagged) and leave it off ' +
      'line and bar charts, where an unfinished period renders as a fall.',
    nullable: true,
    type: String,
  })
  inProgressBucket!: string | null;

  @ApiProperty({
    description: 'Server time the aggregates were computed, ISO 8601',
  })
  computedAt!: string;
}

/**
 * Which parts of a response actually honoured a `tenantId` filter.
 *
 * Some aggregates cannot be attributed to one org — most `llm_usage` rows are
 * deliberately tenantless (judges, autofill, translation), so AI spend is a
 * platform figure. Rather than silently returning platform-wide numbers under a
 * tenant filter, which would read as tenant-specific and be wrong, the response
 * names the sections that stayed platform-wide so the UI can badge them.
 */
export class AnalyticsScopingDto {
  @ApiProperty({
    description:
      'Tenant the response was narrowed to, or null for platform-wide',
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({
    description:
      'Response sections that remain platform-wide despite the tenant filter',
    type: [String],
  })
  unscopedSections!: string[];
}

/**
 * Query params shared by every windowed super-admin analytics endpoint.
 *
 * `range` stays the default so existing clients are unaffected; `from`/`to`
 * override it for an explicit period. `compare` opts into the equal-length
 * preceding window, which is what lets a KPI state its change against a named
 * basis instead of showing a bare number. `tenantId` narrows to one org where
 * the underlying tables can honestly support it — the response says which
 * sections were actually scoped.
 */
export class AnalyticsWindowQueryDto {
  @ApiProperty({
    description: 'Rolling time window. Ignored when `from`/`to` are supplied.',
    enum: ANALYTICS_RANGES,
    default: '30d',
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    description:
      'Bucket granularity; defaults to the endpoint default for the range.',
    enum: ANALYTICS_BUCKETS,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_BUCKETS)
  bucket?: AnalyticsBucketParam;

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

  @ApiProperty({
    description:
      "Set to 'prev' to also return summary aggregates for the equal-length " +
      'window immediately before this one, as the comparison basis for deltas.',
    enum: ANALYTICS_COMPARE,
    required: false,
  })
  @IsOptional()
  @IsIn(ANALYTICS_COMPARE)
  compare?: AnalyticsCompareParam;

  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Sections whose source tables ' +
      'cannot be attributed to a tenant stay platform-wide and are flagged in ' +
      '`scoping.unscopedSections`.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class AnalyticsOverviewQueryDto extends AnalyticsWindowQueryDto {}

export class ConversationDriftQueryDto extends AnalyticsWindowQueryDto {
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

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;
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

  @ApiProperty({
    required: false,
    description:
      'Judge only sessions not yet judged under this rubric version (e.g. ' +
      '"v2"). Without it, "already judged" means any version — which turns a ' +
      're-judge into a no-op, because the sessions worth re-judging are ' +
      'precisely the ones that already carry rows from the old rubric.',
  })
  judgePromptVersion?: string;

  @ApiProperty({
    required: false,
    default: 'gemini-2.5-pro',
    description: 'Judge model the version above belongs to.',
  })
  judgeModel?: string;
  @ApiProperty({
    required: false,
    default: 5,
    description:
      'Sessions judged in parallel (1-20). The default of 5 turns a ~46-hour ' +
      'serial run over a 90-day window into roughly nine. Capped because a ' +
      'backfill is background work sharing a Gemini rate limit and one ' +
      'core-ai task with the live paths, and a 429 storm just converts ' +
      'throughput into sessions a later re-run has to redo.',
  })
  concurrency?: number;
  @ApiProperty({
    required: false,
    default: false,
    description:
      'LEAN BACKFILL. Judge only the labels the current rubric ADDED, copying ' +
      "every other field forward from the session's existing judgment under " +
      '`leanFromPromptVersion`. Roughly a quarter of the cost: the transcript ' +
      'still goes up (input is an eighth the price) but the response carries ' +
      'six labels instead of the full per-turn record.\n\n' +
      'Only valid when the rubric change ADDED labels and redefined none — ' +
      'copying forward a value whose meaning changed would be silently wrong. ' +
      'Never use for sessions judged for the first time; they need a full run.',
  })
  lean?: boolean;

  @ApiProperty({
    required: false,
    default: 'v1',
    description:
      'Which existing judgment the lean pass copies forward. Sessions without ' +
      'a judgment under this version are excluded from the run — there would ' +
      'be nothing to top up.',
  })
  leanFromPromptVersion?: string;
}

export class StartGroundednessBackfillDto {
  @ApiProperty({
    required: false,
    default: 365,
    description:
      'Judge feedback from sessions created in the last N days. Defaults to a ' +
      'year — stored feedback reaches back to Sep 2025, and this metric is ' +
      'worth the full history.',
  })
  sinceDays?: number;

  @ApiProperty({
    required: false,
    description:
      'Judge only sessions not yet judged under this rubric version. Makes ' +
      'the run resumable: re-issue after a failure and it skips what landed.',
  })
  judgePromptVersion?: string;

  @ApiProperty({ required: false, default: 'gemini-2.5-pro' })
  judgeModel?: string;
  @ApiProperty({
    required: false,
    default: 5,
    description:
      'Sessions judged in parallel (1-20). The default of 5 turns a ~46-hour ' +
      'serial run over a 90-day window into roughly nine. Capped because a ' +
      'backfill is background work sharing a Gemini rate limit and one ' +
      'core-ai task with the live paths, and a 429 storm just converts ' +
      'throughput into sessions a later re-run has to redo.',
  })
  concurrency?: number;
}

export class GroundednessBackfillJobDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ description: 'queued | running | done | error' })
  status!: string;
  @ApiProperty({ description: 'Sessions selected for this run' })
  total!: number;
  @ApiProperty() processed!: number;
  @ApiProperty({ description: 'Sessions whose feedback was judged' })
  judged!: number;
  @ApiProperty({
    description:
      'Sessions skipped — no checkable claims, or no transcript to check ' +
      'them against. Not counted as judged: "0 ungrounded" on a session with ' +
      'no feedback would read as perfect feedback.',
  })
  skipped!: number;
  @ApiProperty() claimsJudged!: number;
  @ApiProperty({
    description:
      'Claims the transcript did not bear out (any non-supported verdict)',
  })
  claimsUngrounded!: number;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty({
    description:
      'Sessions whose judge call errored or timed out. Separate from ' +
      '`processed`, which counts attempts: a run where every call times out ' +
      'still reaches processed === total and reports "done", which is exactly ' +
      'how a backfill that judged nothing went unnoticed for ten minutes.',
  })
  failed!: number;
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
  @ApiProperty({
    description:
      'Sessions whose judge call errored or timed out. Separate from ' +
      '`processed`, which counts attempts: a run where every call times out ' +
      'still reaches processed === total and reports "done", which is exactly ' +
      'how a backfill that judged nothing went unnoticed for ten minutes.',
  })
  failed!: number;
}

export class LanguageQualityQueryDto {
  @ApiProperty({ enum: ANALYTICS_RANGES, default: '90d', required: false })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiProperty({
    required: false,
    description: "Filter to one language (languages.value, e.g. 'ta-IN')",
  })
  @IsOptional()
  language?: string;
}

export class LanguageDimensionErrorRateDto {
  @ApiProperty() dimension!: string;
  @ApiProperty({ description: 'comprehension | content | appropriateness' })
  layer!: string;
  @ApiProperty({
    description:
      'Eligible turns for this dimension (garbled-input turns excluded for understanding/adequacy)',
  })
  nTurns!: number;
  @ApiProperty() minorCount!: number;
  @ApiProperty() majorCount!: number;
  @ApiProperty() criticalCount!: number;
  @ApiProperty({
    description: 'Σ(count × weight{1,5,10}) / nTurns × 100',
  })
  weightedRatePer100!: number;
  @ApiProperty({ nullable: true }) dominantCategory!: string | null;
}

export class LanguageRateByLanguageDto {
  @ApiProperty() language!: string;
  @ApiProperty() sessionsJudged!: number;
  @ApiProperty() nTurns!: number;
  @ApiProperty() weightedRatePer100!: number;
}

/** One row of the per-language performance overview (the tab's default,
 *  all-languages view). Everything here is an aggregate; per-session detail
 *  lives in Roleplay Session Logs. */
export class LanguageOverviewRowDto {
  @ApiProperty() language!: string;
  @ApiProperty() sessionsJudged!: number;
  @ApiProperty() nTurns!: number;
  @ApiProperty({ description: 'Weighted errors / 100 turns (severity 1/5/10)' })
  weightedRatePer100!: number;
  @ApiProperty({
    nullable: true,
    description: 'Avg script fidelity %; null = unmeasured',
  })
  scriptFidelityPct!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Avg round-trip WER/CER %; null = unmeasured',
  })
  roundTripWerPct!: number | null;
  @ApiProperty({ description: '% of turns with STT-garbled counselor input' })
  garbledInputPct!: number;
  @ApiProperty({
    nullable: true,
    description: 'Highest weighted-rate dimension',
  })
  worstDimension!: string | null;
  @ApiProperty({
    description: "The worst dimension's weighted rate / 100 turns",
  })
  worstDimensionRatePer100!: number;
}

export class LanguageCategoryCountDto {
  @ApiProperty() dimension!: string;
  @ApiProperty() category!: string;
  @ApiProperty() count!: number;
  @ApiProperty({ description: 'count × severity weight, summed' })
  weighted!: number;
}

export class LanguageIsolationBasisCountDto {
  @ApiProperty({
    description:
      'input_clean | input_garbled | persona_specified | persona_unspecified | pattern_systemic',
  })
  basis!: string;
  @ApiProperty() count!: number;
}

export class LanguageErrorLogRowDto {
  @ApiProperty() scenarioSessionId!: string;
  @ApiProperty() turnIndex!: number;
  @ApiProperty({ nullable: true }) language!: string | null;
  @ApiProperty() dimension!: string;
  @ApiProperty() category!: string;
  @ApiProperty() severity!: string;
  @ApiProperty({ nullable: true }) isolationBasis!: string | null;
  @ApiProperty({ nullable: true }) evidenceQuote!: string | null;
  @ApiProperty({ nullable: true }) reasoning!: string | null;
  @ApiProperty({ nullable: true }) aiText!: string | null;
  @ApiProperty({ nullable: true }) occurredAt!: Date | null;
}

export class LanguageRateByExperimentDto {
  @ApiProperty({
    nullable: true,
    description: 'The experiment-dimension value (version id / model / …)',
  })
  value!: string | null;
  @ApiProperty() sessionsJudged!: number;
  @ApiProperty() nTurns!: number;
  @ApiProperty() weightedRatePer100!: number;
  @ApiProperty({
    required: false,
    type: [String],
    description:
      'changed_from_prev (FR18, scenario versions only): the config elements ' +
      'that differ from the parent version. >1 element = not a valid ' +
      'one-variable experiment.',
  })
  changedFromPrev?: string[];
}

export class LanguageEvalReferenceDto {
  @ApiProperty() name!: string;
  @ApiProperty({
    description:
      '{language?, scenarioVersionId?, promptVersion?, llmModel?} — the saved slice',
  })
  filters!: Record<string, any>;
  @ApiProperty() pinnedAt!: Date;
}

export class SetLanguageEvalReferenceDto {
  @ApiProperty({ required: false, description: 'Display name for the pin' })
  name?: string;
  @ApiProperty({
    required: false,
    description: '{language?, scenarioVersionId?, promptVersion?, llmModel?}',
  })
  filters?: Record<string, any>;
}

export class LanguageDimensionDeltaDto {
  @ApiProperty() dimension!: string;
  @ApiProperty({ description: 'current rate − reference rate (per 100 turns)' })
  delta!: number;
  @ApiProperty() referenceRatePer100!: number;
}

export class LanguageLayerTrendPointDto {
  @ApiProperty({ description: 'Week bucket (ISO date)' }) bucket!: string;
  @ApiProperty({ description: 'comprehension | content | appropriateness' })
  layer!: string;
  @ApiProperty() nTurns!: number;
  @ApiProperty() weightedRatePer100!: number;
}

export class LanguageWerByVoiceDto {
  @ApiProperty({ nullable: true }) voiceId!: string | null;
  @ApiProperty({ nullable: true, description: 'Display name of the TTS voice' })
  voiceName!: string | null;
  @ApiProperty({ description: 'Sessions with a measured round-trip WER' })
  sessions!: number;
  @ApiProperty({ description: 'Average round-trip WER/CER % for this voice' })
  avgRoundTripWerPct!: number;
}

export class LanguageObjectiveMetricsDto {
  @ApiProperty({
    nullable: true,
    description:
      'Avg script fidelity % across judged sessions; null until Phase 2 populates it (renders as "not yet measured").',
  })
  scriptFidelityPct!: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'Round-trip WER % — the Realization gate. Null until Phase 2 ships; a null gate MASKS the audio layer (unmeasured, not fine).',
  })
  roundTripWerPct!: number | null;
}

export class LanguageQualityResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'Judge version all numbers below are computed from (latest run in ' +
      'window). Comparisons are only valid within one judge version.',
  })
  judgeModel!: string | null;
  @ApiProperty({ nullable: true }) judgePromptVersion!: string | null;

  @ApiProperty() sessionsJudged!: number;
  @ApiProperty() turnsJudged!: number;
  @ApiProperty() turnsGarbled!: number;
  @ApiProperty({
    description:
      'Headline: Σ weighted errors (conditioned-out excluded) / turnsJudged × 100. NO 1-5 quality score exists anywhere.',
  })
  totalWeightedRatePer100!: number;

  @ApiProperty({ type: [LanguageDimensionErrorRateDto] })
  errorRateByDimension!: LanguageDimensionErrorRateDto[];

  @ApiProperty({ type: [LanguageRateByLanguageDto] })
  rateByLanguage!: LanguageRateByLanguageDto[];

  @ApiProperty({
    type: [LanguageOverviewRowDto],
    description:
      'Per-language performance overview — the default (all-languages) view.',
  })
  languageOverview!: LanguageOverviewRowDto[];

  @ApiProperty({ type: [LanguageCategoryCountDto] })
  categoryBreakdown!: LanguageCategoryCountDto[];

  @ApiProperty({
    type: [LanguageIsolationBasisCountDto],
    description:
      'The prompt-vs-model split: persona_unspecified = config gap (cheap fix); persona_specified = model ignored an instruction.',
  })
  isolationBasisBreakdown!: LanguageIsolationBasisCountDto[];

  @ApiProperty({ type: [LanguageErrorLogRowDto] })
  errorLog!: LanguageErrorLogRowDto[];

  @ApiProperty({ type: LanguageObjectiveMetricsDto })
  objectiveMetrics!: LanguageObjectiveMetricsDto;

  @ApiProperty({
    type: [LanguageLayerTrendPointDto],
    description:
      'Weighted error rate per layer per week — the FR10 isolation check: a one-variable change should move only its layer.',
  })
  layerTrend!: LanguageLayerTrendPointDto[];

  @ApiProperty({ type: [LanguageRateByExperimentDto] })
  rateByScenarioVersion!: LanguageRateByExperimentDto[];

  @ApiProperty({ type: [LanguageRateByExperimentDto] })
  rateByPromptVersion!: LanguageRateByExperimentDto[];

  @ApiProperty({
    type: [LanguageRateByExperimentDto],
    description:
      'Weighted error rate grouped by WHICH MAIN-AGENT PROMPT ran (e.g. ' +
      'ally_ai_learn_system_main_agent_prompt_full vs ' +
      '..._working_memory_split). Distinct from rateByPromptVersion, which is ' +
      "the prompt's version NUMBER and cannot tell two prompts apart. " +
      'Resolved from scenario_sessions.metadata.promptVersions, written at ' +
      'session time, so it stays accurate when a scenario later switches ' +
      'prompt.',
  })
  rateByMainPrompt!: LanguageRateByExperimentDto[];

  @ApiProperty({ type: [LanguageRateByExperimentDto] })
  rateByModel!: LanguageRateByExperimentDto[];

  @ApiProperty({
    type: [LanguageWerByVoiceDto],
    description:
      'Round-trip WER per TTS voice — the TTS experiment axis. Empty until ' +
      'round-trip WER is measured (Phase 2 / ASR available).',
  })
  werByVoice!: LanguageWerByVoiceDto[];

  @ApiProperty({
    type: LanguageEvalReferenceDto,
    nullable: true,
    description:
      'The pinned reference experiment (FR13); null when none pinned.',
  })
  reference!: LanguageEvalReferenceDto | null;

  @ApiProperty({
    type: [LanguageDimensionDeltaDto],
    description:
      'Per-dimension delta vs the pinned reference (FR16). Only meaningful ' +
      'within one judge version; empty when no reference is pinned.',
  })
  deltaByDimension!: LanguageDimensionDeltaDto[];
}

export class StartLanguageBackfillDto {
  @ApiProperty({
    required: false,
    default: 90,
    description:
      'Judge sessions created in the last N days (default 90 = ~3 months).',
  })
  sinceDays?: number;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Re-judge sessions that already have a judgment (rubric/metric ' +
      'iteration). Default false = only unjudged sessions.',
  })
  rejudge?: boolean;
  @ApiProperty({
    required: false,
    description:
      'Judge only sessions not yet judged under this rubric version (e.g. ' +
      '"v2"). Without it a re-judge is a no-op: every session worth ' +
      're-judging already carries rows from the old rubric.',
  })
  judgePromptVersion?: string;

  @ApiProperty({ required: false, default: 'gemini-2.5-pro' })
  judgeModel?: string;
  @ApiProperty({
    required: false,
    default: 5,
    description:
      'Sessions judged in parallel (1-20). The default of 5 turns a ~46-hour ' +
      'serial run over a 90-day window into roughly nine. Capped because a ' +
      'backfill is background work sharing a Gemini rate limit and one ' +
      'core-ai task with the live paths, and a 429 storm just converts ' +
      'throughput into sessions a later re-run has to redo.',
  })
  concurrency?: number;
}

export class LanguageBackfillJobDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ description: 'queued | running | done | error' })
  status!: string;
  @ApiProperty() total!: number;
  @ApiProperty() processed!: number;
  @ApiProperty() judged!: number;
  @ApiProperty({ description: 'Total error annotations persisted so far.' })
  errorAnnotations!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty({ required: false, nullable: true }) error?: string | null;
  @ApiProperty({
    description:
      'Sessions whose judge call errored or timed out. Separate from ' +
      '`processed`, which counts attempts: a run where every call times out ' +
      'still reaches processed === total and reports "done", which is exactly ' +
      'how a backfill that judged nothing went unnoticed for ten minutes.',
  })
  failed!: number;
}

export class AgentJoinReliabilityQueryDto extends AnalyticsWindowQueryDto {}

export class AgentJoinReliabilityPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({ description: 'Sessions started in this bucket (load proxy)' })
  totalSessions!: number;

  @ApiProperty({ description: 'Sessions where the agent never joined' })
  joinFailures!: number;

  @ApiProperty({ description: 'Join-failure rate as a percentage (0-100)' })
  failureRatePct!: number;

  @ApiProperty({
    description: 'Sessions where the agent joined then left before room end',
  })
  midSessionDrops!: number;

  @ApiProperty({
    nullable: true,
    description: 'Median dispatch->join latency (seconds); null if no joins',
  })
  joinLatencyP50Sec!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'p95 dispatch->join latency (seconds); null if no joins',
  })
  joinLatencyP95Sec!: number | null;

  @ApiProperty({ description: 'Sessions with a conversation (>=1 agent turn)' })
  conversations!: number;

  @ApiProperty({
    description:
      'Suspected mid-session freezes (agent left the last human turn ' +
      'unanswered, or an LLM call timed out)',
  })
  suspectedFreezes!: number;

  @ApiProperty({
    description: 'Suspected-freeze rate over conversations, percent (0-100)',
  })
  freezeRatePct!: number;
}

export class SessionOutcomeMixDto {
  @ApiProperty({ description: 'Ended with a transcript' })
  completed!: number;

  @ApiProperty({ description: 'Ended empty (includes agent-never-joined)' })
  noConversation!: number;

  @ApiProperty({ description: 'Still active' })
  inProgress!: number;
}

export class AgentJoinReliabilityResponseDto {
  @ApiProperty({ enum: ANALYTICS_RANGES })
  range!: AnalyticsRange;

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({ description: 'Bucket granularity (day / week / month)' })
  bucket!: string;

  @ApiProperty({ type: [AgentJoinReliabilityPointDto] })
  points!: AgentJoinReliabilityPointDto[];

  @ApiProperty({ type: SessionOutcomeMixDto })
  outcomeMix!: SessionOutcomeMixDto;
}

export class VoiceLatencyQueryDto extends AnalyticsWindowQueryDto {
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

  @ApiProperty({
    description:
      'Mean LLM time-to-first-token (ms). Live-instrumentation only — null ' +
      "for 'transcript' buckets, which have no way to derive it from " +
      'message timings alone.',
    nullable: true,
  })
  avgLlmTtftMs!: number | null;

  @ApiProperty({
    description: 'Median (p50) LLM time-to-first-token (ms). Null as above.',
    nullable: true,
  })
  p50LlmTtftMs!: number | null;

  @ApiProperty({
    description: 'p95 LLM time-to-first-token (ms). Null as above.',
    nullable: true,
  })
  p95LlmTtftMs!: number | null;

  @ApiProperty({
    description:
      'Prompt-cache hit rate (%), ratio-of-sums per bucket ' +
      '(sum(cachedTokens) / sum(promptTokens)). Live-instrumentation only ' +
      "— null for 'transcript' buckets and for turns predating this being " +
      'instrumented.',
    nullable: true,
  })
  avgCacheHitRatePct!: number | null;

  @ApiProperty({
    description:
      'Turns whose first audio was a thinking-filler. avgMs/p50Ms/p95Ms ' +
      'measure time to the first audio the learner heard, so these turns ' +
      'are timed to the filler, not to the reply.',
  })
  firstAudioFillerTurns!: number;

  @ApiProperty({
    description: 'Turns whose first audio was a predictive interim reply.',
  })
  firstAudioInterimTurns!: number;

  @ApiProperty({
    description: 'Turns whose first audio was the real reply (unmasked).',
  })
  firstAudioReplyTurns!: number;

  @ApiProperty({
    description:
      'Turns with no firstAudioSource recorded — every transcript-derived ' +
      'row, and live rows predating the provenance instrumentation. Reported ' +
      'separately rather than counted as unmasked: they may have been masked ' +
      'and there is no way to tell.',
  })
  firstAudioUnknownTurns!: number;

  @ApiProperty({
    description: 'Mean time-to-first-voice (ms) for filler-first turns.',
    nullable: true,
  })
  avgFirstAudioFillerMs!: number | null;

  @ApiProperty({
    description: 'Mean time-to-first-voice (ms) for interim-first turns.',
    nullable: true,
  })
  avgFirstAudioInterimMs!: number | null;

  @ApiProperty({
    description: 'Mean time-to-first-voice (ms) for reply-first turns.',
    nullable: true,
  })
  avgFirstAudioReplyMs!: number | null;

  @ApiProperty({
    description:
      'Mean time to the REAL reply (ms) — the unmasked pipeline number, ' +
      'which does not move when filler coverage changes. Computed over ' +
      'instrumented turns only, so null for transcript buckets and windows ' +
      'predating the instrumentation.',
    nullable: true,
  })
  avgReplyLatencyMs!: number | null;

  @ApiProperty({
    description: 'Median (p50) time to the real reply (ms). Null as above.',
    nullable: true,
  })
  p50ReplyLatencyMs!: number | null;

  @ApiProperty({
    description: 'p95 time to the real reply (ms). Null as above.',
    nullable: true,
  })
  p95ReplyLatencyMs!: number | null;
}

export class VoiceLatencyByLanguageRowDto {
  @ApiProperty({ description: "Language value (e.g. 'en', 'hi-IN')" })
  language!: string;

  @ApiProperty({
    description: 'Live-pipeline turns aggregated for this language',
  })
  turns!: number;

  @ApiProperty({ description: 'Mean voice-to-voice latency (ms)' })
  avgMs!: number;

  @ApiProperty({ description: 'p95 voice-to-voice latency (ms)' })
  p95Ms!: number;

  @ApiProperty({
    description:
      'Mean pure STT finalization time (ms), isolated from the broader avgMs/p95Ms end-to-end latency. Null when no turns in this window have it populated.',
    nullable: true,
  })
  avgSttFinalizeMs!: number | null;
}

export class VoiceLatencyResponseDto {
  @ApiProperty({
    description: 'Time window the trend was computed over',
    enum: ANALYTICS_RANGES,
  })
  range!: AnalyticsRange;

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'Bucket granularity (day / week / month) for this range',
  })
  bucket!: string;

  @ApiProperty({
    description: 'Voice-to-voice latency target line for reference (ms)',
  })
  targetMs!: number;

  @ApiProperty({
    description: 'LLM time-to-first-token target line for reference (ms)',
  })
  llmTtftTargetMs!: number;

  @ApiProperty({
    description:
      'Per-bucket, per-source latency points (sorted by bucket then source). ' +
      'Buckets with no turns are omitted — latency has no meaningful zero.',
    type: [VoiceLatencyPointDto],
  })
  points!: VoiceLatencyPointDto[];

  @ApiProperty({
    description:
      'Live-pipeline voice-to-voice latency (avg/p95), one row per language, ' +
      'over the same window as `points`. Independent of the `language` query ' +
      'filter — always broken out across every language that had traffic.',
    type: [VoiceLatencyByLanguageRowDto],
  })
  byLanguage!: VoiceLatencyByLanguageRowDto[];
}

/**
 * Shared per-session voice-pipeline latency fields — one row averages a
 * single session's turns across every stage of the pipeline. Mirrors
 * {@link RoleplaySessionLatencyRow} (roleplay-session-logs module) minus the
 * deprecated `avgProsodyMs`/`prosodySkippedTurns` fields.
 */
export class VoiceLatencySessionStagesDto {
  @ApiProperty({ description: 'Mean voice-to-voice latency (ms)' })
  avgResponseLatencyMs!: number | null;

  @ApiProperty({ description: 'Median (p50) voice-to-voice latency (ms)' })
  p50ResponseLatencyMs!: number | null;

  @ApiProperty({ description: 'p95 voice-to-voice latency (ms)' })
  p95ResponseLatencyMs!: number | null;

  @ApiProperty({ description: 'Mean end-of-utterance delay (ms)' })
  avgEouDelayMs!: number | null;

  @ApiProperty({ description: 'Mean pure STT finalization time (ms)' })
  avgSttFinalizeMs!: number | null;

  @ApiProperty({ description: 'Mean whole-graph-to-first-token time (ms)' })
  avgLlmTtftMs!: number | null;

  @ApiProperty({ description: 'Mean TTS time-to-first-byte (ms)' })
  avgTtsTtfbMs!: number | null;

  @ApiProperty({ description: 'Mean orchestration overhead (ms)' })
  avgOrchestrationMs!: number | null;

  @ApiProperty({ description: 'Mean main-LLM response generation time (ms)' })
  avgLlmResponseMs!: number | null;

  @ApiProperty({
    description: 'Mean branching-instruction resolution time (ms)',
  })
  avgBranchingMs!: number | null;

  @ApiProperty({ description: 'Mean knowledge-retrieval time (ms)' })
  avgKnowledgeRetrievalMs!: number | null;

  @ApiProperty({ description: 'Mean event-detection fan-out time (ms)' })
  avgProcessEventsMs!: number | null;

  @ApiProperty({ description: 'Mean behavior-detection time (ms)' })
  avgBehaviorsMs!: number | null;

  @ApiProperty({ description: 'Turns where the user interrupted the agent' })
  interruptedTurns!: number;

  @ApiProperty({ description: 'Turns where the main LLM call timed out' })
  llmTimedOutTurns!: number;
}

export class VoiceLatencySessionsQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({ description: 'Restrict to sessions of this simulation' })
  @Type(() => Number)
  @IsInt()
  scenarioId!: number;

  @ApiProperty({
    description: "Filter by the session's language value (e.g. en-IN, hi-IN)",
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;

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
}

export class VoiceLatencySessionsSummaryQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({ description: 'Restrict to sessions of this simulation' })
  @Type(() => Number)
  @IsInt()
  scenarioId!: number;

  @ApiProperty({
    description: "Filter by the session's language value (e.g. en-IN, hi-IN)",
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;
}

export class VoiceLatencySessionRowDto extends VoiceLatencySessionStagesDto {
  @ApiProperty({ description: 'scenario_sessions.id (uuid)' })
  scenarioSessionId!: string;

  @ApiProperty({
    description: 'Session start time (ISO), null if unavailable',
    nullable: true,
  })
  occurredAt!: string | null;

  @ApiProperty({ description: 'Turns aggregated into this session row' })
  turnCount!: number;
}

export class ListVoiceLatencySessionsResponseDto {
  @ApiProperty({ type: [VoiceLatencySessionRowDto] })
  data!: VoiceLatencySessionRowDto[];

  @ApiProperty({
    description: 'Total sessions matching the filter (for pagination)',
  })
  total!: number;

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;
}

export class VoiceLatencySessionsSummaryResponseDto extends VoiceLatencySessionStagesDto {
  @ApiProperty({ description: 'Distinct sessions matching the filter' })
  sessionCount!: number;

  @ApiProperty({ description: 'Turns aggregated across all matching sessions' })
  turnCount!: number;

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;
}

export class VoiceLatencyByScenarioQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({
    description: "Filter by the session's language value (e.g. en-IN, hi-IN)",
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;
}

/**
 * One row per simulation, worst-first — "which simulations are slow RIGHT
 * NOW" (distinct from {@link VoiceLatencySessionRowDto}, which is "this
 * simulation's worst sessions"). Each row is that simulation's single most
 * recent session, not a whole-window average — see
 * `PlatformAnalyticsRepository.getVoiceLatencyByScenario`'s doc-comment for
 * why. Same stage fields as {@link VoiceLatencySessionStagesDto} so a slow
 * scenario's bottleneck stage is visible without a second lookup.
 */
export class VoiceLatencyByScenarioRowDto extends VoiceLatencySessionStagesDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty({ description: 'scenarios.title' })
  scenarioTitle!: string;

  @ApiProperty({
    description: "This simulation's most recent session's start time",
    nullable: true,
  })
  occurredAt!: string | null;

  @ApiProperty({ description: 'Turns aggregated into this row' })
  turnCount!: number;
}

export class VoiceLatencyByScenarioResponseDto {
  @ApiProperty({ type: [VoiceLatencyByScenarioRowDto] })
  rows!: VoiceLatencyByScenarioRowDto[];

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'True if the platform has more simulations with matching turns than ' +
      'the defensive cap (VOICE_LATENCY_BY_SCENARIO_LIMIT) — the worst ones ' +
      'are still shown first, but the tail was cut rather than silently ' +
      'omitted without a flag.',
  })
  truncated!: boolean;
}

export class StartLatencyQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({
    description: "Filter by the session's language value (e.g. en-IN, hi-IN)",
    required: false,
  })
  @IsOptional()
  language?: string;
}

export class StartLatencyPointDto {
  @ApiProperty({ description: 'Bucket start date (ISO yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description:
      "How the metric was produced: 'pipeline' (live agent, full segment " +
      "breakdown) or 'transcript' (historical, total only — excludes the " +
      'pre-join configure/initialize time)',
  })
  source!: string;

  @ApiProperty({ description: 'Sessions aggregated into this bucket' })
  sessions!: number;

  @ApiProperty({
    description: 'Mean total start latency / time-to-first-word (ms)',
  })
  avgMs!: number;

  @ApiProperty({ description: 'Median (p50) total start latency (ms)' })
  p50Ms!: number;

  @ApiProperty({ description: 'p95 total start latency (ms)' })
  p95Ms!: number;

  @ApiProperty({
    description: 'Mean configure() segment (ms); 0 for transcript',
  })
  configureMs!: number;

  @ApiProperty({
    description: 'Mean initialize() segment (ms); 0 for transcript',
  })
  initializeMs!: number;

  @ApiProperty({
    description: 'Mean connect (session.start + join) segment (ms)',
  })
  connectMs!: number;

  @ApiProperty({
    description: 'Mean prep (orchestrator + background audio) segment (ms)',
  })
  prepMs!: number;
}

export class StartLatencyResponseDto {
  @ApiProperty({
    description: 'Time window the trend was computed over',
    enum: ANALYTICS_RANGES,
  })
  range!: AnalyticsRange;

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'Bucket granularity (day / week / month) for this range',
  })
  bucket!: string;

  @ApiProperty({ description: 'Start-latency target line for reference (ms)' })
  targetMs!: number;

  @ApiProperty({
    description:
      'Per-bucket, per-source start-latency points (sorted by bucket then ' +
      'source). Buckets with no sessions are omitted. For pipeline rows the ' +
      'four segment means sum to avgMs; transcript rows carry avgMs only ' +
      '(segments 0).',
    type: [StartLatencyPointDto],
  })
  points!: StartLatencyPointDto[];
}

export class TokenConsumptionQueryDto extends AnalyticsWindowQueryDto {}

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

  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;
  @ApiProperty({ description: 'Sum of estimatedCostUsd across all points' })
  totalEstimatedCostUsd!: number;
  @ApiProperty({ description: 'Sum of totalTokens across all points' })
  totalTokens!: number;
  @ApiProperty({ type: [TokenConsumptionPointDto] })
  points!: TokenConsumptionPointDto[];
}

/**
 * Overview KPI scalars.
 *
 * Every field except `totalUsers` covers the SELECTED window. They used to cover
 * a fixed rolling 30 days and the current ISO week regardless of the range
 * picker, which meant the KPI strip silently reported a different period than
 * the charts beside it — the reader has no way to see that, and compares them
 * anyway. The fields were named `activeUsers30d` / `simsThisWeek` accordingly;
 * both are renamed here because a name that states a period the value does not
 * cover is a bug waiting to be believed.
 */
export class AnalyticsSummaryDto {
  @ApiProperty({
    description:
      'Total registered users as at the end of the window (cumulative, not ' +
      'windowed)',
  })
  totalUsers!: number;

  @ApiProperty({ description: 'Distinct users active within the window' })
  activeUsers!: number;

  @ApiProperty({ description: 'Simulations completed within the window' })
  simulationsCompleted!: number;

  @ApiProperty({
    description:
      'Retention rate (%) — returning active users ÷ all active users, within ' +
      'the window',
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

/**
 * `bucket` was `weekStart`: both of these series were hard-coded to ISO weeks
 * regardless of the requested granularity, so a name that promised a week was
 * accurate. They now honour `bucket`, and a field called `weekStart` holding the
 * first of a month is the kind of name that gets believed.
 */
export class SimulationsCompletedPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({ description: 'Number of simulations completed in the bucket' })
  count!: number;
}

export class RetentionPointDto {
  @ApiProperty({ description: 'Bucket start date (yyyy-mm-dd)' })
  bucket!: string;

  @ApiProperty({
    description: 'Active users whose account was created in this bucket',
  })
  newUsers!: number;

  @ApiProperty({
    description: 'Active users whose account predates this bucket',
  })
  returningUsers!: number;
}

export class UsersByRolePointDto {
  @ApiProperty({ description: 'Role / group name (e.g. SUPER_ADMIN, LEARNER)' })
  role!: string;

  @ApiProperty({ description: 'Distinct users in this role' })
  count!: number;
}

export class AnalyticsOverviewResponseDto {
  @ApiProperty({
    type: AnalyticsWindowDto,
    description: 'The resolved window, for on-surface labelling and exports',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({ type: AnalyticsSummaryDto })
  summary!: AnalyticsSummaryDto;

  @ApiProperty({
    type: AnalyticsSummaryDto,
    nullable: true,
    description:
      'Same scalars over the equal-length preceding window, present only when ' +
      '`compare=prev` — the basis a KPI delta is stated against.',
  })
  previous!: AnalyticsSummaryDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Label for `previous`, e.g. "previous 30 days"',
  })
  previousLabel!: string | null;

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
