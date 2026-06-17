import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { DriftJudgeService } from './drift-judge.service';
import {
  ActiveUsersPointDto,
  AnalyticsBucketParam,
  AnalyticsOverviewResponseDto,
  AnalyticsRange,
  ConversationDriftResponseDto,
  DriftBackfillJobDto,
  RetentionPointDto,
  SimulationsCompletedPointDto,
  UserGrowthPointDto,
  VoiceLatencyResponseDto,
} from '../dto/platform-analytics.dto';
import {
  AnalyticsBucket,
  DailyActivityRow,
  NewUsersBucketRow,
  PlatformAnalyticsRepository,
  WeeklyActiveUserRow,
  WeeklyCountRow,
} from '../repository/platform-analytics.repository';

const MS_PER_DAY = 86_400_000;

/** Voice-to-voice latency target (ms) — the reference line on the trend. */
const VOICE_LATENCY_TARGET_MS = 1500;

/**
 * All bucketing/axis math is done in UTC. `date_trunc` on the tz-naive
 * `timestamp` columns is pure calendar math, so the repository's `yyyy-mm-dd`
 * keys line up with this UTC-generated axis regardless of the Node timezone.
 */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function addMonths(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()),
  );
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** ISO week start (Monday 00:00 UTC), matching Postgres `date_trunc('week')`. */
function startOfUtcWeekMonday(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0=Sun .. 6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  return addDays(day, -offset);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
    private readonly driftJudge: DriftJudgeService,
  ) {}

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
   */
  async getOverview(
    range: AnalyticsRange,
  ): Promise<AnalyticsOverviewResponseDto> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    // Exclusive upper bound = start of tomorrow, so all of today is included.
    const endExclusive = addDays(todayStart, 1);

    const bucket: AnalyticsBucket = range === '12m' ? 'month' : 'week';

    let windowStart: Date;
    if (range === '30d') {
      windowStart = addDays(todayStart, -29);
    } else if (range === '90d') {
      windowStart = addDays(todayStart, -89);
    } else {
      windowStart = startOfUtcMonth(addMonths(todayStart, -11));
    }

    // 29-day lookback so trailing 7-/30-day rolls are correct at the left edge.
    const activityStart = addDays(windowStart, -29);

    // Rolling last-30-days window + current ISO week, for the KPI summary.
    const since30 = addDays(now, -30);
    const startOfThisWeek = startOfUtcWeekMonday(now);

    this.logger.info(
      `Building analytics overview range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [
      newUsersBuckets,
      baselineUsers,
      dailyActivity,
      simsByWeek,
      weeklyActive,
      usersByRole,
      totalUsers,
      active30,
      returning30,
      simsThisWeek,
    ] = await Promise.all([
      this.repo.getNewUsersByBucket(windowStart, endExclusive, bucket),
      this.repo.getUserCountBefore(windowStart),
      this.repo.getDailyActivityPairs(activityStart, endExclusive),
      this.repo.getSimulationsCompletedByWeek(windowStart, endExclusive),
      this.repo.getWeeklyActivePairsWithCreatedAt(windowStart, endExclusive),
      this.repo.getUsersByRole(),
      this.repo.getTotalUsers(),
      this.repo.getActiveUserCountSince(since30),
      this.repo.getReturningActiveUserCountSince(since30),
      this.repo.getCompletedSimsSince(startOfThisWeek),
    ]);

    const retentionRatePct =
      active30 > 0
        ? parseFloat(((returning30 / active30) * 100).toFixed(1))
        : 0;

    return {
      summary: {
        totalUsers,
        activeUsers30d: active30,
        simsThisWeek,
        retentionRatePct,
      },
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
        simsByWeek,
        windowStart,
        endExclusive,
      ),
      retention: this.buildRetention(weeklyActive, windowStart, endExclusive),
      usersByRole,
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
      llmModel?: string;
      llmProvider?: string;
      promptVersion?: string;
    } = {},
  ): Promise<ConversationDriftResponseDto> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);
    let windowStart: Date;
    if (range === '30d') windowStart = addDays(todayStart, -29);
    else if (range === '90d') windowStart = addDays(todayStart, -89);
    else windowStart = startOfUtcMonth(addMonths(todayStart, -11));

    const f = { start: windowStart, end: endExclusive, ...filters };
    const trendBucket: AnalyticsBucket =
      range === '30d' ? 'day' : range === '90d' ? 'week' : 'month';

    const [
      byLanguage,
      attributionMix,
      failureModes,
      byModel,
      byProvider,
      byPromptVersion,
      topicMix,
      coherenceMix,
      sttGarbleMix,
      sttErrorTypeMix,
      firstDriftTurnHistogram,
      driftTrendRaw,
    ] = await Promise.all([
      this.repo.getDriftRateByLanguage(f),
      // Attribution + failure mode + kinds describe DRIFTED sessions, so scope
      // to the rollup (driftedOnly) — keeps them consistent with the drift KPI.
      this.repo.getDriftAttributionMix(f, true),
      this.repo.getDriftFailureModeBreakdown(f, true),
      this.repo.getDriftRateByDimension(f, 'llmModel'),
      this.repo.getDriftRateByDimension(f, 'llmProvider'),
      this.repo.getDriftRateByDimension(f, 'promptVersion'),
      this.repo.getDriftSessionCountsBy(f, 'topicLabel', false, true),
      this.repo.getDriftSessionCountsBy(f, 'coherence', false, true),
      // STT input quality is independent of drift — count across ALL sessions.
      this.repo.getDriftSessionCountsBy(f, 'counselorUtteranceGarbled'),
      this.repo.getDriftSessionCountsBy(f, 'sttErrorType', true),
      this.repo.getFirstDriftTurnHistogram(f),
      this.repo.getDriftTrend(f, trendBucket),
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
      driftRateByProvider: withRate(byProvider),
      driftRateByPromptVersion: withRate(byPromptVersion),
    };
  }

  async getVoiceLatency(
    range: AnalyticsRange,
    bucketParam?: AnalyticsBucketParam,
  ): Promise<VoiceLatencyResponseDto> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);

    let defaultBucket: AnalyticsBucket;
    let windowStart: Date;
    if (range === '30d') {
      defaultBucket = 'day';
      windowStart = addDays(todayStart, -29);
    } else if (range === '90d') {
      defaultBucket = 'week';
      windowStart = addDays(todayStart, -89);
    } else {
      defaultBucket = 'month';
      windowStart = startOfUtcMonth(addMonths(todayStart, -11));
    }

    const bucket: AnalyticsBucket = bucketParam ?? defaultBucket;

    this.logger.info(
      `Building voice-latency trend range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const points = await this.repo.getVoiceLatencyByBucket(
      windowStart,
      endExclusive,
      bucket,
    );

    return {
      range,
      bucket,
      targetMs: VOICE_LATENCY_TARGET_MS,
      points,
    };
  }

  /**
   * Generate a contiguous list of bucket start labels (yyyy-mm-dd) spanning the
   * window, so charts get a gap-free axis even for buckets with zero rows.
   */
  private generateBucketLabels(
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): string[] {
    const lastDay = addDays(endExclusive, -1);
    const labels: string[] = [];

    if (bucket === 'month') {
      let cur = startOfUtcMonth(windowStart);
      const last = startOfUtcMonth(lastDay);
      while (cur <= last) {
        labels.push(isoDate(cur));
        cur = addMonths(cur, 1);
      }
    } else {
      let cur = startOfUtcWeekMonday(windowStart);
      const last = startOfUtcWeekMonday(lastDay);
      while (cur <= last) {
        labels.push(isoDate(cur));
        cur = addDays(cur, 7);
      }
    }

    return labels;
  }

  private buildUserGrowth(
    rows: NewUsersBucketRow[],
    baseline: number,
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): UserGrowthPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r.newUsers]));
    const labels = this.generateBucketLabels(windowStart, endExclusive, bucket);

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

  private buildSimulationsCompleted(
    rows: WeeklyCountRow[],
    windowStart: Date,
    endExclusive: Date,
  ): SimulationsCompletedPointDto[] {
    const byWeek = new Map(rows.map((r) => [r.week, r.count]));
    return this.generateBucketLabels(windowStart, endExclusive, 'week').map(
      (weekStart) => ({ weekStart, count: byWeek.get(weekStart) ?? 0 }),
    );
  }

  private buildRetention(
    rows: WeeklyActiveUserRow[],
    windowStart: Date,
    endExclusive: Date,
  ): RetentionPointDto[] {
    const weeks = this.generateBucketLabels(windowStart, endExclusive, 'week');
    const tally = new Map<
      string,
      { newUsers: number; returningUsers: number }
    >();
    for (const w of weeks) tally.set(w, { newUsers: 0, returningUsers: 0 });

    for (const { week, userCreatedAt } of rows) {
      const entry = tally.get(week);
      if (!entry) continue; // outside the visible axis (shouldn't happen)
      const createdWeek = isoDate(
        startOfUtcWeekMonday(parseUtcDate(userCreatedAt)),
      );
      if (createdWeek === week) entry.newUsers += 1;
      else entry.returningUsers += 1;
    }

    return weeks.map((weekStart) => {
      const entry = tally.get(weekStart)!;
      return {
        weekStart,
        newUsers: entry.newUsers,
        returningUsers: entry.returningUsers,
      };
    });
  }
}
