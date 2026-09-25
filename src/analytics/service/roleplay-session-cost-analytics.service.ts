import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AiServiceName,
  computeServiceCostUsd,
} from '../constants/llm-pricing.constants';
import {
  DEBRIEF_COVERAGE_TASK,
  LIVE_SESSION_COVERAGE_TASKS,
  SESSION_COST_COMPONENT_BY_TASK,
  SESSION_COST_COMPONENT_DESCRIPTIONS,
  SESSION_COST_COMPONENT_LABELS,
  SESSION_COST_COMPONENTS,
  SessionCostComponent,
} from '../constants/session-cost.constants';
import {
  RoleplaySessionCostDetailDto,
  RoleplaySessionCostPointDto,
  RoleplaySessionCostQueryDto,
  RoleplaySessionCostResponseDto,
  RoleplaySessionCostTotalsDto,
  SessionCostComponentsDto,
  SessionCostLineDto,
} from '../dto/roleplay-session-cost-analytics.dto';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  CoverageRow,
  RoleplaySessionCostAnalyticsRepository,
  SingleSessionUsageRow,
} from '../repository/roleplay-session-cost-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const ESTIMATE_NOTE =
  'Estimated from token, audio and character counts at read time using a ' +
  'hand-maintained price list. Ignores prompt-cache discounts and negotiated ' +
  'rates; not a billed amount.';

const COVERAGE_NOTE =
  'Periods marked partial began before every delivery call was logged against ' +
  'its session — fillers, event detectors, clip audio and the debrief were not ' +
  'recorded — so their cost is understated and cannot be recovered.';

/** A 30/90-day window reads best by week; anything longer by month. */
const defaultBucketFor = (range: string): AnalyticsBucket =>
  range === '30d' || range === '90d' ? 'week' : 'month';

type ComponentCosts = Record<SessionCostComponent, number>;

const zeroComponents = (): ComponentCosts =>
  Object.fromEntries(
    SESSION_COST_COMPONENTS.map((c) => [c, 0]),
  ) as ComponentCosts;

interface Accumulator {
  costUsd: number;
  byComponent: ComponentCosts;
  excludedCostUsd: number;
  unpricedCalls: number;
}

const emptyAccumulator = (): Accumulator => ({
  costUsd: 0,
  byComponent: zeroComponents(),
  excludedCostUsd: 0,
  unpricedCalls: 0,
});

/**
 * What it costs in AI to deliver a roleplay session, per minute of practice.
 *
 * The session is the unit: every model call tagged to it — LLM, speech-to-text,
 * text-to-speech, embeddings — from the opener to the debrief chat, classified
 * by `SESSION_COST_COMPONENT_BY_TASK`. The per-minute figure is total cost over
 * total minutes for the sessions started in the period. See
 * `session-cost.constants.ts` for what counts and why.
 *
 * Rules that exist because a reader would otherwise be misled:
 *  - **Analysis spend is reported beside the cost, never in it.** Actor
 *    evaluation and judges tagged to a session land in `excludedCostUsd`.
 *  - **Pricing happens here, never in SQL,** so a re-price restates history.
 *  - **Unpriced delivery calls are counted.** They contribute $0.
 *  - **Ratios are null over zero minutes;** costs gap-fill to real zeros.
 *  - **Periods before full logging say so** (`partial`), because the missing
 *    calls cannot be backfilled and the step on ship day is not a price rise.
 */
@Injectable()
export class RoleplaySessionCostAnalyticsService {
  constructor(private readonly repo: RoleplaySessionCostAnalyticsRepository) {}

  async getRoleplaySessionCost(
    query: RoleplaySessionCostQueryDto,
  ): Promise<RoleplaySessionCostResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const { start, endExclusive, bucket } = window;

    const [sessionRows, usageRows, coverage] = await Promise.all([
      this.repo.getSessionsByBucket(start, endExclusive, bucket),
      this.repo.getUsageByBucket(start, endExclusive, bucket),
      this.repo.getCoverage(LIVE_SESSION_COVERAGE_TASKS, DEBRIEF_COVERAGE_TASK),
    ]);

    const byBucket = new Map<string, Accumulator>();
    const overallAcc = emptyAccumulator();
    for (const row of usageRows) {
      const acc = byBucket.get(row.bucket) ?? emptyAccumulator();
      const priced = priceRow(row);
      addTo(acc, priced);
      addTo(overallAcc, priced);
      byBucket.set(row.bucket, acc);
    }
    const sessionsByBucket = new Map(sessionRows.map((r) => [r.bucket, r]));

    const fullCoverageFrom = resolveFullCoverage(coverage);

    const points: RoleplaySessionCostPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((bucketKey) => {
      const s = sessionsByBucket.get(bucketKey);
      return {
        bucket: bucketKey,
        partial:
          !fullCoverageFrom ||
          new Date(`${bucketKey}T00:00:00.000Z`) < fullCoverageFrom,
        ...toTotals(
          s?.sessions ?? 0,
          s?.minutes ?? 0,
          byBucket.get(bucketKey) ?? emptyAccumulator(),
        ),
      };
    });

