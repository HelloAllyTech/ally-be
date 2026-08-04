import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { DriftJudgeService } from './drift-judge.service';
import {
  ActiveUsersPointDto,
  AgentJoinReliabilityResponseDto,
  AnalyticsBucketParam,
  AgentJoinReliabilityQueryDto,
  AnalyticsOverviewQueryDto,
  AnalyticsOverviewResponseDto,
  AnalyticsRange,
  AnalyticsSummaryDto,
  ConversationDriftResponseDto,
  DriftBackfillJobDto,
  RetentionPointDto,
  SimulationsCompletedPointDto,
  StartLatencyQueryDto,
  StartLatencyResponseDto,
  TokenConsumptionQueryDto,
  TokenConsumptionResponseDto,
  UserGrowthPointDto,
  VoiceLatencyQueryDto,
  VoiceLatencyResponseDto,
  VoiceLatencySessionsQueryDto,
  VoiceLatencySessionsSummaryQueryDto,
  ListVoiceLatencySessionsResponseDto,
  VoiceLatencySessionsSummaryResponseDto,
} from '../dto/platform-analytics.dto';
import {
  AnalyticsBucket,
  BucketActiveUserRow,
  BucketCountRow,
  DailyActivityRow,
  NewUsersBucketRow,
  PlatformAnalyticsRepository,
} from '../repository/platform-analytics.repository';
import { LlmUsageRepository } from '../repository/llm-usage.repository';
import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';
import { DriftAnalyticsRepository } from '../repository/drift-analytics.repository';
import {
  AnalyticsWindow,
  addDays,
  describeWindow,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
  truncToBucket,
} from '../util/analytics-window.util';

/** Voice-to-voice latency target (ms) — the reference line on the trend. */
const VOICE_LATENCY_TARGET_MS = 1500;

/** Simulation start-latency target (ms) — the reference line on the trend. */
const START_LATENCY_TARGET_MS = 4000;

// UTC date maths and the range->window mapping live in analytics-window.util,
// shared with the sibling analytics services (they each used to keep a private
// copy, which is how the same window could be computed two ways).

function parseUtcDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

