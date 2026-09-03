import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  ScribeAnalyticsQueryDto,
  ScribeOverviewResponseDto,
  ScribeOverviewSummaryDto,
  ScribeSummaryFailureResponseDto,
} from '../dto/scribe-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { ScribeAnalyticsRepository } from '../repository/scribe-analytics.repository';
import {
  AnalyticsWindow,
  describeWindow,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

// UTC date maths and the range->window mapping live in analytics-window.util,
// shared with the sibling analytics services.

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

  /** Bucket granularity this endpoint defaults to per range. */
  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '12m') return 'month';
    if (range === '90d') return 'week';
    return 'day';
  }

  async getOverview(
    query: ScribeAnalyticsQueryDto,
  ): Promise<ScribeOverviewResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor: ScribeAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive, bucket } = window;
    const tenantId = query.tenantId;
    this.logger.info(
      `Building scribe overview window=[${isoDate(windowStart)},${isoDate(
        endExclusive,
      )}) bucket=${bucket} tenant=${tenantId ?? 'all'} compare=${
        query.compare ?? 'none'
      }`,
    );

    const [sessionRows, outcomeRows, modeRows, captureRows] = await Promise.all(
      [
        this.repo.getSessionsByBucket(
          windowStart,
          endExclusive,
          bucket,
          tenantId,
        ),
        this.repo.getOutcomeCounts(windowStart, endExclusive, tenantId),
        this.repo.getModeCounts(windowStart, endExclusive, tenantId),
        this.repo.getCaptureMethodCounts(windowStart, endExclusive, tenantId),
      ],
    );

    const byBucket = new Map(sessionRows.map((r) => [r.bucket, r.count]));
    const sessionsTrend = generateBucketLabels(
      windowStart,
      endExclusive,
      bucket,
    ).map((key) => ({ bucket: key, count: byBucket.get(key) ?? 0 }));

    const outcome = new Map(outcomeRows.map((r) => [r.key, r.count]));
    const count = (s: ChatSummaryStatus) => outcome.get(s) ?? 0;
    const success = count(ChatSummaryStatus.SUCCESS);
    const failed = count(ChatSummaryStatus.FAILED);
    const processing =
      count(ChatSummaryStatus.PENDING) + count(ChatSummaryStatus.IN_PROGRESS);
    const noAudio = count(ChatSummaryStatus.NO_AUDIO);
    const totalSessions = outcomeRows.reduce((a, r) => a + r.count, 0);

    const { previous, previousLabel } = await this.buildOverviewComparison(
      query,
      window,
    );

    return {
      range: query.range ?? '30d',
      bucket,
      window: describeWindow(window),
      scoping: {
        tenantId: tenantId ?? null,
        // Every scribe aggregate resolves through chats.tenant_id, so a tenant
        // filter applies cleanly to all of them.
        unscopedSections: [],
      },
      previous,
      previousLabel,
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
    query: ScribeAnalyticsQueryDto,
  ): Promise<ScribeSummaryFailureResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor: ScribeAnalyticsService.defaultBucketFor,
    });
    const { start: windowStart, endExclusive, bucket } = window;
    const tenantId = query.tenantId;
    this.logger.info(
      `Building scribe summary-failures window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket} tenant=${
        tenantId ?? 'all'
      }`,
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
      withReportingQuerySlot(() =>
        this.repo.getFailureRateByBucket(
          windowStart,
          endExclusive,
          bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFirstAttemptFailureRateByBucket(
          windowStart,
          endExclusive,
          bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFailureBreakdown(windowStart, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFailuresByMode(windowStart, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFailuresByCaptureMethod(
          windowStart,
          endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFailureRetryableCounts(
          windowStart,
          endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getFailureTimeoutCounts(windowStart, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPhaseDropoff(windowStart, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getSttProviderStats(windowStart, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getSummaryModelStats(windowStart, endExclusive, tenantId),
      ),
    ]);

    const byBucket = new Map(rateRows.map((r) => [r.bucket, r]));
    const firstByBucket = new Map(
      firstAttemptRateRows.map((r) => [r.bucket, r]),
    );
    const failureRateTrend = generateBucketLabels(
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
      range: query.range ?? '30d',
      bucket,
      window: describeWindow(window),
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

  /**
   * Overview summary over the equal-length preceding window, when requested.
   *
   * Only the outcome counts are re-run: everything in the summary derives from
   * them, and the trend is not needed to state a change.
   */
  private async buildOverviewComparison(
    query: ScribeAnalyticsQueryDto,
    window: AnalyticsWindow,
  ): Promise<{
    previous: ScribeOverviewSummaryDto | null;
    previousLabel: string | null;
  }> {
    if (query.compare !== 'prev')
      return { previous: null, previousLabel: null };

    const prev = previousWindow(window);
    const outcomeRows = await this.repo.getOutcomeCounts(
      prev.start,
      prev.endExclusive,
      query.tenantId,
    );

    const outcome = new Map(outcomeRows.map((r) => [r.key, r.count]));
    const count = (st: ChatSummaryStatus) => outcome.get(st) ?? 0;
    const totalSessions = outcomeRows.reduce((a, r) => a + r.count, 0);

    return {
      previous: {
        totalSessions,
        successRatePct:
          totalSessions > 0
            ? round1((count(ChatSummaryStatus.SUCCESS) / totalSessions) * 100)
            : 0,
        processing:
          count(ChatSummaryStatus.PENDING) +
          count(ChatSummaryStatus.IN_PROGRESS),
        noAudio: count(ChatSummaryStatus.NO_AUDIO),
        failed: count(ChatSummaryStatus.FAILED),
      },
      previousLabel: prev.label,
    };
  }
}
