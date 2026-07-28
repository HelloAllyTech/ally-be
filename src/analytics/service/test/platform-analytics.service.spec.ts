import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAnalyticsService } from '../platform-analytics.service';
import { DriftJudgeService } from '../drift-judge.service';
import { PlatformAnalyticsRepository } from '../../repository/platform-analytics.repository';
import { LlmUsageRepository } from '../../repository/llm-usage.repository';
import { DriftAnalyticsRepository } from '../../repository/drift-analytics.repository';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z. For range='30d' this yields:
 *   windowStart      = 2024-05-14 (today - 29d)
 *   endExclusive     = 2024-06-13 (start of tomorrow)
 *   weekly axis      = 2024-05-13, 05-20, 05-27, 06-03, 06-10  (Mondays)
 *   daily axis       = 2024-05-14 .. 2024-06-12 (30 days)
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const WEEKLY_AXIS = [
  '2024-05-13',
  '2024-05-20',
  '2024-05-27',
  '2024-06-03',
  '2024-06-10',
];

describe('PlatformAnalyticsService', () => {
  let service: PlatformAnalyticsService;
  let repo: jest.Mocked<PlatformAnalyticsRepository>;
  let llmUsageRepo: jest.Mocked<LlmUsageRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<PlatformAnalyticsRepository>> = {
      getNewUsersByBucket: jest.fn().mockResolvedValue([]),
      getUserCountBefore: jest.fn().mockResolvedValue(0),
      getTotalUsers: jest.fn().mockResolvedValue(0),
      getDailyActivityPairs: jest.fn().mockResolvedValue([]),
      getSimulationsCompletedByWeek: jest.fn().mockResolvedValue([]),
      getWeeklyActivePairsWithCreatedAt: jest.fn().mockResolvedValue([]),
      getUsersByRole: jest.fn().mockResolvedValue([]),
      getActiveUserCountSince: jest.fn().mockResolvedValue(0),
      getReturningActiveUserCountSince: jest.fn().mockResolvedValue(0),
      getCompletedSimsSince: jest.fn().mockResolvedValue(0),
      getVoiceLatencyByBucket: jest.fn().mockResolvedValue([]),
      getVoiceLatencyByLanguage: jest.fn().mockResolvedValue([]),
      getAgentJoinReliabilityByBucket: jest.fn().mockResolvedValue([]),
      getSuspectedFreezeByBucket: jest.fn().mockResolvedValue([]),
      getSessionOutcomeMix: jest
        .fn()
        .mockResolvedValue({ completed: 0, noConversation: 0, inProgress: 0 }),
    };

    // Drift aggregations live in DriftAnalyticsRepository and drift backfill is
    // delegated to DriftJudgeService; these tests cover the overview/latency
    // aggregations, so stubs are enough to satisfy the constructor.
    const mockDriftRepo: Partial<jest.Mocked<DriftAnalyticsRepository>> = {
      getDriftRateByLanguage: jest.fn().mockResolvedValue([]),
      getDriftRateByDimension: jest.fn().mockResolvedValue([]),
      getDriftAttributionMix: jest.fn().mockResolvedValue([]),
      getDriftFailureModeBreakdown: jest.fn().mockResolvedValue([]),
      getDriftSessionCountsBy: jest.fn().mockResolvedValue([]),
      getFirstDriftTurnHistogram: jest.fn().mockResolvedValue([]),
      getDriftTrend: jest.fn().mockResolvedValue([]),
    };

    const mockDriftJudge: Partial<jest.Mocked<DriftJudgeService>> = {
      startBackfill: jest.fn(),
      getJob: jest.fn(),
    };

    const mockLlmUsageRepo: Partial<jest.Mocked<LlmUsageRepository>> = {
      getTokenUsageByModelAndTask: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAnalyticsService,
        { provide: PlatformAnalyticsRepository, useValue: mockRepo },
        { provide: DriftAnalyticsRepository, useValue: mockDriftRepo },
        { provide: DriftJudgeService, useValue: mockDriftJudge },
        { provide: LlmUsageRepository, useValue: mockLlmUsageRepo },
      ],
    }).compile();

    service = module.get(PlatformAnalyticsService);
    repo = module.get(PlatformAnalyticsRepository);
    llmUsageRepo = module.get(LlmUsageRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('userGrowth', () => {
    it('zero-fills the weekly axis and accumulates from the baseline', async () => {
      repo.getUserCountBefore.mockResolvedValue(100);
      repo.getNewUsersByBucket.mockResolvedValue([
        { bucket: '2024-05-13', newUsers: 2 },
        { bucket: '2024-06-10', newUsers: 3 },
      ]);

      const { userGrowth } = await service.getOverview({ range: '30d' });

      expect(userGrowth.map((p) => p.date)).toEqual(WEEKLY_AXIS);
      expect(userGrowth).toEqual([
        { date: '2024-05-13', newUsers: 2, cumulativeUsers: 102 },
        { date: '2024-05-20', newUsers: 0, cumulativeUsers: 102 },
        { date: '2024-05-27', newUsers: 0, cumulativeUsers: 102 },
        { date: '2024-06-03', newUsers: 0, cumulativeUsers: 102 },
        { date: '2024-06-10', newUsers: 3, cumulativeUsers: 105 },
      ]);
    });
  });

  describe('activeUsers DAU/WAU/MAU', () => {
    it('rolls trailing 7-/30-day distinct counts per day', async () => {
      // user 1: active 05-20 and 06-12; user 2: active 06-10
      repo.getDailyActivityPairs.mockResolvedValue([
        { day: '2024-05-20', counselorId: 1 },
        { day: '2024-06-10', counselorId: 2 },
        { day: '2024-06-12', counselorId: 1 },
      ]);

      const { activeUsers } = await service.getOverview({ range: '30d' });

      expect(activeUsers).toHaveLength(30);
      expect(activeUsers[0].date).toBe('2024-05-14');
      expect(activeUsers[activeUsers.length - 1].date).toBe('2024-06-12');

      const byDate = new Map(activeUsers.map((p) => [p.date, p]));

      // Last day: DAU counts only 06-12; WAU(06-06..06-12)={1,2}; MAU(05-14..06-12)={1,2}
      expect(byDate.get('2024-06-12')).toEqual({
        date: '2024-06-12',
        dau: 1,
        wau: 2,
        mau: 2,
      });

      // 06-11: no activity that day, but trailing windows still see recent users
      expect(byDate.get('2024-06-11')).toEqual({
        date: '2024-06-11',
        dau: 0,
        wau: 1, // only user 2 (06-10) within 06-05..06-11
        mau: 2, // user 1 (05-20) + user 2 (06-10) within 05-13..06-11
      });
    });
  });

  describe('retention', () => {
    it('labels weekly-active users new vs returning by account-creation week', async () => {
      repo.getWeeklyActivePairsWithCreatedAt.mockResolvedValue([
        // active in week 05-13, account created same week -> new
        { week: '2024-05-13', counselorId: 1, userCreatedAt: '2024-05-15' },
        // active in week 06-10, account created same week -> new
        { week: '2024-06-10', counselorId: 2, userCreatedAt: '2024-06-11' },
        // active in week 06-10, account created long ago -> returning
        { week: '2024-06-10', counselorId: 3, userCreatedAt: '2024-01-01' },
      ]);

      const { retention } = await service.getOverview({ range: '30d' });

      expect(retention.map((p) => p.weekStart)).toEqual(WEEKLY_AXIS);
      expect(retention).toEqual([
        { weekStart: '2024-05-13', newUsers: 1, returningUsers: 0 },
        { weekStart: '2024-05-20', newUsers: 0, returningUsers: 0 },
        { weekStart: '2024-05-27', newUsers: 0, returningUsers: 0 },
        { weekStart: '2024-06-03', newUsers: 0, returningUsers: 0 },
        { weekStart: '2024-06-10', newUsers: 1, returningUsers: 1 },
      ]);
    });
  });

  describe('simulationsCompleted', () => {
    it('zero-fills the weekly axis', async () => {
      repo.getSimulationsCompletedByWeek.mockResolvedValue([
        { week: '2024-06-10', count: 5 },
      ]);

      const { simulationsCompleted } = await service.getOverview({
        range: '30d',
      });

      expect(simulationsCompleted).toEqual([
        { weekStart: '2024-05-13', count: 0 },
        { weekStart: '2024-05-20', count: 0 },
        { weekStart: '2024-05-27', count: 0 },
        { weekStart: '2024-06-03', count: 0 },
        { weekStart: '2024-06-10', count: 5 },
      ]);
    });
  });

  describe('summary', () => {
    it('computes the retention rate as returning / active * 100', async () => {
      repo.getTotalUsers.mockResolvedValue(100);
      repo.getActiveUserCountSince.mockResolvedValue(10);
      repo.getReturningActiveUserCountSince.mockResolvedValue(4);
      repo.getCompletedSimsSince.mockResolvedValue(7);
      repo.getUsersByRole.mockResolvedValue([
        { role: 'LEARNER', count: 80 },
        { role: 'SUPER_ADMIN', count: 2 },
      ]);

      const { summary, usersByRole } = await service.getOverview({
        range: '30d',
      });

      expect(summary).toEqual({
        totalUsers: 100,
        activeUsers: 10,
        simulationsCompleted: 7,
        retentionRatePct: 40,
      });
      expect(usersByRole).toEqual([
        { role: 'LEARNER', count: 80 },
        { role: 'SUPER_ADMIN', count: 2 },
      ]);
    });

    it('reports 0% retention when there are no active users', async () => {
      repo.getActiveUserCountSince.mockResolvedValue(0);
      repo.getReturningActiveUserCountSince.mockResolvedValue(0);

      const { summary } = await service.getOverview({ range: '30d' });

      expect(summary.retentionRatePct).toBe(0);
    });
  });

  describe('range -> bucket mapping', () => {
    it('uses monthly buckets for the 12m range', async () => {
      await service.getOverview({ range: '12m' });
      expect(repo.getNewUsersByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
      );
    });

    it('uses weekly buckets for the 90d range', async () => {
      await service.getOverview({ range: '90d' });
      expect(repo.getNewUsersByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'week',
      );
    });
  });

  describe('getVoiceLatency', () => {
    it('defaults to daily buckets for the 30d range over the 30-day window', async () => {
      await service.getVoiceLatency({ range: '30d' });

      expect(repo.getVoiceLatencyByBucket).toHaveBeenCalledWith(
        new Date('2024-05-14T00:00:00.000Z'), // today - 29d
        new Date('2024-06-13T00:00:00.000Z'), // start of tomorrow
        'day',
        undefined, // no language filter
      );
    });

    it('defaults to weekly buckets for the 90d range', async () => {
      await service.getVoiceLatency({ range: '90d' });

      const [start, end, bucket] = repo.getVoiceLatencyByBucket.mock.calls[0];
      expect(bucket).toBe('week');
      expect(start).toEqual(new Date('2024-03-15T00:00:00.000Z')); // today - 89d
      expect(end).toEqual(new Date('2024-06-13T00:00:00.000Z'));
    });

    it('defaults to monthly buckets for the 12m range', async () => {
      await service.getVoiceLatency({ range: '12m' });
      expect(repo.getVoiceLatencyByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        undefined, // no language filter
      );
    });

    it('honours an explicit bucket override while keeping the range window', async () => {
      await service.getVoiceLatency({ range: '12m', bucket: 'week' });

      const [start, , bucket] = repo.getVoiceLatencyByBucket.mock.calls[0];
      // bucket overridden, but the window is still the 12-month range start.
      expect(bucket).toBe('week');
      expect(start).toEqual(new Date('2023-07-01T00:00:00.000Z'));
    });

    it('passes repo points through and includes the range, bucket and target', async () => {
      const points = [
        {
          bucket: '2024-06-10',
          source: 'pipeline',
          turns: 12,
          avgMs: 4858,
          p50Ms: 4200,
          p95Ms: 8046,
        },
        {
          bucket: '2024-06-10',
          source: 'transcript',
          turns: 4,
          avgMs: 4421,
          p50Ms: 4000,
          p95Ms: 6597,
        },
      ];
      repo.getVoiceLatencyByBucket.mockResolvedValue(points);

      const result = await service.getVoiceLatency({ range: '90d' });

      expect(result.window).toMatchObject({
        from: '2024-03-15',
        to: '2024-06-12',
        label: 'Last 90 days',
        days: 90,
        bucket: 'week',
      });
      expect(result).toMatchObject({
        range: '90d',
        bucket: 'week',
        targetMs: 1500,
        points,
        byLanguage: [],
      });
    });

    it('includes the language breakdown alongside the bucketed trend', async () => {
      const byLanguage = [
        { language: 'en', turns: 100, avgMs: 900, p95Ms: 1600 },
        { language: 'hi-IN', turns: 40, avgMs: 1200, p95Ms: 2100 },
      ];
      repo.getVoiceLatencyByLanguage.mockResolvedValue(byLanguage);

      const result = await service.getVoiceLatency({ range: '30d' });

      expect(repo.getVoiceLatencyByLanguage).toHaveBeenCalledWith(
        new Date('2024-05-14T00:00:00.000Z'),
        new Date('2024-06-13T00:00:00.000Z'),
      );
      expect(result.byLanguage).toEqual(byLanguage);
    });
  });

  describe('getTokenConsumption', () => {
    it('queries the [start, end) window for the range', async () => {
      await service.getTokenConsumption({ range: '30d' });

      expect(llmUsageRepo.getTokenUsageByModelAndTask).toHaveBeenCalledWith(
        new Date('2024-05-14T00:00:00.000Z'), // today - 29d
        new Date('2024-06-13T00:00:00.000Z'), // start of tomorrow
      );
    });

    it('computes estimated USD cost per service and flags unpriced rows', async () => {
      llmUsageRepo.getTokenUsageByModelAndTask.mockResolvedValue([
        {
          service: 'llm',
          model: 'gpt-4o-mini', // 0.15 / 0.60 per 1M
          provider: 'openai',
          task: 'summary',
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
          cachedTokens: 0,
          audioMs: 0,
          characters: 0,
          calls: 10,
        },
        {
          service: 'stt',
          model: 'nova-3', // deepgram 0.0077/min
          provider: 'deepgram',
          task: 'agent_stt',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
          audioMs: 600_000, // 10 minutes → 0.077
          characters: 0,
          calls: 5,
        },
        {
          service: 'tts',
          model: 'aura', // deepgram 15/1M chars
          provider: 'deepgram',
          task: 'agent_tts',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
          audioMs: 0,
          characters: 1_000_000, // → 15
          calls: 5,
        },
        {
          service: 'llm',
          model: 'mystery-model', // no pricing entry
          provider: 'x',
          task: 'nudge',
          promptTokens: 500_000,
          completionTokens: 0,
          totalTokens: 500_000,
          cachedTokens: 0,
          audioMs: 0,
          characters: 0,
          calls: 2,
        },
      ]);

      const result = await service.getTokenConsumption({ range: '30d' });

      expect(result.range).toBe('30d');
      const byModel = Object.fromEntries(
        result.points.map((p) => [p.model, p]),
      );
      expect(byModel['gpt-4o-mini']).toMatchObject({
        service: 'llm',
        estimatedCostUsd: 0.75, // 0.15 + 0.60
        priced: true,
      });
      expect(byModel['nova-3']).toMatchObject({
        service: 'stt',
        estimatedCostUsd: 0.08, // 10 min × 0.0077 = 0.077 → round2 0.08
        priced: true,
      });
      expect(byModel['aura']).toMatchObject({
        service: 'tts',
        estimatedCostUsd: 15, // 1M chars × 15/1M
        priced: true,
      });
      expect(byModel['mystery-model']).toMatchObject({
        estimatedCostUsd: 0,
        priced: false,
        totalTokens: 500_000, // quantities preserved even when unpriced
      });
      expect(result.totalEstimatedCostUsd).toBe(15.83); // 0.75 + 0.08 + 15
    });
  });

  describe('conversationDrift — scenario version slice', () => {
    let driftRepo: jest.Mocked<DriftAnalyticsRepository>;
    beforeEach(() => {
      driftRepo = service['driftRepo'] as jest.Mocked<DriftAnalyticsRepository>;
    });

    it('compares versions when a scenarioId is set, ignoring the version filter', async () => {
      driftRepo.getDriftRateByDimension.mockImplementation(
        async (_f, dimension) =>
          dimension === 'scenarioVersion'
            ? [{ key: 'v2', totalSessions: 4, driftedSessions: 1 }]
            : [],
      );

      const result = await service.getConversationDrift('90d', {
        scenarioId: 7,
        scenarioVersionId: 'ver-123',
      });

      expect(result.driftRateByScenarioVersion).toEqual([
        { key: 'v2', totalSessions: 4, driftedSessions: 1, driftRate: 0.25 },
      ]);
      // The comparison must span ALL versions of the scenario, so the
      // scenarioVersionId filter is dropped for the scenarioVersion dimension.
      expect(driftRepo.getDriftRateByDimension).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: 7,
          scenarioVersionId: undefined,
        }),
        'scenarioVersion',
      );
    });

    it('skips the version comparison entirely when no scenarioId is set', async () => {
      driftRepo.getDriftRateByDimension.mockResolvedValue([]);

      const result = await service.getConversationDrift('90d', {});

      expect(result.driftRateByScenarioVersion).toEqual([]);
      const dims = driftRepo.getDriftRateByDimension.mock.calls.map(
        ([, dimension]) => dimension,
      );
      expect(dims).not.toContain('scenarioVersion');
    });
  });

  describe('getAgentJoinReliability', () => {
    it('computes failureRatePct per bucket and guards divide-by-zero', async () => {
      (repo.getAgentJoinReliabilityByBucket as jest.Mock).mockResolvedValue([
        {
          bucket: '2026-07-01',
          totalSessions: 10,
          joinFailures: 3,
          midSessionDrops: 1,
          joinLatencyP50Sec: 2,
          joinLatencyP95Sec: 8,
        },
        {
          bucket: '2026-07-02',
          totalSessions: 0,
          joinFailures: 0,
          midSessionDrops: 0,
          joinLatencyP50Sec: null,
          joinLatencyP95Sec: null,
        },
      ]);
      (repo.getSessionOutcomeMix as jest.Mock).mockResolvedValue({
        completed: 7,
        noConversation: 3,
        inProgress: 1,
      });
      // 2 freezes out of 8 conversations in the first bucket -> 25%.
      (repo.getSuspectedFreezeByBucket as jest.Mock).mockResolvedValue([
        { bucket: '2026-07-01', conversations: 8, suspectedFreezes: 2 },
      ]);

      const result = await service.getAgentJoinReliability({ range: '30d' });

      const b1 = result.points.find((p) => p.bucket === '2026-07-01')!;
      const b2 = result.points.find((p) => p.bucket === '2026-07-02')!;
      expect(b1.failureRatePct).toBe(30);
      expect(b2.failureRatePct).toBe(0); // no divide-by-zero
      expect(b1.midSessionDrops).toBe(1);
      // freeze merge by bucket + rate computation
      expect(b1.conversations).toBe(8);
      expect(b1.suspectedFreezes).toBe(2);
      expect(b1.freezeRatePct).toBe(25);
      expect(b2.freezeRatePct).toBe(0); // bucket with no freeze data
      expect(result.outcomeMix).toEqual({
        completed: 7,
        noConversation: 3,
        inProgress: 1,
      });
    });
  });
});
