import { Injectable } from '@nestjs/common';

import {
  FixSessionEngineCostQueryDto,
  FixSessionEngineCostResponseDto,
} from '../dto/fix-session-engine-cost-analytics.dto';
import { FixSessionEngineCostAnalyticsRepository } from '../repository/fix-session-engine-cost-analytics.repository';
import {
  describeWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/**
 * This chart has no bucketed trend of its own — one bar per engine for the
 * whole window is the whole point — but `resolveAnalyticsWindow` still wants
 * a bucket to resolve `range=all`'s default grain against. `week` is
 * arbitrary and unused beyond that.
 */
const defaultBucketFor = () => 'week' as const;

/**
 * "Same job, cheaper model, here's the delta" — the direct Claude-vs-Gemini
 * comparison a per-model spend total can't give: Bug Hunter has run the two
 * engines a very different number of times, so whichever ran less often
 * would always show the smaller TOTAL regardless of which is actually
 * cheaper per fix. Average cost per COMPLETED fix session is the fair
 * number — see `FixSessionEngineCostAnalyticsRepository`'s own doc for why it
 * reads `bug_hunt_runs` directly rather than `llm_usage`.
 */
@Injectable()
export class FixSessionEngineCostAnalyticsService {
  constructor(private readonly repo: FixSessionEngineCostAnalyticsRepository) {}

  async getFixSessionEngineCost(
    query: FixSessionEngineCostQueryDto,
  ): Promise<FixSessionEngineCostResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });

    const rows = await this.repo.getAvgCostByEngine(
      window.start,
      window.endExclusive,
    );

    return {
      byEngine: rows.map((r) => ({
        engine: r.engine,
        avgCostUsd: Math.round(r.avgCostUsd * 10_000) / 10_000,
        sessionCount: r.sessionCount,
      })),
      window: describeWindow(window),
      computedAt: new Date().toISOString(),
    };
  }
}
