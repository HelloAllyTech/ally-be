import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  ScribeOverviewResponseDto,
  ScribeSummaryFailureResponseDto,
} from '../dto/scribe-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { ScribeAnalyticsRepository } from '../repository/scribe-analytics.repository';

const MS_PER_DAY = 86_400_000;

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
function round1(n: number): number {
  return parseFloat(n.toFixed(1));
}
/** For 0..1 ratios the client scales to a percentage, so keep 4 decimals. */
function round4(n: number): number {
  return parseFloat(n.toFixed(4));
}

/** Fixed display order for the outcome donut. */
const OUTCOME_ORDER: ChatSummaryStatus[] = [
  ChatSummaryStatus.SUCCESS,
  ChatSummaryStatus.FAILED,
  ChatSummaryStatus.IN_PROGRESS,
  ChatSummaryStatus.PENDING,
  ChatSummaryStatus.NO_AUDIO,
];

@Injectable()
export class ScribeAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    ScribeAnalyticsService.name,
  );

  constructor(private readonly repo: ScribeAnalyticsRepository) {}

  /**
   * Resolve the [windowStart, endExclusive) window and bucket granularity for a
   * range: 30d -> daily, 90d -> weekly, 12m -> monthly. windowStart is aligned
   * to the bucket boundary so the gap-filled axis is clean.
   */
  private resolveWindow(range: AnalyticsRange): {
    windowStart: Date;
    endExclusive: Date;
    bucket: AnalyticsBucket;
  } {
    const todayStart = startOfUtcDay(new Date());
    const endExclusive = addDays(todayStart, 1);

    if (range === '12m') {
      return {
        windowStart: startOfUtcMonth(addMonths(todayStart, -11)),
        endExclusive,
        bucket: 'month',
      };
    }
    if (range === '90d') {
      return {
        windowStart: startOfUtcWeekMonday(addDays(todayStart, -89)),
        endExclusive,
        bucket: 'week',
      };
    }
    return {
      windowStart: addDays(todayStart, -29),
      endExclusive,
      bucket: 'day',
    };
  }

  /** Ordered list of bucket keys (yyyy-mm-dd) spanning [start, end). */
  private axisKeys(start: Date, end: Date, bucket: AnalyticsBucket): string[] {
    const keys: string[] = [];
    let cursor =
      bucket === 'month'
        ? startOfUtcMonth(start)
        : bucket === 'week'
          ? startOfUtcWeekMonday(start)
          : startOfUtcDay(start);
    const endMs = end.getTime();
    // Guard against pathological loops.
    let guard = 0;
    while (cursor.getTime() < endMs && guard < 1000) {
      keys.push(isoDate(cursor));
      cursor =
        bucket === 'month'
          ? addMonths(cursor, 1)
          : bucket === 'week'
            ? addDays(cursor, 7)
            : addDays(cursor, 1);
      guard += 1;
    }
    return keys;
  }

  async getOverview(range: AnalyticsRange): Promise<ScribeOverviewResponseDto> {
    const { windowStart, endExclusive, bucket } = this.resolveWindow(range);
    this.logger.info(
      `Building scribe overview range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [sessionRows, outcomeRows, modeRows, captureRows] = await Promise.all(
      [
        this.repo.getSessionsByBucket(windowStart, endExclusive, bucket),
        this.repo.getOutcomeCounts(windowStart, endExclusive),
        this.repo.getModeCounts(windowStart, endExclusive),
        this.repo.getCaptureMethodCounts(windowStart, endExclusive),
      ],
    );

    const byBucket = new Map(sessionRows.map((r) => [r.bucket, r.count]));
    const sessionsTrend = this.axisKeys(windowStart, endExclusive, bucket).map(
      (key) => ({ bucket: key, count: byBucket.get(key) ?? 0 }),
    );

    const outcome = new Map(outcomeRows.map((r) => [r.key, r.count]));
    const count = (s: ChatSummaryStatus) => outcome.get(s) ?? 0;
    const success = count(ChatSummaryStatus.SUCCESS);
    const failed = count(ChatSummaryStatus.FAILED);
    const processing =
      count(ChatSummaryStatus.PENDING) + count(ChatSummaryStatus.IN_PROGRESS);
    const noAudio = count(ChatSummaryStatus.NO_AUDIO);
    const totalSessions = outcomeRows.reduce((a, r) => a + r.count, 0);

    return {
      range,
      bucket,
      summary: {
        totalSessions,
        // Share of ALL sessions that produced a summary, so this KPI equals the
        // "Summarised" slice of the outcome donut (both over totalSessions). We
        // intentionally do NOT exclude No-audio from the denominator: it keeps
        // every dashboard % on one base and No-audio stays visible as its own
        // tile.
        successRatePct:
          totalSessions > 0 ? round1((success / totalSessions) * 100) : 0,
        processing,
        noAudio,
        failed,
      },
      sessionsTrend,
      outcomeBreakdown: OUTCOME_ORDER.map((s) => ({
        key: s,
        count: count(s),
      })),
      modeBreakdown: modeRows,
      captureBreakdown: captureRows,
    };
  }

  async getSummaryFailures(
    range: AnalyticsRange,
  ): Promise<ScribeSummaryFailureResponseDto> {
    const { windowStart, endExclusive, bucket } = this.resolveWindow(range);
    this.logger.info(
      `Building scribe summary-failures range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [
      rateRows,
      firstAttemptRateRows,
      breakdownRows,
      modeRows,
      captureRows,
      retryableRows,
      timeoutRows,
      phaseDropoffRows,
      sttProviderStats,
      summaryModelStats,
    ] = await Promise.all([
      this.repo.getFailureRateByBucket(windowStart, endExclusive, bucket),
      this.repo.getFirstAttemptFailureRateByBucket(
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getFailureBreakdown(windowStart, endExclusive),
      this.repo.getFailuresByMode(windowStart, endExclusive),
      this.repo.getFailuresByCaptureMethod(windowStart, endExclusive),
      this.repo.getFailureRetryableCounts(windowStart, endExclusive),
      this.repo.getFailureTimeoutCounts(windowStart, endExclusive),
      this.repo.getPhaseDropoff(windowStart, endExclusive),
      this.repo.getSttProviderStats(windowStart, endExclusive),
      this.repo.getSummaryModelStats(windowStart, endExclusive),
    ]);

    const byBucket = new Map(rateRows.map((r) => [r.bucket, r]));
    const firstByBucket = new Map(
      firstAttemptRateRows.map((r) => [r.bucket, r]),
    );
    const failureRateTrend = this.axisKeys(
      windowStart,
      endExclusive,
      bucket,
    ).map((key) => {
      const row = byBucket.get(key);
      const failed = row?.failed ?? 0;
      const terminal = row?.terminal ?? 0;
      const firstRow = firstByBucket.get(key);
      const firstAttemptFailed = firstRow?.failed ?? 0;
      const firstAttemptTerminal = firstRow?.terminal ?? 0;
      return {
        bucket: key,
        failed,
        terminal,
        // Keep full ratio precision here (0..1). round1 would snap this to the
        // nearest 0.1 — i.e. 10% steps once the client multiplies by 100 — so
        // 14.3% would render as 10%. The client rounds to a 1-decimal percent.
        failureRate: terminal > 0 ? round4(failed / terminal) : 0,
        firstAttemptFailed,
        firstAttemptTerminal,
        firstAttemptFailureRate:
          firstAttemptTerminal > 0
            ? round4(firstAttemptFailed / firstAttemptTerminal)
            : 0,
      };
    });

    // Turn the per-phase drop-off distribution into a cumulative "reached"
    // funnel: reached(phase) = sessions that stopped at this phase or any later
    // one, walking the ladder from the end.
    const stoppedByPhase = new Map(
      phaseDropoffRows.map((r) => [r.key, r.count]),
    );
    const ladder = ScribeAnalyticsRepository.PHASE_LADDER;
    let cumulative = 0;
    const reachedByIndex: number[] = new Array(ladder.length).fill(0);
    for (let i = ladder.length - 1; i >= 0; i--) {
      cumulative += stoppedByPhase.get(ladder[i]) ?? 0;
      reachedByIndex[i] = cumulative;
    }
    const phaseFunnel = ladder.map((phase, i) => ({
      phase,
      reached: reachedByIndex[i],
      stoppedHere: stoppedByPhase.get(phase) ?? 0,
    }));

    const totalTerminal = rateRows.reduce((a, r) => a + r.terminal, 0);
    const totalFailed = rateRows.reduce((a, r) => a + r.failed, 0);
    const retryable =
      retryableRows.find((r) => r.key === 'retryable')?.count ?? 0;
    const timeout = timeoutRows.find((r) => r.key === 'timeout')?.count ?? 0;

    return {
      range,
      bucket,
      summary: {
        totalTerminal,
        totalFailed,
        failureRatePct:
          totalTerminal > 0 ? round1((totalFailed / totalTerminal) * 100) : 0,
        retryableSharePct:
          totalFailed > 0 ? round1((retryable / totalFailed) * 100) : 0,
        timeoutSharePct:
          totalFailed > 0 ? round1((timeout / totalFailed) * 100) : 0,
      },
      failureRateTrend,
      failureBreakdown: breakdownRows,
      failuresByMode: modeRows,
      failuresByCaptureMethod: captureRows,
      phaseFunnel,
      sttProviderStats,
      summaryModelStats,
    };
  }
}