    const totalSessions = sessionRows.reduce((n, r) => n + r.sessions, 0);
    const totalMinutes = sessionRows.reduce((n, r) => n + r.minutes, 0);

    return {
      bucket,
      window: describeWindow(window),
      components: SESSION_COST_COMPONENTS.map((key) => ({
        key,
        label: SESSION_COST_COMPONENT_LABELS[key],
        description: SESSION_COST_COMPONENT_DESCRIPTIONS[key],
      })),
      points,
      overall: toTotals(totalSessions, totalMinutes, overallAcc),
      fullCoverageFrom: fullCoverageFrom?.toISOString() ?? null,
      coverageNote: COVERAGE_NOTE,
      estimateNote: ESTIMATE_NOTE,
      scoping: {
        tenantId: null,
        // Session cost is a platform unit-economics figure; test orgs are
        // excluded by the session's tenant, and nothing here narrows further.
        unscopedSections: ['points', 'overall'],
      },
      computedAt: new Date().toISOString(),
    };
  }

  /** One session's delivery cost, itemised by task and model. */
  async getSessionCost(
    sessionId: string,
  ): Promise<RoleplaySessionCostDetailDto> {
    const [session, usageRows, coverage] = await Promise.all([
      this.repo.getSession(sessionId),
      this.repo.getSessionUsage(sessionId),
      this.repo.getCoverage(LIVE_SESSION_COVERAGE_TASKS, DEBRIEF_COVERAGE_TASK),
    ]);
    if (!session) {
      throw new NotFoundException(`Scenario session ${sessionId} not found`);
    }

    const acc = emptyAccumulator();
    const lines: SessionCostLineDto[] = usageRows.map((row) => {
      const priced = priceRow(row);
      addTo(acc, priced);
      return {
        ...row,
        component: priced.component,
        costUsd: round6(priced.costUsd),
        priced: priced.priced,
      };
    });
    const fullCoverageFrom = resolveFullCoverage(coverage);

    return {
      sessionId: session.id,
      startedAt: session.createdAt.toISOString(),
      status: session.status,
      eventStatus: session.eventStatus,
      fullyLogged: !!fullCoverageFrom && session.createdAt >= fullCoverageFrom,
      ...toTotals(1, session.minutes, acc),
      lines: lines.sort((a, b) => b.costUsd - a.costUsd),
      estimateNote: ESTIMATE_NOTE,
    };
  }
}

interface PricedRow {
  costUsd: number;
  priced: boolean;
  calls: number;
  /** Null = analysis spend, excluded from delivery cost. */
  component: SessionCostComponent | null;
}

function priceRow(row: SingleSessionUsageRow): PricedRow {
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
  return {
    costUsd,
    priced,
    calls: row.calls,
    component: SESSION_COST_COMPONENT_BY_TASK[row.task as LlmTask] ?? null,
  };
}

function addTo(acc: Accumulator, row: PricedRow): void {
  if (row.component === null) {
    acc.excludedCostUsd += row.costUsd;
    return;
  }
  acc.costUsd += row.costUsd;
  acc.byComponent[row.component] += row.costUsd;
  if (!row.priced) acc.unpricedCalls += row.calls;
}

/**
 * The later of the two halves — see `LIVE_SESSION_COVERAGE_TASKS`. Either half
 * missing means full coverage has not been reached.
 */
function resolveFullCoverage(coverage: CoverageRow): Date | null {
  if (!coverage.liveFrom || !coverage.debriefFrom) return null;
  return coverage.liveFrom > coverage.debriefFrom
    ? coverage.liveFrom
    : coverage.debriefFrom;
}

function toTotals(
  sessions: number,
  minutes: number,
  acc: Accumulator,
): RoleplaySessionCostTotalsDto {
  const perMinute = (usd: number) =>
    minutes > 0 ? round6(usd / minutes) : null;
  const costByComponent = {} as SessionCostComponentsDto;
  const perMinuteByComponent = {} as SessionCostComponentsDto;
  for (const c of SESSION_COST_COMPONENTS) {
    costByComponent[c] = round6(acc.byComponent[c]);
    perMinuteByComponent[c] = perMinute(acc.byComponent[c]);
  }
  return {
    sessions,
    minutes: round2(minutes),
    costUsd: round6(acc.costUsd),
    costPerMinuteUsd: perMinute(acc.costUsd),
    costPerSessionUsd: sessions > 0 ? round6(acc.costUsd / sessions) : null,
    costByComponent,
    perMinuteByComponent,
    excludedCostUsd: round6(acc.excludedCostUsd),
    unpricedCalls: acc.unpricedCalls,
  };
}

/**
 * Six decimals throughout. A minute of roleplay costs fractions of a cent, and
 * a single component of it hundredths of that: at four decimals whole
 * components round to exactly 0 and the stack stops adding up.
 */
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
