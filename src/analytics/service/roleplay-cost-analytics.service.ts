import { Injectable } from '@nestjs/common';

import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  CostBreakdownDto,
  RoleplayCostPointDto,
  RoleplayCostQueryDto,
  RoleplayCostResponseDto,
} from '../dto/roleplay-cost-analytics.dto';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { HighlightsAnalyticsRepository } from '../repository/highlights-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  COST_AREA_LABELS,
  COST_AREAS,
  COST_PER_MINUTES,
  RoleplayCostAnalyticsRepository,
  TASK_AREA,
} from '../repository/roleplay-cost-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const ESTIMATE_NOTE =
  'Estimated from token, audio and character counts at read time using a ' +
  'hand-maintained price list. Ignores prompt-cache discounts and negotiated ' +
  'rates; not a billed amount.';

/**
 * Bucket granularity per range.
 *
 * Coarser than the growth charts on purpose: the numerator is spend and the
 * denominator is practice minutes, and on a daily axis a single long session
 * whose evaluation landed after midnight moves the ratio visibly. A week is the
 * shortest grain where the two sides reliably describe the same activity.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '30d' || range === '90d' ? 'week' : 'month';

/** Zeroed breakdown — one place, so a new area cannot be forgotten in two. */
const emptyBreakdown = (): CostBreakdownDto => ({
  roleplay: 0,
  feedback: 0,
  quiz: 0,
  llm: 0,
  stt: 0,
  tts: 0,
});

interface BucketAccumulator {
  attributableCostUsd: number;
  excludedCostUsd: number;
  unpricedCalls: number;
  breakdown: CostBreakdownDto;
}

/**
 * What ten minutes of roleplay costs us in AI, over time.
 *
 * The unit-economics question leadership actually asks, which the existing "cost
 * per completed simulation" chart cannot answer: a simulation is not a fixed
 * amount of product, so cost-per-simulation moves when session length moves and a
 * reader cannot tell efficiency from behaviour. Per-minute normalises that away.
 *
 * Five rules live here, each because it is a place a reader would otherwise be
 * misled:
 *
 *  - **Only learner-caused spend is in the numerator.** `TASK_AREA` decides;
 *    everything else is reported as `excludedCostUsd` rather than dropped or
 *    shared out. Sharing out authoring and judge costs would make the unit cost
 *    of practice rise in a week when nobody practised.
 *  - **Pricing happens in TypeScript, never in SQL,** so the rate table stays a
 *    reviewable constant and a re-price restates history on the next request.
 *  - **Unpriced calls are counted and surfaced.** They contribute $0, so the
 *    total is an understatement by an unknown amount; a cost chart that hides
 *    this reads as complete when it is not.
 *  - **The ratio is null over zero minutes.** A quiet bucket has no unit cost.
 *    Costs themselves gap-fill to real zeros, because no calls really is no spend.
 *  - **The denominator is the SAME practice-minutes measurement the rest of the
 *    tab uses** — read through `HighlightsAnalyticsRepository` rather than
 *    re-queried here, so this chart and the practice-minutes chart cannot come to
 *    disagree about what a minute of practice is.
 */
@Injectable()
export class RoleplayCostAnalyticsService {
  constructor(
    private readonly repo: RoleplayCostAnalyticsRepository,
    private readonly highlightsRepo: HighlightsAnalyticsRepository,
  ) {}

  async getRoleplayCost(
    query: RoleplayCostQueryDto,
  ): Promise<RoleplayCostResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const { start, endExclusive, bucket } = window;

    const [usageRows, practiceRows] = await Promise.all([
      this.repo.getUsageByBucketAndTask(start, endExclusive, bucket),
      // Deliberately unscoped by tenant, matching the numerator: pairing a
      // tenant's minutes with platform-wide spend would produce a unit cost
      // inflated by every other org's practice.
      this.highlightsRepo.getPracticeMinutesByBucket(
        start,
        endExclusive,
        bucket,
      ),
    ]);

    const byBucket = this.accumulate(usageRows);
    const minutesByBucket = new Map(
      practiceRows.map((r) => [r.bucket, r.minutes]),
    );

    const points: RoleplayCostPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((bucketKey) => {
      const acc = byBucket.get(bucketKey);
      const practiceMinutes = round2(minutesByBucket.get(bucketKey) ?? 0);
      const attributableCostUsd = round4(acc?.attributableCostUsd ?? 0);
      return {
        bucket: bucketKey,
        practiceMinutes,
        attributableCostUsd,
        costPer10MinUsd:
          practiceMinutes > 0
            ? round6((attributableCostUsd / practiceMinutes) * COST_PER_MINUTES)
            : null,
        breakdown: roundBreakdown(acc?.breakdown ?? emptyBreakdown()),
        excludedCostUsd: round4(acc?.excludedCostUsd ?? 0),
        unpricedCalls: acc?.unpricedCalls ?? 0,
      };
    });

