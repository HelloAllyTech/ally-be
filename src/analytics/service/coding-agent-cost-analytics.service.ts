import { Injectable } from '@nestjs/common';

import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  CodingAgentCostQueryDto,
  CodingAgentCostResponseDto,
  CodingAgentModelBreakdownDto,
} from '../dto/coding-agent-cost-analytics.dto';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  CODING_AGENT_LABELS,
  CODING_AGENTS,
  CodingAgent,
  CodingAgentCostAnalyticsRepository,
  CodingAgentUsageRow,
  TASK_AGENT,
} from '../repository/coding-agent-cost-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const ESTIMATE_NOTE =
  'Estimated from token, audio and character counts at read time using a ' +
  'hand-maintained price list. Ignores prompt-cache discounts and negotiated ' +
  'rates; not a billed amount.';

/** Coarser than the growth charts, same reasoning as the roleplay-cost sibling. */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '30d' || range === '90d' ? 'week' : 'month';

const emptyAmount = (): Record<CodingAgent, number> => ({
  'bug-hunter': 0,
  builder: 0,
});

interface BucketAccumulator {
  costUsd: Record<CodingAgent, number>;
  calls: Record<CodingAgent, number>;
}

/** Keyed by `${agent}::${model}`, so one pass can fold every row into it. */
interface ModelAccumulator {
  agent: CodingAgent;
  model: string;
  costUsd: number;
  calls: number;
  priced: boolean;
}

/**
 * What Bug Hunter and Builder cost, over time and by model.
 *
 * Exists because the platform-wide "AI cost" tab has no filter for isolating
 * one feature's spend, and no time axis at all (one snapshot for the whole
 * window) — see `TokenConsumption.tsx`/`getTokenConsumption`. This is the
 * dedicated view for the two autonomous coding agents specifically, same
 * `{trend + breakdown}` shape `RoleplayCostAnalyticsService` already
 * established for a different cost question.
 *
 * `service` is NOT the discriminator — every call from both features omits
 * it and lands as `service: 'llm'`. `task` is: see `TASK_AGENT`.
 */
@Injectable()
export class CodingAgentCostAnalyticsService {
  constructor(private readonly repo: CodingAgentCostAnalyticsRepository) {}

  async getCodingAgentCost(
    query: CodingAgentCostQueryDto,
  ): Promise<CodingAgentCostResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const { start, endExclusive, bucket } = window;

    const usageRows = await this.repo.getUsageByBucketAndTask(
      start,
      endExclusive,
      bucket,
    );

    const { byBucket, byModel, totalCostUsd, unpricedCalls } =
      this.accumulate(usageRows);

    const points = generateBucketLabels(start, endExclusive, bucket).map(
      (bucketKey) => {
        const acc = byBucket.get(bucketKey);
        return {
          bucket: bucketKey,
          costUsd: roundAmount(acc?.costUsd ?? emptyAmount()),
          calls: acc?.calls ?? emptyAmount(),
        };
      },
    );

    const modelBreakdown: CodingAgentModelBreakdownDto[] = [...byModel.values()]
      .map((m) => ({
        agent: m.agent,
        model: m.model,
        costUsd: round4(m.costUsd),
        calls: m.calls,
        priced: m.priced,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      range: window.custom ? '30d' : ((query.range ?? 'all') as AnalyticsRange),
      bucket,
      window: describeWindow(window),
      agentLabels: { ...CODING_AGENT_LABELS },
      points,
      modelBreakdown,
      totalCostUsd: roundAmount(totalCostUsd),
      unpricedCalls,
      estimateNote: ESTIMATE_NOTE,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Price every usage row once, folding it into both the per-bucket trend and
   * the whole-window per-model breakdown in the same pass — one query serves
   * both chart sections.
   */
  private accumulate(usageRows: CodingAgentUsageRow[]): {
    byBucket: Map<string, BucketAccumulator>;
    byModel: Map<string, ModelAccumulator>;
    totalCostUsd: Record<CodingAgent, number>;
    unpricedCalls: number;
  } {
    const byBucket = new Map<string, BucketAccumulator>();
    const byModel = new Map<string, ModelAccumulator>();
    const totalCostUsd = emptyAmount();
    let unpricedCalls = 0;

    for (const row of usageRows) {
      const agent = TASK_AGENT[row.task as LlmTask];
      // Unreachable given the repository's own task filter, but a row this
      // service does not recognise must not silently join either agent's total.
      if (!agent) continue;

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

      const bucketAcc =
        byBucket.get(row.bucket) ??
        ({
          costUsd: emptyAmount(),
          calls: emptyAmount(),
        } satisfies BucketAccumulator);
      bucketAcc.costUsd[agent] += costUsd;
      bucketAcc.calls[agent] += row.calls;
      byBucket.set(row.bucket, bucketAcc);

      totalCostUsd[agent] += costUsd;
      if (!priced) unpricedCalls += row.calls;

      const modelKey = `${agent}::${row.model}`;
      const modelAcc =
        byModel.get(modelKey) ??
        ({
          agent,
          model: row.model,
          costUsd: 0,
          calls: 0,
          priced: true,
        } satisfies ModelAccumulator);
      modelAcc.costUsd += costUsd;
      modelAcc.calls += row.calls;
      if (!priced) modelAcc.priced = false;
      byModel.set(modelKey, modelAcc);
    }

    return { byBucket, byModel, totalCostUsd, unpricedCalls };
  }
}

/** Four decimals on a spend total — see the roleplay-cost sibling for why not two. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const roundAmount = (
  amount: Record<CodingAgent, number>,
): Record<CodingAgent, number> =>
  Object.fromEntries(
    CODING_AGENTS.map((agent) => [agent, round4(amount[agent])]),
  ) as Record<CodingAgent, number>;
