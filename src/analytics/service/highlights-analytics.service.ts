import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  AnalyticsHighlightsQueryDto,
  AnalyticsHighlightsResponseDto,
  CostPerSimPointDto,
  HighlightsSummaryDto,
  PlayTimePointDto,
  PracticeMinutesPointDto,
} from '../dto/highlights-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  AiUsageBucketRow,
  HighlightsAnalyticsRepository,
} from '../repository/highlights-analytics.repository';
import {
  AnalyticsWindow,
  describeWindow,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';
import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Response sections that stay platform-wide even under a `tenantId` filter.
 *
 * AI spend cannot be attributed per-org: most `llm_usage` rows are deliberately
 * tenantless (judges, autofill, translation), so a tenant-filtered cost would
 * report a fraction of real spend while looking like the whole. Org adoption is
 * inherently a cross-org question. Both are reported unfiltered and named here
 * so the UI badges them instead of implying they were scoped.
 */
const TENANT_UNSCOPED_SECTIONS = [
  'summary.totalAiCostUsd',
  'summary.costPerCompletedSimUsd',
  'summary.activeOrgs',
  'costPerSim',
  'topOrgs',
];

/**
 * Bucket granularity this endpoint defaults to per range. `all` resolves to
 * month in the window util, which is where the all-time default belongs — it is
 * a property of the range, not of this endpoint.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket => {
  if (range === '30d') return 'day';
  if (range === '90d') return 'week';
  return 'month';
};

/** Cost + unpriced-call totals accumulated per bucket from raw usage rows. */
type CostByBucket = Map<string, { costUsd: number; unpricedCalls: number }>;

@Injectable()
export class HighlightsAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    HighlightsAnalyticsService.name,
  );

  constructor(private readonly repo: HighlightsAnalyticsRepository) {}

  /**
   * Leadership "Highlights" aggregates: org adoption, practice minutes, mean
   * session length, roleplay quality, learner CSAT, track funnel and AI cost
   * per completed simulation. Count/sum series are gap-filled to a contiguous
   * bucket axis. Average series are never gap-filled with zeros — an average
   * has no meaningful zero, and plotting one would fabricate a measurement:
   * session length is put on the full axis with NULLs, and quality/CSAT are
   * left sparse (the older treatment; nulls are the better of the two, since
   * they keep the x-axis a real calendar).
   *
   * With `compare=prev` the same summary aggregates are also computed over the
   * equal-length preceding window, so each KPI can state its change against a
   * named basis rather than standing alone as a bare number. `range=all` has no
   * such basis and returns none — see {@link buildComparison}.
   */
  async getHighlights(
    query: AnalyticsHighlightsQueryDto,
  ): Promise<AnalyticsHighlightsResponseDto> {
    // The data floor is one extra cheap query, and only for an all-time range.
    const needsFloor =
      (query.range ?? '30d') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const tenantId = query.tenantId;

    this.logger.info(
      `Building highlights window=[${isoDate(window.start)},${isoDate(
        window.endExclusive,
      )}) bucket=${window.bucket} tenant=${tenantId ?? 'all'} compare=${
        query.compare ?? 'none'
      }`,
    );

    const [
      activeOrgs,
      topOrgsResult,
      practiceRows,
      playTimeRows,
      playTimeOverall,
      qualityOverall,
      csatTrend,
      csatOverall,
      funnelCounts,
      quizCounts,
      simsByBucket,
      usageRows,
    ] = await Promise.all([
      withReportingQuerySlot(() =>
        this.repo.getActiveOrgCount(window.start, window.endExclusive),
      ),
      withReportingQuerySlot(() =>
        this.repo.getTopOrgsByCompletedSims(window.start, window.endExclusive),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPracticeMinutesByBucket(
          window.start,
          window.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPlayTimeByBucket(
          window.start,
          window.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPlayTimeOverall(
          window.start,
          window.endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getQualityOverall(
          window.start,
          window.endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCsatTrendByBucket(
          window.start,
          window.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCsatOverall(window.start, window.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getTrackFunnelCounts(
          window.start,
          window.endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getQuizPassCounts(
          window.start,
          window.endExclusive,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCompletedSimulationsByBucket(
          window.start,
          window.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getAiUsageByBucket(
          window.start,
          window.endExclusive,
          window.bucket,
        ),
      ),
    ]);

    const labels = generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    );

    // Practice minutes: gap-fill zeros onto the contiguous axis. Safe here
    // because this is a SUM — "nobody practised that week" really is zero.
    const practiceByBucket = new Map(practiceRows.map((r) => [r.bucket, r]));
    const practiceMinutes: PracticeMinutesPointDto[] = labels.map((b) => ({
      bucket: b,
      minutes: round1(practiceByBucket.get(b)?.minutes ?? 0),
      activeLearners: practiceByBucket.get(b)?.activeLearners ?? 0,
    }));

    // Session length onto the SAME contiguous axis, gap-filled with NULLs.
    // Two wrong answers were available here. Zero would draw a crash in session
    // length where there was simply nobody practising. Leaving the bucket out
    // entirely — what the older average series do — collapses the axis, so a
    // quiet fortnight renders as two adjacent days and the line closes over it
    // invisibly. A null is neither: the calendar stays real and the line breaks
    // where nothing was measured. `sessions` gap-fills to 0 because it is a
    // count, and "no sessions" is a fact.
    const playTimeByBucket = new Map(playTimeRows.map((r) => [r.bucket, r]));
    const playTime: PlayTimePointDto[] = labels.map((b) => {
      const row = playTimeByBucket.get(b);
      return {
        bucket: b,
        avgMinutes: row?.avgMinutes ?? null,
        medianMinutes: row?.medianMinutes ?? null,
        p95Minutes: row?.p95Minutes ?? null,
        sessions: row?.sessions ?? 0,
      };
    });

    const costByBucket = this.accumulateCost(usageRows);
    const simsMap = new Map(simsByBucket.map((r) => [r.bucket, r.count]));
    const costPerSim: CostPerSimPointDto[] = labels.map((b) => {
      const cost = costByBucket.get(b) ?? { costUsd: 0, unpricedCalls: 0 };
      const sims = simsMap.get(b) ?? 0;
      return {
        bucket: b,
        estimatedCostUsd: round2(cost.costUsd),
        completedSimulations: sims,
        costPerSimUsd: sims > 0 ? round2(cost.costUsd / sims) : null,
        unpricedCalls: cost.unpricedCalls,
      };
    });

    const summary = this.buildSummary({
      activeOrgs,
      simsByBucket,
      practiceRows,
      playTimeOverall,
      qualityOverall,
      csatOverall,
      funnelCounts,
      quizCounts,
      costByBucket,
    });

    const { previous, previousLabel } = await this.buildComparison(
      query,
      window,
      tenantId,
    );

    return {
      range: query.range ?? '30d',
      bucket: window.bucket,
      window: describeWindow(window),
      scoping: {
        tenantId: tenantId ?? null,
        unscopedSections: tenantId ? TENANT_UNSCOPED_SECTIONS : [],
      },
      summary,
      previous,
      previousLabel,
      topOrgs: topOrgsResult.rows,
      topOrgsBelowFloor: {
        orgs: topOrgsResult.belowFloor.orgs,
        completedSimulations: topOrgsResult.belowFloor.sims,
      },
      practiceMinutes,
      playTime,
      csatTrend,
      trackFunnel: {
        enrolled: funnelCounts.enrolled,
        started: funnelCounts.started,
        completed: funnelCounts.completed,
        quizAttempts: quizCounts.attempts,
        quizPassed: quizCounts.passed,
        quizPassRatePct:
          quizCounts.attempts > 0
            ? round1((quizCounts.passed / quizCounts.attempts) * 100)
            : null,
      },
      costPerSim,
    };
  }

  /**
   * Summary aggregates for the equal-length preceding window, when requested.
   *
   * Only the scalars are recomputed — the trends are not, because a delta needs
   * one number per window, not a second axis. Skipping the trend queries keeps
   * the comparison to roughly the cost of the summary alone.
   *
   * An all-time window is refused a comparison even when `compare=prev` asks for
   * one: the equal-length period before the platform's first row is empty by
   * construction, so every KPI would report "up from zero" — a fact about the
   * windowing, not about the metric. The surface then shows the bare value with
   * its sample size, which is what a number with no comparison basis is.
   */
  private async buildComparison(
    query: AnalyticsHighlightsQueryDto,
    window: AnalyticsWindow,
    tenantId?: string,
  ): Promise<{
    previous: HighlightsSummaryDto | null;
    previousLabel: string | null;
  }> {
    if (query.compare !== 'prev' || window.allTime)
      return { previous: null, previousLabel: null };

    const prev = previousWindow(window);
    const [
      activeOrgs,
      practiceRows,
      playTimeOverall,
      qualityOverall,
      csatOverall,
      funnelCounts,
      quizCounts,
      simsByBucket,
      usageRows,
    ] = await Promise.all([
      withReportingQuerySlot(() =>
        this.repo.getActiveOrgCount(prev.start, prev.endExclusive),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPracticeMinutesByBucket(
          prev.start,
          prev.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getPlayTimeOverall(prev.start, prev.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getQualityOverall(prev.start, prev.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCsatOverall(prev.start, prev.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getTrackFunnelCounts(prev.start, prev.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getQuizPassCounts(prev.start, prev.endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCompletedSimulationsByBucket(
          prev.start,
          prev.endExclusive,
          window.bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getAiUsageByBucket(
          prev.start,
          prev.endExclusive,
          window.bucket,
        ),
      ),
    ]);

    return {
      previous: this.buildSummary({
        activeOrgs,
        simsByBucket,
        practiceRows,
        playTimeOverall,
        qualityOverall,
        csatOverall,
        funnelCounts,
        quizCounts,
        costByBucket: this.accumulateCost(usageRows),
      }),
      previousLabel: prev.label,
    };
  }

  /**
   * Accumulate estimated USD per bucket. Pricing lives in
   * llm-pricing.constants and is applied at read time — never in SQL.
   *
   * `unpricedCalls` counts calls whose model has no pricing entry: they
   * contribute nothing to the cost, so the total is an UNDERSTATEMENT by an
   * unknown amount. The count travels with the figure so the surface can say so
   * rather than presenting an incomplete total as complete.
   */
  private accumulateCost(usageRows: AiUsageBucketRow[]): CostByBucket {
    const costByBucket: CostByBucket = new Map();
    for (const r of usageRows) {
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
      const acc = costByBucket.get(r.bucket) ?? {
        costUsd: 0,
        unpricedCalls: 0,
      };
      acc.costUsd += costUsd;
      if (!priced) acc.unpricedCalls += r.calls;
      costByBucket.set(r.bucket, acc);
    }
    return costByBucket;
  }

  /** The KPI scalars, shared by the current and comparison windows. */
  private buildSummary({
    activeOrgs,
    simsByBucket,
    practiceRows,
    playTimeOverall,
    qualityOverall,
    csatOverall,
    funnelCounts,
    quizCounts,
    costByBucket,
  }: {
    activeOrgs: number;
    simsByBucket: { count: number }[];
    practiceRows: { minutes: number }[];
    playTimeOverall: { avgMinutes: number | null; sessions: number };
    qualityOverall: {
      avgCompositeScore: number | null;
      evaluatedSessions: number;
    };
    csatOverall: { avgRating: number | null; responses: number };
    funnelCounts: { enrolled: number; completed: number };
    quizCounts: { attempts: number; passed: number };
    costByBucket: CostByBucket;
  }): HighlightsSummaryDto {
    const completedSimulations = simsByBucket.reduce((a, r) => a + r.count, 0);
    const costValues = Array.from(costByBucket.values());
    const totalAiCostUsd = round2(
      costValues.reduce((a, c) => a + c.costUsd, 0),
    );
    const unpricedCalls = costValues.reduce((a, c) => a + c.unpricedCalls, 0);

    return {
      activeOrgs,
      completedSimulations,
      practiceMinutes: Math.round(
        practiceRows.reduce((a, r) => a + r.minutes, 0),
      ),
      avgCompositeScore: qualityOverall.avgCompositeScore,
      evaluatedSessions: qualityOverall.evaluatedSessions,
      avgCsat: csatOverall.avgRating,
      csatResponses: csatOverall.responses,
      trackCompletionRatePct:
        funnelCounts.enrolled > 0
          ? round1((funnelCounts.completed / funnelCounts.enrolled) * 100)
          : null,
      quizPassRatePct:
        quizCounts.attempts > 0
          ? round1((quizCounts.passed / quizCounts.attempts) * 100)
          : null,
      totalAiCostUsd,
      unpricedCalls,
      costPerCompletedSimUsd:
        completedSimulations > 0
          ? round2(totalAiCostUsd / completedSimulations)
          : null,
      avgPlayTimeMinutes: playTimeOverall.avgMinutes,
      playTimeSessions: playTimeOverall.sessions,
    };
  }
}