    // Whole-window figures from the RAW rows, not re-aggregated from the axis:
    // an overall ratio must be total-cost over total-minutes, and averaging the
    // per-bucket ratios would weight a quiet week like a busy one.
    const totals = [...byBucket.values()].reduce(
      (sum, acc) => ({
        attributable: sum.attributable + acc.attributableCostUsd,
        excluded: sum.excluded + acc.excludedCostUsd,
        unpriced: sum.unpriced + acc.unpricedCalls,
      }),
      { attributable: 0, excluded: 0, unpriced: 0 },
    );
    const totalPracticeMinutes = practiceRows.reduce(
      (sum, r) => sum + r.minutes,
      0,
    );

    return {
      range: window.custom ? '30d' : ((query.range ?? 'all') as AnalyticsRange),
      bucket,
      window: describeWindow(window),
      perMinutes: COST_PER_MINUTES,
      areas: [...COST_AREAS],
      areaLabels: { ...COST_AREA_LABELS },
      points,
      overallCostPer10MinUsd:
        totalPracticeMinutes > 0
          ? round6(
              (totals.attributable / totalPracticeMinutes) * COST_PER_MINUTES,
            )
          : null,
      totalAttributableCostUsd: round4(totals.attributable),
      totalExcludedCostUsd: round4(totals.excluded),
      totalPracticeMinutes: round2(totalPracticeMinutes),
      totalUnpricedCalls: totals.unpriced,
      estimateNote: ESTIMATE_NOTE,
      scoping: {
        tenantId: null,
        // `llm_usage` is largely tenantless by design, so a tenant-filtered cost
        // is a fraction of real spend presented as the whole. The whole panel
        // stays platform-wide and says so.
        unscopedSections: ['points', 'overallCostPer10MinUsd'],
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Price every usage group and fold it into its bucket, splitting attributable
   * spend by area and by service.
   *
   * A row's area comes from `TASK_AREA`; a task that is not in the map is
   * platform spend and lands in `excludedCostUsd`. Unpriced calls are counted
   * only on the attributable side — an unpriced judge call understates a figure
   * this chart does not report.
   */
  private accumulate(
    usageRows: Awaited<
      ReturnType<RoleplayCostAnalyticsRepository['getUsageByBucketAndTask']>
    >,
  ): Map<string, BucketAccumulator> {
    const byBucket = new Map<string, BucketAccumulator>();

    for (const row of usageRows) {
      const service = (row.service as AiServiceName) || 'llm';
      const { costUsd, priced } = computeServiceCostUsd(
        service,
        row.provider,
        row.model,
        {
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          audioMs: row.audioMs,
          characters: row.characters,
        },
      );

      const acc =
        byBucket.get(row.bucket) ??
        ({
          attributableCostUsd: 0,
          excludedCostUsd: 0,
          unpricedCalls: 0,
          breakdown: emptyBreakdown(),
        } satisfies BucketAccumulator);

      const area = TASK_AREA[row.task as LlmTask];
      if (area === undefined) {
        acc.excludedCostUsd += costUsd;
      } else {
        acc.attributableCostUsd += costUsd;
        acc.breakdown[area] += costUsd;
        if (service === 'stt') acc.breakdown.stt += costUsd;
        else if (service === 'tts') acc.breakdown.tts += costUsd;
        else acc.breakdown.llm += costUsd;
        if (!priced) acc.unpricedCalls += row.calls;
      }

      byBucket.set(row.bucket, acc);
    }

    return byBucket;
  }
}

/**
 * Four decimals on a spend TOTAL.
 *
 * Not two: a month of practice can cost well under a cent, and rounding to cents
 * would flatten a real difference between models to $0.00 on every row.
 */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Six decimals on the RATIO, which is a much smaller number than the total it
 * comes from.
 *
 * Four was not enough and this was caught against real data: $0.096 of spend
 * over 20,300 practice minutes is $0.000047 per ten minutes, which rounds to
 * exactly `0` at four decimals — so the headline unit cost read "$0" while real
 * money was being spent. A cost metric that reports zero cost is worse than no
 * metric, because it is confidently wrong.
 */
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

const roundBreakdown = (b: CostBreakdownDto): CostBreakdownDto => ({
  roleplay: round4(b.roleplay),
  feedback: round4(b.feedback),
  quiz: round4(b.quiz),
  llm: round4(b.llm),
  stt: round4(b.stt),
  tts: round4(b.tts),
});