@Injectable()
export class PlatformAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    PlatformAnalyticsService.name,
  );

  constructor(
    private readonly repo: PlatformAnalyticsRepository,
    private readonly driftRepo: DriftAnalyticsRepository,
    private readonly driftJudge: DriftJudgeService,
    private readonly llmUsageRepo: LlmUsageRepository,
  ) {}

  /**
   * Bucket granularity the latency/reliability/drift/cost endpoints default to
   * per range. Kept identical to what each of them computed inline, so putting
   * them on the shared window resolver does not re-bucket any live chart.
   */
  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '30d') return 'day';
    if (range === '90d') return 'week';
    return 'month';
  }

  /**
   * Resolve the window for an endpoint that supports `range=all`.
   *
   * The data floor is only measured when it is actually needed — an all-time
   * range with no explicit `from`/`to`. Every other range is pure calendar
   * math and pays nothing for this.
   */
  private async resolveOverviewWindow(
    query: AnalyticsOverviewQueryDto,
    defaultBucketFor: (range: AnalyticsRange) => AnalyticsBucket,
  ): Promise<AnalyticsWindow> {
    const needsFloor =
      (query.range ?? '30d') === 'all' && !query.from && !query.to;
    return resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
  }

  /**
   * AI cost broken down by (service × model × task), converted to an estimated
   * USD cost via the per-service pricing tables (LLM tokens, STT audio minutes,
   * TTS characters). The frontend pivots `points` into a stacked bar with a
   * service/model/task toggle. Raw quantities are the source of truth;
   * `priced=false` flags rows with no pricing entry (cost 0).
   */
  async getTokenConsumption(
    query: TokenConsumptionQueryDto,
  ): Promise<TokenConsumptionResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive } = window;

    this.logger.info(
      `Building AI cost window=[${isoDate(windowStart)},${isoDate(
        endExclusive,
      )})`,
    );

    const rows = await this.llmUsageRepo.getTokenUsageByModelAndTask(
      windowStart,
      endExclusive,
    );

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const points = rows.map((r) => {
      const service = (r.service as AiServiceName) || 'llm';
      const { costUsd, priced } = computeServiceCostUsd(
        service,
        r.provider,
        r.model,
        {
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          audioMs: r.audioMs,
          characters: r.characters,
        },
      );
      return {
        service,
        model: r.model,
        provider: r.provider,
        task: r.task,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        cachedTokens: r.cachedTokens,
        audioMs: r.audioMs,
        characters: r.characters,
        calls: r.calls,
        estimatedCostUsd: round2(costUsd),
        priced,
      };
    });

    return {
      range: query.range ?? '30d',
      window: describeWindow(window),
      totalEstimatedCostUsd: round2(
        points.reduce((sum, p) => sum + p.estimatedCostUsd, 0),
      ),
      totalTokens: points.reduce((sum, p) => sum + p.totalTokens, 0),
      points,
    };
  }

  /**
   * Start the async drift backfill for the last `sinceDays` days (default 90)
   * and return a job id to poll. ally-be owns the session data: it selects,
   * builds transcripts, calls ally-ai's stateless judge, and persists — see
   * {@link DriftJudgeService}.
   *
   * `onlyUnjudged=false` (the default, used by the "Re-run" button) RE-JUDGES
   * every session in the window — the loop for iterating on the judge rubric:
   * edit the prompt in Prompt Management, click re-run, the fresh rubric is
   * fetched and the per-turn rows are overwritten (upsert on
   * session+turn+judgeModel+judgePromptVersion). Pass `onlyUnjudged=true` for
   * the cheap ongoing catch-up (sessions with no judgment yet, no re-spend).
   */
  async startDriftBackfill(
    sinceDays = 90,
    onlyUnjudged = false,
  ): Promise<DriftBackfillJobDto> {
    return this.driftJudge.startBackfill(sinceDays, onlyUnjudged);
  }

  /** Backfill job status for UI progress polling (Redis-backed job registry). */
  async getDriftBackfillStatus(jobId: string): Promise<DriftBackfillJobDto> {
    const job = await this.driftJudge.getJob(jobId);
    if (!job) {
      return {
        jobId,
        status: 'error',
        total: 0,
        processed: 0,
        judged: 0,
        drifted: 0,
        skipped: 0,
        error: 'job not found',
      };
    }
    return job;
  }

  /**
   * Build the consolidated super-admin analytics overview for the given range.
   * - 30d / 90d -> weekly buckets for growth, daily DAU/WAU/MAU series
   * - 12m       -> monthly buckets for growth, daily DAU/WAU/MAU series
   * - all       -> monthly buckets over the platform's whole history
   *
   * `bucket` overrides the default, and now reaches EVERY bucketed series here:
   * user growth, completed simulations and the new-vs-returning split were
   * previously fixed to ISO weeks whatever was asked for, which meant a client
   * asking for monthly data got two monthly charts and two weekly ones with no
   * way to see the difference.
   *
   * The DAU/WAU/MAU series stays daily on purpose — those are trailing-window
   * definitions sampled per day, so re-bucketing them would not re-grain the
   * same metric, it would silently answer a different question.
   */
  async getOverview(
    query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewResponseDto> {
    const window = await this.resolveOverviewWindow(
      query,
      // Growth/retention have always been week-grained here (month at 12m);
      // preserved so existing charts do not silently re-bucket.
      (r) => (r === '12m' ? 'month' : 'week'),
    );
    const windowStart = window.start;
    const endExclusive = window.endExclusive;
    const bucket = window.bucket;

    // 29-day lookback so trailing 7-/30-day rolls are correct at the left edge.
    const activityStart = addDays(windowStart, -29);

    this.logger.info(
      `Building analytics overview window=[${isoDate(windowStart)},${isoDate(
        endExclusive,
      )}) bucket=${bucket} compare=${query.compare ?? 'none'}`,
    );

    const [
      newUsersBuckets,
      baselineUsers,
      dailyActivity,
      simsByBucket,
      activeByBucket,
      usersByRole,
      totalUsers,
      activeInWindow,
      returningInWindow,
      simsInWindow,
    ] = await Promise.all([
      this.repo.getNewUsersByBucket(windowStart, endExclusive, bucket),
      this.repo.getUserCountBefore(windowStart),
      this.repo.getDailyActivityPairs(activityStart, endExclusive),
      this.repo.getSimulationsCompletedByBucket(
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getActivePairsWithCreatedAtByBucket(
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getUsersByRole(),
      this.repo.getTotalUsers(),
      // Summary KPIs now cover the SELECTED window rather than a fixed rolling
      // 30 days / current week. A KPI strip that silently reports a different
      // period than the charts beside it invites exactly the wrong comparison.
      this.repo.getActiveUserCountSince(windowStart, endExclusive),
      this.repo.getReturningActiveUserCountSince(windowStart, endExclusive),
      this.repo.getCompletedSimsSince(windowStart, endExclusive),
    ]);

    const summary = {
      totalUsers,
      activeUsers: activeInWindow,
      simulationsCompleted: simsInWindow,
      retentionRatePct:
        activeInWindow > 0
          ? parseFloat(((returningInWindow / activeInWindow) * 100).toFixed(1))
          : 0,
    };

    const { previous, previousLabel } = await this.buildOverviewComparison(
      query,
      window,
    );

    return {
      window: describeWindow(window),
      summary,
      previous,
      previousLabel,
      userGrowth: this.buildUserGrowth(
        newUsersBuckets,
        baselineUsers,
        windowStart,
        endExclusive,
        bucket,
      ),
      activeUsers: this.buildActiveUsers(
        dailyActivity,
        windowStart,
        endExclusive,
      ),
      simulationsCompleted: this.buildSimulationsCompleted(
        simsByBucket,
        windowStart,
        endExclusive,
        bucket,
      ),
      retention: this.buildRetention(
        activeByBucket,
        windowStart,
        endExclusive,
        bucket,
      ),
      usersByRole,
    };
  }

  /**
   * Summary aggregates over the equal-length preceding window, when requested.
   *
   * `totalUsers` for the previous window is the cumulative count as at that
   * window's end, which is exactly `getUserCountBefore(window.start)` — the same
   * value already fetched as the growth-chart baseline, so the comparison costs
   * one query less than it looks.
   *
   * An all-time window gets no comparison even when one is asked for: nothing
   * precedes the platform's first row, so every delta would be "up from zero".
   */
  private async buildOverviewComparison(
    query: AnalyticsOverviewQueryDto,
    window: AnalyticsWindow,
  ): Promise<{
    previous: AnalyticsSummaryDto | null;
    previousLabel: string | null;
  }> {
    if (query.compare !== 'prev' || window.allTime)
      return { previous: null, previousLabel: null };

    const prev = previousWindow(window);
    const [totalUsersThen, active, returning, sims] = await Promise.all([
      this.repo.getUserCountBefore(prev.endExclusive),
      this.repo.getActiveUserCountSince(prev.start, prev.endExclusive),
      this.repo.getReturningActiveUserCountSince(prev.start, prev.endExclusive),
      this.repo.getCompletedSimsSince(prev.start, prev.endExclusive),
    ]);

    return {
      previous: {
        totalUsers: totalUsersThen,
        activeUsers: active,
        simulationsCompleted: sims,
        retentionRatePct:
          active > 0 ? parseFloat(((returning / active) * 100).toFixed(1)) : 0,
      },
      previousLabel: prev.label,
    };
  }

  /**
   * Voice-to-voice latency trend, split by `source` (pipeline vs transcript).
   * The `range` selects the time window; the bucket granularity defaults to the
   * range (30d -> day, 90d -> week, 12m -> month) but can be overridden via
   * `bucketParam` so the same window can be viewed day- or week-wise.
   *
   * Points are returned as-is from the DB (sorted by bucket then source); no
   * gap-fill, because a bucket with no turns has no meaningful latency value.
   */
  /**
   * Conversation drift analytics over turn_drift_judgment: drift rate per
   * language (primary KPI) + attribution mix + failure-mode breakdown, sliced
   * by the optional experiment filters.
   */
  async getConversationDrift(
    range: AnalyticsRange,
    filters: {
      language?: string;
      scenarioId?: number;
      scenarioVersionId?: string;
      llmModel?: string;
      llmProvider?: string;
      promptVersion?: string;
      from?: string;
      to?: string;
      bucket?: AnalyticsBucketParam;
    } = {},
  ): Promise<ConversationDriftResponseDto> {
    const window = resolveAnalyticsWindow(
      { range, from: filters.from, to: filters.to, bucket: filters.bucket },
      {
        defaultRange: '90d',
        defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
      },
    );
    const { start: windowStart, endExclusive, bucket: trendBucket } = window;

    const f = { start: windowStart, end: endExclusive, ...filters };

    const [
      byLanguage,
      attributionMix,
      failureModes,
      byModel,
      bySttModel,
      byPromptVersion,
      byScenarioVersion,
      topicMix,
      coherenceMix,
      sttGarbleMix,
      sttErrorTypeMix,
      firstDriftTurnHistogram,
      driftTrendRaw,
    ] = await Promise.all([
      this.driftRepo.getDriftRateByLanguage(f),
      // Attribution + failure mode + kinds describe DRIFTED sessions, so scope
      // to the rollup (driftedOnly) — keeps them consistent with the drift KPI.
      this.driftRepo.getDriftAttributionMix(f, true),
      this.driftRepo.getDriftFailureModeBreakdown(f, true),
      // Both the LLM and the STT model can contribute to drift; provider dropped.
      this.driftRepo.getDriftRateByDimension(f, 'llmModel'),
      this.driftRepo.getDriftRateByDimension(f, 'sttModel'),
      this.driftRepo.getDriftRateByDimension(f, 'promptVersion'),
      // Compare drift across the versions of ONE scenario. Only meaningful with
      // a scenarioId filter (version labels collide across scenarios), and it
      // ignores the scenarioVersionId filter so every version of the scenario
      // is charted even while another chart is scoped to a single version.
      filters.scenarioId != null
        ? this.driftRepo.getDriftRateByDimension(
            { ...f, scenarioVersionId: undefined },
            'scenarioVersion',
          )
        : Promise.resolve([]),
      this.driftRepo.getDriftSessionCountsBy(f, 'topicLabel', false, true),
      this.driftRepo.getDriftSessionCountsBy(f, 'coherence', false, true),
      // STT input quality is independent of drift — count across ALL sessions.
      this.driftRepo.getDriftSessionCountsBy(f, 'counselorUtteranceGarbled'),
      this.driftRepo.getDriftSessionCountsBy(f, 'sttErrorType', true),
      this.driftRepo.getFirstDriftTurnHistogram(f),
      this.driftRepo.getDriftTrend(f, trendBucket),
    ]);

    const driftRateByLanguage = byLanguage.map((r) => ({
      language: r.language,
      totalSessions: r.totalSessions,
      driftedSessions: r.driftedSessions,
      driftRate: r.totalSessions > 0 ? r.driftedSessions / r.totalSessions : 0,
    }));
    // {model|provider|promptVersion} → drift rate. These are the "which prompt /
    // LLM config drifted" breakdowns; keys are 'unknown' for sessions judged
    // before generation-config capture (A1/A7) was recording on the agent side.
    const withRate = (
      rows: { key: string; totalSessions: number; driftedSessions: number }[],
    ) =>
      rows.map((r) => ({
        key: r.key,
        totalSessions: r.totalSessions,
        driftedSessions: r.driftedSessions,
        driftRate:
          r.totalSessions > 0 ? r.driftedSessions / r.totalSessions : 0,
      }));
    // One consolidated "kinds of drift" list (sessions affected by each kind) —
    // drift categories only (healthy states excluded), de-duplicated: take
    // off_topic/gibberish from topic, the incoherent levels from coherence, and
    // the LLM failure modes (already excludes 'none'). A session can show
    // several kinds, so these counts overlap — render as colored bars.
    const kindsOfDrift = [
      ...topicMix.filter((r) => r.key === 'off_topic' || r.key === 'gibberish'),
      ...coherenceMix.filter(
        (r) => r.key === 'degrading' || r.key === 'mostly_incoherent',
      ),
      ...failureModes,
    ].filter((r) => r.count > 0);

    // "Root cause" of drift = the STT-vs-LLM attribution, scoped to drifted
    // sessions (above). This answers "why did the drift happen", so it stays
    // aligned with the drift KPI.
    const rootCause = attributionMix.filter((r) => r.count > 0);

    const totalSessions = byLanguage.reduce((a, r) => a + r.totalSessions, 0);
    const driftedSessions = byLanguage.reduce(
      (a, r) => a + r.driftedSessions,
      0,
    );

    return {
      range,
      window: describeWindow(window),
      summary: {
        totalSessions,
        driftedSessions,
        driftRate: totalSessions > 0 ? driftedSessions / totalSessions : 0,
      },
      driftRateByLanguage,
      attributionMix: attributionMix.map((r) => ({
        key: r.key,
        count: r.count,
      })),
      failureModeBreakdown: failureModes.map((r) => ({
        key: r.key,
        count: r.count,
      })),
      kindsOfDrift: kindsOfDrift.map((r) => ({ key: r.key, count: r.count })),
      rootCause: rootCause.map((r) => ({ key: r.key, count: r.count })),
      topicMix: topicMix.map((r) => ({ key: r.key, count: r.count })),
      coherenceMix: coherenceMix.map((r) => ({ key: r.key, count: r.count })),
      sttGarbleMix: sttGarbleMix.map((r) => ({ key: r.key, count: r.count })),
      sttErrorTypeMix: sttErrorTypeMix.map((r) => ({
        key: r.key,
        count: r.count,
      })),
      firstDriftTurnHistogram,
      driftTrend: driftTrendRaw.map((r) => ({
        bucket: r.bucket,
        source: r.source,
        totalSessions: r.totalSessions,
        driftedSessions: r.driftedSessions,
        driftRate:
          r.totalSessions > 0 ? r.driftedSessions / r.totalSessions : 0,
      })),
      driftRateByModel: withRate(byModel),
      driftRateBySttModel: withRate(bySttModel),
      driftRateByPromptVersion: withRate(byPromptVersion),
      driftRateByScenarioVersion: withRate(byScenarioVersion),
    };
  }

  async getVoiceLatency(
    query: VoiceLatencyQueryDto,
  ): Promise<VoiceLatencyResponseDto> {
    const { language } = query;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive, bucket } = window;

    this.logger.info(
      `Building voice-latency trend window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [points, byLanguage] = await Promise.all([
      this.repo.getVoiceLatencyByBucket(
        windowStart,
        endExclusive,
        bucket,
        language,
      ),
      this.repo.getVoiceLatencyByLanguage(windowStart, endExclusive),
    ]);

    return {
      range: query.range ?? '90d',
      window: describeWindow(window),
      bucket,
      targetMs: VOICE_LATENCY_TARGET_MS,
      points,
      byLanguage,
    };
  }

  /** Coerces the raw (possibly string, per-pg-driver) stage aggregates to numbers. */
  private static mapVoiceLatencyStages(row: {
    avgResponseLatencyMs: number | string | null;
    p50ResponseLatencyMs: number | string | null;
    p95ResponseLatencyMs: number | string | null;
    avgEouDelayMs: number | string | null;
    avgSttFinalizeMs: number | string | null;
    avgLlmTtftMs: number | string | null;
    avgTtsTtfbMs: number | string | null;
    avgOrchestrationMs: number | string | null;
    avgLlmResponseMs: number | string | null;
    avgBranchingMs: number | string | null;
    avgKnowledgeRetrievalMs: number | string | null;
    avgProcessEventsMs: number | string | null;
    avgBehaviorsMs: number | string | null;
    interruptedTurns: number | string;
    llmTimedOutTurns: number | string;
  }) {
    const num = (v: number | string | null) => (v != null ? Number(v) : null);
    return {
      avgResponseLatencyMs: num(row.avgResponseLatencyMs),
      p50ResponseLatencyMs: num(row.p50ResponseLatencyMs),
      p95ResponseLatencyMs: num(row.p95ResponseLatencyMs),
      avgEouDelayMs: num(row.avgEouDelayMs),
      avgSttFinalizeMs: num(row.avgSttFinalizeMs),
      avgLlmTtftMs: num(row.avgLlmTtftMs),
      avgTtsTtfbMs: num(row.avgTtsTtfbMs),
      avgOrchestrationMs: num(row.avgOrchestrationMs),
      avgLlmResponseMs: num(row.avgLlmResponseMs),
      avgBranchingMs: num(row.avgBranchingMs),
      avgKnowledgeRetrievalMs: num(row.avgKnowledgeRetrievalMs),
      avgProcessEventsMs: num(row.avgProcessEventsMs),
      avgBehaviorsMs: num(row.avgBehaviorsMs),
      interruptedTurns: Number(row.interruptedTurns) || 0,
      llmTimedOutTurns: Number(row.llmTimedOutTurns) || 0,
    };
  }

  /**
   * Session-wise voice latency for one simulation, paginated, worst-first —
   * the tool this session's ad-hoc Metabase latency-by-language/scenario
   * investigation should have been able to reach for instead of hand-written
   * SQL. See {@link getVoiceLatencySessionsSummary} for the accompanying
   * whole-filtered-set average.
   */
  async getVoiceLatencySessions(
    query: VoiceLatencySessionsQueryDto,
  ): Promise<ListVoiceLatencySessionsResponseDto> {
    const { scenarioId, language, limit = 25, offset = 0 } = query;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive } = window;

    const { rows, total } = await this.repo.getVoiceLatencyBySessions(
      scenarioId,
      language,
      windowStart,
      endExclusive,
      limit,
      offset,
    );

    return {
      data: rows.map((r) => ({
        scenarioSessionId: r.scenarioSessionId,
        occurredAt: r.occurredAt,
        turnCount: Number(r.turnCount) || 0,
        ...PlatformAnalyticsService.mapVoiceLatencyStages(r),
      })),
      total,
      window: describeWindow(window),
    };
  }

  /**
   * Overall average across every session matching the scenario(+language)
   * filter — independent of {@link getVoiceLatencySessions}'s pagination, so
   * paging through sessions never re-triggers (or misleadingly narrows) this
   * number.
   */
  async getVoiceLatencySessionsSummary(
    query: VoiceLatencySessionsSummaryQueryDto,
  ): Promise<VoiceLatencySessionsSummaryResponseDto> {
    const { scenarioId, language } = query;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive } = window;

    const row = await this.repo.getVoiceLatencySessionsSummary(
      scenarioId,
      language,
      windowStart,
      endExclusive,
    );

    return {
      sessionCount: Number(row.sessionCount) || 0,
      turnCount: Number(row.turnCount) || 0,
      window: describeWindow(window),
      ...PlatformAnalyticsService.mapVoiceLatencyStages(row),
    };
  }

  /**
   * Agent-join reliability trend: per-bucket failure rate + join latency
   * percentiles from the session lifecycle log, plus the overall outcome mix.
   * The failure rate is computed here (JS) from the per-bucket counts to avoid
   * divide-by-zero SQL. Window/bucket resolution mirrors getVoiceLatency.
   */
  async getAgentJoinReliability(
    query: AgentJoinReliabilityQueryDto,
  ): Promise<AgentJoinReliabilityResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive, bucket } = window;

    const [rows, outcomeMix, freezeRows] = await Promise.all([
      this.repo.getAgentJoinReliabilityByBucket(
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getSessionOutcomeMix(windowStart, endExclusive),
      this.repo.getSuspectedFreezeByBucket(windowStart, endExclusive, bucket),
    ]);

    // Merge over the UNION of buckets: join-reliability is keyed off the
    // (forward-only) lifecycle log, but freeze signals come from transcripts /
    // turn-metrics which exist historically — so a bucket may have freeze data
    // with no lifecycle rows (and vice versa). Default the missing side to 0.
    const relByBucket = new Map(rows.map((r) => [r.bucket, r]));
    const freezeByBucket = new Map(freezeRows.map((f) => [f.bucket, f]));
    const buckets = Array.from(
      new Set([...relByBucket.keys(), ...freezeByBucket.keys()]),
    ).sort();

    const pct = (num: number, denom: number): number =>
      denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

    const points = buckets.map((b) => {
      const r = relByBucket.get(b);
      const f = freezeByBucket.get(b);
      const totalSessions = r?.totalSessions ?? 0;
      const joinFailures = r?.joinFailures ?? 0;
      const conversations = f?.conversations ?? 0;
      const suspectedFreezes = f?.suspectedFreezes ?? 0;
      return {
        bucket: b,
        totalSessions,
        joinFailures,
        failureRatePct: pct(joinFailures, totalSessions),
        midSessionDrops: r?.midSessionDrops ?? 0,
        joinLatencyP50Sec: r?.joinLatencyP50Sec ?? null,
        joinLatencyP95Sec: r?.joinLatencyP95Sec ?? null,
        conversations,
        suspectedFreezes,
        freezeRatePct: pct(suspectedFreezes, conversations),
      };
    });

    return {
      range: query.range ?? '90d',
      window: describeWindow(window),
      bucket,
      points,
      outcomeMix,
    };
  }

  async getStartLatency(
    query: StartLatencyQueryDto,
  ): Promise<StartLatencyResponseDto> {
    const { language } = query;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: PlatformAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive, bucket } = window;

    this.logger.info(
      `Building start-latency trend window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const points = await this.repo.getStartLatencyByBucket(
      windowStart,
      endExclusive,
      bucket,
      language,
    );

    return {
      range: query.range ?? '90d',
      window: describeWindow(window),
      bucket,
      targetMs: START_LATENCY_TARGET_MS,
      points,
    };
  }

  // Bucket-axis generation lives in analytics-window.util (it also knows the
  // day and year grains this private copy never handled).

  private buildUserGrowth(
    rows: NewUsersBucketRow[],
    baseline: number,
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): UserGrowthPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r.newUsers]));
    const labels = generateBucketLabels(windowStart, endExclusive, bucket);

    let cumulative = baseline;
    return labels.map((date) => {
      const newUsers = byBucket.get(date) ?? 0;
      cumulative += newUsers;
      return { date, newUsers, cumulativeUsers: cumulative };
    });
  }

  private buildActiveUsers(
    rows: DailyActivityRow[],
    windowStart: Date,
    endExclusive: Date,
  ): ActiveUsersPointDto[] {
    const byDay = new Map<string, Set<number>>();
    for (const { day, counselorId } of rows) {
      let set = byDay.get(day);
      if (!set) {
        set = new Set<number>();
        byDay.set(day, set);
      }
      set.add(counselorId);
    }

    const points: ActiveUsersPointDto[] = [];
    for (let d = new Date(windowStart); d < endExclusive; d = addDays(d, 1)) {
      const dayKey = isoDate(d);
      points.push({
        date: dayKey,
        dau: byDay.get(dayKey)?.size ?? 0,
        wau: this.trailingDistinctCount(byDay, d, 7),
        mau: this.trailingDistinctCount(byDay, d, 30),
      });
    }
    return points;
  }

  /** Distinct counselors active within the trailing `n` days ending at `day`. */
  private trailingDistinctCount(
    byDay: Map<string, Set<number>>,
    day: Date,
    n: number,
  ): number {
    const union = new Set<number>();
    for (let i = 0; i < n; i++) {
      const set = byDay.get(isoDate(addDays(day, -i)));
      if (set) {
        for (const id of set) union.add(id);
      }
    }
    return union.size;
  }

  /** Zero-filled: a bucket with no completed simulations really is zero. */
  private buildSimulationsCompleted(
    rows: BucketCountRow[],
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): SimulationsCompletedPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r.count]));
    return generateBucketLabels(windowStart, endExclusive, bucket).map((b) => ({
      bucket: b,
      count: byBucket.get(b) ?? 0,
    }));
  }

  /**
   * Split each bucket's active users into new (account created in that same
   * bucket) and returning. The two partition the bucket's actives, which is what
   * makes them safe to stack.
   *
   * "New" is defined against the CURRENT bucket, so the account-creation date is
   * truncated with the same grain the activity was — comparing a user's creation
   * week against a monthly activity bucket would label almost everyone
   * returning. `truncToBucket` is the JS twin of the SQL `date_trunc` the
   * repository applied, so the two keys are directly comparable.
   */
  private buildRetention(
    rows: BucketActiveUserRow[],
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): RetentionPointDto[] {
    const buckets = generateBucketLabels(windowStart, endExclusive, bucket);
    const tally = new Map<
      string,
      { newUsers: number; returningUsers: number }
    >();
    for (const b of buckets) tally.set(b, { newUsers: 0, returningUsers: 0 });

    for (const row of rows) {
      const entry = tally.get(row.bucket);
      if (!entry) continue; // outside the visible axis (shouldn't happen)
      const createdBucket = isoDate(
        truncToBucket(parseUtcDate(row.userCreatedAt), bucket),
      );
      if (createdBucket === row.bucket) entry.newUsers += 1;
      else entry.returningUsers += 1;
    }

    return buckets.map((b) => {
      const entry = tally.get(b)!;
      return {
        bucket: b,
        newUsers: entry.newUsers,
        returningUsers: entry.returningUsers,
      };
    });
  }
}
