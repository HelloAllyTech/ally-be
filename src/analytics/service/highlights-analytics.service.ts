import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  AnalyticsHighlightsQueryDto,
  AnalyticsHighlightsResponseDto,
  CostPerSimPointDto,
  HighlightsSummaryDto,
  PracticeMinutesPointDto,
} from '../dto/highlights-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  AiUsageBucketRow,
  HighlightsAnalyticsRepository,
} from '../repository/highlights-analytics.repository';
import {
  AnalyticsWindow,
  generateBucketLabels,
  isoDate,
  previousWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
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

/** Bucket granularity this endpoint defaults to per range. */
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
   * Leadership "Highlights" aggregates: org adoption, practice minutes,
   * roleplay quality, learner CSAT, track funnel and AI cost per completed
   * simulation. Count/sum series are gap-filled to a contiguous bucket axis;
   * average series (quality, CSAT) are left sparse — an average has no
   * meaningful zero, and plotting one would fabricate a measurement.
   *
   * With `compare=prev` the same summary aggregates are also computed over the
   * equal-length preceding window, so each KPI can state its change against a
   * named basis rather than standing alone as a bare number.
   */
  async getHighlights(
    query: AnalyticsHighlightsQueryDto,
  ): Promise<AnalyticsHighlightsResponseDto> {
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '30d',
      defaultBucketFor,
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
      qualityTrend,
      qualityOverall,
      csatTrend,
      csatOverall,
      funnelCounts,
      quizCounts,
      simsByBucket,
      usageRows,
    ] = await Promise.all([
      this.repo.getActiveOrgCount(window.start, window.endExclusive),
      this.repo.getTopOrgsByCompletedSims(window.start, window.endExclusive),
      this.repo.getPracticeMinutesByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getQualityTrendByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getQualityOverall(window.start, window.endExclusive, tenantId),
      this.repo.getCsatTrendByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getCsatOverall(window.start, window.endExclusive, tenantId),
      this.repo.getTrackFunnelCounts(
        window.start,
        window.endExclusive,
        tenantId,
      ),
      this.repo.getQuizPassCounts(window.start, window.endExclusive, tenantId),
      this.repo.getCompletedSimulationsByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getAiUsageByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
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
      window: {
        from: isoDate(window.start),
        // `to` is reported inclusive, which is how a reader reads a date range.
        to: isoDate(new Date(window.endExclusive.getTime() - 86_400_000)),
        label: window.label,
        days: window.days,
        bucket: window.bucket,
        computedAt: new Date().toISOString(),
      },
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
      qualityTrend,
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
   */
  private async buildComparison(
    query: AnalyticsHighlightsQueryDto,
    window: AnalyticsWindow,
    tenantId?: string,
  ): Promise<{
    previous: HighlightsSummaryDto | null;
    previousLabel: string | null;
  }> {
    if (query.compare !== 'prev')
      return { previous: null, previousLabel: null };

    const prev = previousWindow(window);
    const [
      activeOrgs,
      practiceRows,
      qualityOverall,
      csatOverall,
      funnelCounts,
      quizCounts,
      simsByBucket,
      usageRows,
    ] = await Promise.all([
      this.repo.getActiveOrgCount(prev.start, prev.endExclusive),
      this.repo.getPracticeMinutesByBucket(
        prev.start,
        prev.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getQualityOverall(prev.start, prev.endExclusive, tenantId),
      this.repo.getCsatOverall(prev.start, prev.endExclusive, tenantId),
      this.repo.getTrackFunnelCounts(prev.start, prev.endExclusive, tenantId),
      this.repo.getQuizPassCounts(prev.start, prev.endExclusive, tenantId),
      this.repo.getCompletedSimulationsByBucket(
        prev.start,
        prev.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repo.getAiUsageByBucket(
        prev.start,
        prev.endExclusive,
        window.bucket,
      ),
    ]);

    return {
      previous: this.buildSummary({
        activeOrgs,
        simsByBucket,
        practiceRows,
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
    qualityOverall,
    csatOverall,
    funnelCounts,
    quizCounts,
    costByBucket,
  }: {
    activeOrgs: number;
    simsByBucket: { count: number }[];
    practiceRows: { minutes: number }[];
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
    };
  }
}
