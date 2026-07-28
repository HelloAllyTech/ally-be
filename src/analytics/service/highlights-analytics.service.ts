import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  AnalyticsBucketParam,
  AnalyticsRange,
} from '../dto/platform-analytics.dto';
import {
  AnalyticsHighlightsResponseDto,
  CostPerSimPointDto,
  PracticeMinutesPointDto,
} from '../dto/highlights-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { HighlightsAnalyticsRepository } from '../repository/highlights-analytics.repository';
import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';

const MS_PER_DAY = 86_400_000;

/**
 * All bucketing/axis math is done in UTC. `date_trunc` on the tz-naive
 * `timestamp` columns is pure calendar math, so the repository's `yyyy-mm-dd`
 * keys line up with this UTC-generated axis regardless of the Node timezone.
 * (Private copies per service file, matching the sibling analytics services.)
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

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

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
   * meaningful zero.
   */
  async getHighlights(
    range: AnalyticsRange,
    bucketParam?: AnalyticsBucketParam,
  ): Promise<AnalyticsHighlightsResponseDto> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    // Exclusive upper bound = start of tomorrow, so all of today is included.
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
      `Building highlights range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [
      activeOrgs,
      topOrgs,
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
      this.repo.getActiveOrgCount(windowStart, endExclusive),
      this.repo.getTopOrgsByCompletedSims(windowStart, endExclusive),
      this.repo.getPracticeMinutesByBucket(windowStart, endExclusive, bucket),
      this.repo.getQualityTrendByBucket(windowStart, endExclusive, bucket),
      this.repo.getQualityOverall(windowStart, endExclusive),
      this.repo.getCsatTrendByBucket(windowStart, endExclusive, bucket),
      this.repo.getCsatOverall(windowStart, endExclusive),
      this.repo.getTrackFunnelCounts(windowStart, endExclusive),
      this.repo.getQuizPassCounts(windowStart, endExclusive),
      this.repo.getCompletedSimulationsByBucket(
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getAiUsageByBucket(windowStart, endExclusive, bucket),
    ]);

    const labels = this.generateBucketLabels(windowStart, endExclusive, bucket);

    // Practice minutes: gap-fill zeros onto the contiguous axis.
    const practiceByBucket = new Map(practiceRows.map((r) => [r.bucket, r]));
    const practiceMinutes: PracticeMinutesPointDto[] = labels.map((b) => ({
      bucket: b,
      minutes: round1(practiceByBucket.get(b)?.minutes ?? 0),
      activeLearners: practiceByBucket.get(b)?.activeLearners ?? 0,
    }));

    // Cost merge (JS — pricing lives in llm-pricing.constants, never in SQL):
    // accumulate estimated USD per bucket, then divide by that bucket's
    // completed sims over the gap-filled axis.
    const costByBucket = new Map<
      string,
      { costUsd: number; unpricedCalls: number }
    >();
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

    const completedSimulations = simsByBucket.reduce((a, r) => a + r.count, 0);
    const totalAiCostUsd = round2(
      Array.from(costByBucket.values()).reduce((a, c) => a + c.costUsd, 0),
    );
    const totalPracticeMinutes = Math.round(
      practiceRows.reduce((a, r) => a + r.minutes, 0),
    );

    return {
      range,
      bucket,
      summary: {
        activeOrgs,
        completedSimulations,
        practiceMinutes: totalPracticeMinutes,
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
        costPerCompletedSimUsd:
          completedSimulations > 0
            ? round2(totalAiCostUsd / completedSimulations)
            : null,
      },
      topOrgs,
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
   * Generate a contiguous list of bucket start labels (yyyy-mm-dd) spanning the
   * window, so charts get a gap-free axis even for buckets with zero rows.
   * Unlike the PlatformAnalyticsService copy this handles `day` too — the 30d
   * range defaults to day buckets here.
   */
  private generateBucketLabels(
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): string[] {
    const lastDay = addDays(endExclusive, -1);
    const labels: string[] = [];

    if (bucket === 'day') {
      for (let cur = windowStart; cur < endExclusive; cur = addDays(cur, 1)) {
        labels.push(isoDate(cur));
      }
    } else if (bucket === 'month') {
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
}
