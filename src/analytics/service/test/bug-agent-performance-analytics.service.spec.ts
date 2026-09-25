import { Test, TestingModule } from '@nestjs/testing';

import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugHuntRunRepository } from 'src/bug-hunter/repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from 'src/bug-hunter/repository/bug-hunt-event.repository';

import { BugAgentPerformanceAnalyticsService } from '../bug-agent-performance-analytics.service';

// A clean two-Monday window: 2026-01-05 and 2026-01-12 are the only two
// weeks that can appear, so every test can assert on both by name without
// depending on "now".
const FROM = '2026-01-05';
const TO = '2026-01-18';
const WEEK_1 = '2026-01-05';
const WEEK_2 = '2026-01-12';

describe('BugAgentPerformanceAnalyticsService', () => {
  let service: BugAgentPerformanceAnalyticsService;
  let findingRepository: {
    weeklyOutcomeCounts: jest.Mock;
    weeklyRegressionCounts: jest.Mock;
    weeklyQueueToStartLatency: jest.Mock;
    weeklyStageLatencies: jest.Mock;
  };
  let runRepository: { weeklyRunStats: jest.Mock; getDataFloor: jest.Mock };
  let eventRepository: {
    weeklyEscalationCounts: jest.Mock;
    weeklyFallbackCounts: jest.Mock;
  };

  const setup = async (
    over: {
      outcomeRows?: unknown[];
      regressionRows?: unknown[];
      queueRows?: unknown[];
      stageLatencyRows?: unknown[];
      runRows?: unknown[];
      escalationRows?: unknown[];
      fallbackRows?: unknown[];
    } = {},
  ) => {
    findingRepository = {
      weeklyOutcomeCounts: jest.fn().mockResolvedValue(over.outcomeRows ?? []),
      weeklyRegressionCounts: jest
        .fn()
        .mockResolvedValue(over.regressionRows ?? []),
      weeklyQueueToStartLatency: jest
        .fn()
        .mockResolvedValue(over.queueRows ?? []),
      weeklyStageLatencies: jest
        .fn()
        .mockResolvedValue(over.stageLatencyRows ?? []),
    };
    runRepository = {
      weeklyRunStats: jest.fn().mockResolvedValue(over.runRows ?? []),
      getDataFloor: jest.fn().mockResolvedValue(new Date('2025-01-01')),
    };
    eventRepository = {
      weeklyEscalationCounts: jest
        .fn()
        .mockResolvedValue(over.escalationRows ?? []),
      weeklyFallbackCounts: jest
        .fn()
        .mockResolvedValue(over.fallbackRows ?? []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugAgentPerformanceAnalyticsService,
        { provide: BugFindingRepository, useValue: findingRepository },
        { provide: BugHuntRunRepository, useValue: runRepository },
        { provide: BugHuntEventRepository, useValue: eventRepository },
      ],
    }).compile();

    service = module.get(BugAgentPerformanceAnalyticsService);
  };

  const query = () => ({ from: FROM, to: TO });

  it('gap-fills every week in the window, even with no data at all', async () => {
    await setup();

    const result = await service.getPerformance(query());

    expect(result.precision.weekly.map((w) => w.week)).toEqual([
      WEEK_1,
      WEEK_2,
    ]);
    expect(result.precision.weekly[0]).toEqual({
      week: WEEK_1,
      accuracy: null,
      reversalRate: null,
      filed: 0,
      judged: 0,
    });
    expect(result.throughput).toHaveLength(2);
    expect(result.speed).toHaveLength(2);
    expect(result.cost).toHaveLength(2);
    expect(result.reliability).toHaveLength(2);
  });

  it("computes weekly accuracy from that week's outcome rows only", async () => {
    await setup({
      outcomeRows: [
        {
          week: new Date(WEEK_1),
          source: 'code_review',
          repo: 'ally-be',
          status: 'rejected',
          decisionReason: 'not_a_bug',
          count: 1,
          lowConfidence: 0,
          unscored: 0,
          reversed: 0,
        },
        {
          week: new Date(WEEK_1),
          source: 'test_failure',
          repo: 'ally-be',
          status: 'merged',
          decisionReason: null,
          count: 4,
          lowConfidence: 0,
          unscored: 0,
          reversed: 0,
        },
      ],
    });

    const result = await service.getPerformance(query());

    // judged = 1 declined-with-reason + 4 approved(merged) = 5; finderErrors = 1 (not_a_bug)
    expect(result.precision.weekly[0]).toMatchObject({
      week: WEEK_1,
      accuracy: 1 - 1 / 5,
      filed: 5,
      judged: 5,
    });
    // Week 2 saw nothing, so it must read as genuinely empty, not a repeat of week 1.
    expect(result.precision.weekly[1]).toMatchObject({
      week: WEEK_2,
      filed: 0,
      judged: 0,
      accuracy: null,
    });
  });

  it('aggregates bySource across the whole window, ignoring week boundaries', async () => {
    await setup({
      outcomeRows: [
        {
          week: new Date(WEEK_1),
          source: 'lint_error',
          repo: 'ally-be',
          status: 'merged',
          decisionReason: null,
          count: 2,
          lowConfidence: 0,
          unscored: 0,
          reversed: 0,
        },
        {
          week: new Date(WEEK_2),
          source: 'lint_error',
          repo: 'ally-be',
          status: 'merged',
          decisionReason: null,
          count: 3,
          lowConfidence: 0,
          unscored: 0,
          reversed: 0,
        },
      ],
    });

    const result = await service.getPerformance(query());

    expect(result.precision.bySource).toEqual([
      { source: 'lint_error', accuracy: 1, filed: 5, judged: 5 },
    ]);
  });

  it('computes escalation and fallback rates against fix-session runs that week, null when none ran', async () => {
    await setup({
      runRows: [
        {
          week: new Date(WEEK_1),
          trigger: 'fix_session',
          status: 'completed',
          runs: 4,
          costUsd: 10,
        },
      ],
      escalationRows: [{ week: new Date(WEEK_1), count: 1 }],
      fallbackRows: [{ week: new Date(WEEK_1), count: 2 }],
    });

    const result = await service.getPerformance(query());

    expect(result.throughput[0]).toMatchObject({
      week: WEEK_1,
      escalationRate: 0.25,
      fallbackRate: 0.5,
      fixSessionRuns: 4,
      escalations: 1,
      fallbacks: 2,
    });
    // No fix-session runs at all in week 2 — a rate over zero is unmeasured, not zero.
    expect(result.throughput[1]).toMatchObject({
      week: WEEK_2,
      escalationRate: null,
      fallbackRate: null,
    });
  });

  it('reports cost-per-merged-fix as null rather than a false zero when nothing merged', async () => {
    await setup({
      runRows: [
        {
          week: new Date(WEEK_1),
          trigger: 'fix_session',
          status: 'completed',
          runs: 1,
          costUsd: 5,
        },
      ],
    });

    const result = await service.getPerformance(query());

    expect(result.cost[0]).toMatchObject({
      week: WEEK_1,
      totalUsd: 5,
      costPerMergedFixUsd: null,
      merged: 0,
    });
  });

  it('computes run-completion-rate from completed vs failed runs that week', async () => {
    await setup({
      runRows: [
        {
          week: new Date(WEEK_1),
          trigger: 'scheduled',
          status: 'completed',
          runs: 8,
          costUsd: 0,
        },
        {
          week: new Date(WEEK_1),
          trigger: 'scheduled',
          status: 'failed',
          runs: 2,
          costUsd: 0,
        },
      ],
    });

    const result = await service.getPerformance(query());

    expect(result.reliability[0]).toMatchObject({
      week: WEEK_1,
      completionRate: 0.8,
      runs: 10,
      completed: 8,
      failed: 2,
    });
  });

  it('reads stage latencies and queue-to-start latency straight through per week', async () => {
    await setup({
      stageLatencyRows: [
        {
          week: new Date(WEEK_1),
          filedToDecided: { medianHours: 2, p90Hours: 5, sampled: 10 },
          filedToMerged: { medianHours: 20, p90Hours: 40, sampled: 6 },
          mergedToReleased: { medianHours: 1, p90Hours: 3, sampled: 6 },
        },
      ],
      queueRows: [{ week: new Date(WEEK_1), medianHours: 0.5, sampled: 8 }],
    });

    const result = await service.getPerformance(query());

    expect(result.speed[0]).toEqual({
      week: WEEK_1,
      filedToDecidedMedianHours: 2,
      filedToMergedMedianHours: 20,
      mergedToReleasedMedianHours: 1,
      queueToStartMedianHours: 0.5,
    });
    expect(result.speed[1]).toEqual({
      week: WEEK_2,
      filedToDecidedMedianHours: null,
      filedToMergedMedianHours: null,
      mergedToReleasedMedianHours: null,
      queueToStartMedianHours: null,
    });
  });

  it("queries the run repository's data floor only when range=all is resolved, not for an explicit from/to", async () => {
    await setup();

    await service.getPerformance(query());

    expect(runRepository.getDataFloor).not.toHaveBeenCalled();
  });
});
