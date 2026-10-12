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
    find: jest.Mock;
  };
  let runRepository: {
    weeklyRunStats: jest.Mock;
    getDataFloor: jest.Mock;
    find: jest.Mock;
  };
  let eventRepository: {
    weeklyEscalationCounts: jest.Mock;
    weeklyFallbackCounts: jest.Mock;
    find: jest.Mock;
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
      /** Rows the goal block reads: findings in the window, then the merged findings looked up by id. */
      goalFindings?: unknown[];
      goalMergedFindings?: unknown[];
      goalSweeps?: unknown[];
      goalMergeEvents?: unknown[];
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
      find: jest
        .fn()
        .mockResolvedValueOnce(over.goalFindings ?? [])
        .mockResolvedValueOnce(over.goalMergedFindings ?? []),
    };
    runRepository = {
      weeklyRunStats: jest.fn().mockResolvedValue(over.runRows ?? []),
      getDataFloor: jest.fn().mockResolvedValue(new Date('2025-01-01')),
      find: jest.fn().mockResolvedValue(over.goalSweeps ?? []),
    };
    eventRepository = {
      weeklyEscalationCounts: jest
        .fn()
        .mockResolvedValue(over.escalationRows ?? []),
      weeklyFallbackCounts: jest
        .fn()
        .mockResolvedValue(over.fallbackRows ?? []),
      find: jest.fn().mockResolvedValue(over.goalMergeEvents ?? []),
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

    expect(result.throughput.map((w) => w.week)).toEqual([WEEK_1, WEEK_2]);
    expect(result.precision.bySource).toEqual([]);
    expect(result.throughput).toHaveLength(2);
    expect(result.speed).toHaveLength(2);
    expect(result.cost).toHaveLength(2);
    expect(result.reliability).toHaveLength(2);
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

  describe('goal (OPP-0778)', () => {
    const at = (iso: string) => new Date(iso);
    it('counts first-finder share, escapes and time to fix per week and over the window, leaving finder errors out', async () => {
      await setup({
        goalFindings: [
          // week of 2026-01-05: two agent bugs, one human report that a sweep had passed
          {
            id: 'a1',
            repo: 'ally-web',
            source: 'code_review',
            status: 'merged',
            createdAt: at('2026-01-06T10:00:00Z'),
            metadata: {},
          },
          {
            id: 'a2',
            repo: 'ally-web',
            source: 'production_log',
            status: 'new',
            createdAt: at('2026-01-07T10:00:00Z'),
            metadata: {},
          },
          {
            id: 'h1',
            repo: 'ally-web',
            source: 'reported_bug',
            status: 'new',
            createdAt: at('2026-01-08T10:00:00Z'),
            metadata: { miss: { reason: 'no_sense' } },
          },
          // a declined duplicate report and a declined finder error: neither counts
          {
            id: 'h2',
            repo: 'ally-web',
            source: 'reported_bug',
            status: 'rejected',
            decisionReason: 'duplicate',
            createdAt: at('2026-01-08T11:00:00Z'),
            metadata: {},
          },
          {
            id: 'a3',
            repo: 'ally-web',
            source: 'code_review',
            status: 'dismissed',
            decisionReason: 'not_a_bug',
            createdAt: at('2026-01-08T12:00:00Z'),
            metadata: {},
          },
          // week of 2026-01-12: one human report on a repo never swept
          {
            id: 'h3',
            repo: 'ally-be',
            source: 'reported_bug',
            status: 'new',
            createdAt: at('2026-01-13T10:00:00Z'),
            metadata: {},
          },
        ],
        goalSweeps: [
          {
            id: 's1',
            repo: 'ally-web',
            finishedAt: at('2026-01-05T01:00:00Z'),
          },
        ],
        goalMergeEvents: [
          { id: 'e1', findingId: 'a1', createdAt: at('2026-01-07T10:00:00Z') },
        ],
        goalMergedFindings: [
          { id: 'a1', createdAt: at('2026-01-06T10:00:00Z') },
        ],
      });

      const result = await service.getPerformance({
        from: '2026-01-05',
        to: '2026-01-18',
      } as never);

      const w1 = result.goal.weekly.find((w) => w.week === '2026-01-05')!;
      expect(w1).toMatchObject({
        humanReports: 1,
        agentBugs: 2,
        firstFinderShare: 0.6667,
        escapes: 1,
        escapeRate: 1,
        timeToFixHoursMedian: 24,
      });
      const w2 = result.goal.weekly.find((w) => w.week === '2026-01-12')!;
      expect(w2).toMatchObject({
        humanReports: 1,
        agentBugs: 0,
        firstFinderShare: 0,
        escapes: 0,
        escapeRate: 0,
        timeToFixHoursMedian: null,
      });
      expect(result.goal.window).toMatchObject({
        humanReports: 2,
        agentBugs: 2,
        firstFinderShare: 0.5,
        escapes: 1,
        escapeRate: 0.5,
        timeToFixHoursMedian: 24,
        missReasons: { no_sense: 1, unclassified: 1 },
      });
    });
  });
});
