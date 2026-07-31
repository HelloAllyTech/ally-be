import { Test, TestingModule } from '@nestjs/testing';
import { TenantAnalyticsService } from '../tenant-analytics.service';
import { TenantAnalyticsRepository } from '../../repository/tenant-analytics.repository';

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
 *   windowStart  = 2024-05-14 (today - 29d)
 *   endExclusive = 2024-06-13 (start of tomorrow)
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const TENANT_ID = 'tenant-1';

describe('TenantAnalyticsService', () => {
  let service: TenantAnalyticsService;
  let repo: jest.Mocked<TenantAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<TenantAnalyticsRepository>> = {
      getCompletedSimulationCount: jest.fn().mockResolvedValue(0),
      getActiveUserCount: jest.fn().mockResolvedValue(0),
      getCompletedSimulationsByBucket: jest.fn().mockResolvedValue([]),
      getActiveUsersByBucket: jest.fn().mockResolvedValue([]),
      getNewLearnersOnboardedCount: jest.fn().mockResolvedValue(0),
      getNewLearnersOnboardedByBucket: jest.fn().mockResolvedValue([]),
      getTotalRegisteredLearnersCount: jest.fn().mockResolvedValue(0),
      getSessionEngagementTotals: jest.fn().mockResolvedValue({
        totalSessions: 0,
        activeLearners: 0,
        totalDurationMs: 0,
      }),
      getTimeToFirstSessionStats: jest
        .fn()
        .mockResolvedValue({ learnerCount: 0, avgDays: null }),
      getMostUsedSimulations: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAnalyticsService,
        { provide: TenantAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(TenantAnalyticsService);
    repo = module.get(TenantAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('scopes every new-metric query to the resolved 30d window', async () => {
    await service.getOrganizationMetrics(TENANT_ID, '30d');

    const windowStart = new Date('2024-05-14T00:00:00.000Z');
    const endExclusive = new Date('2024-06-13T00:00:00.000Z');

    expect(repo.getNewLearnersOnboardedCount).toHaveBeenCalledWith(
      TENANT_ID,
      windowStart,
      endExclusive,
    );
    expect(repo.getNewLearnersOnboardedByBucket).toHaveBeenCalledWith(
      TENANT_ID,
      windowStart,
      endExclusive,
      'day',
    );
    expect(repo.getSessionEngagementTotals).toHaveBeenCalledWith(
      TENANT_ID,
      windowStart,
      endExclusive,
    );
    expect(repo.getTimeToFirstSessionStats).toHaveBeenCalledWith(
      TENANT_ID,
      windowStart,
      endExclusive,
    );
    expect(repo.getMostUsedSimulations).toHaveBeenCalledWith(
      TENANT_ID,
      windowStart,
      endExclusive,
      5,
    );
  });

  it('computes total registered learners without a window bound', async () => {
    await service.getOrganizationMetrics(TENANT_ID, '90d');

    expect(repo.getTotalRegisteredLearnersCount).toHaveBeenCalledWith(
      TENANT_ID,
    );
  });

  it('derives avg sessions/practice-time per active learner, rounded to 1dp', async () => {
    repo.getSessionEngagementTotals.mockResolvedValue({
      totalSessions: 7,
      activeLearners: 3,
      totalDurationMs: 3 * 15.5 * 60_000, // 15.5 min/learner
    });

    const result = await service.getOrganizationMetrics(TENANT_ID, '30d');

    expect(result.summary.avgSessionsPerActiveLearner).toBeCloseTo(2.3, 5); // 7/3
    expect(result.summary.avgPracticeMinutesPerLearner).toBe(15.5);
  });

  it('returns null (not 0/NaN) for the per-learner averages when there are no active learners', async () => {
    repo.getSessionEngagementTotals.mockResolvedValue({
      totalSessions: 0,
      activeLearners: 0,
      totalDurationMs: 0,
    });

    const result = await service.getOrganizationMetrics(TENANT_ID, '30d');

    expect(result.summary.avgSessionsPerActiveLearner).toBeNull();
    expect(result.summary.avgPracticeMinutesPerLearner).toBeNull();
  });

  it('rounds avgDaysToFirstSession and carries the sample size, or nulls out when n is 0', async () => {
    repo.getTimeToFirstSessionStats.mockResolvedValue({
      learnerCount: 4,
      avgDays: 2.34,
    });

    const withData = await service.getOrganizationMetrics(TENANT_ID, '30d');
    expect(withData.summary.avgDaysToFirstSession).toBe(2.3);
    expect(withData.summary.learnersWithFirstSessionCount).toBe(4);

    repo.getTimeToFirstSessionStats.mockResolvedValue({
      learnerCount: 0,
      avgDays: null,
    });
    const noData = await service.getOrganizationMetrics(TENANT_ID, '30d');
    expect(noData.summary.avgDaysToFirstSession).toBeNull();
    expect(noData.summary.learnersWithFirstSessionCount).toBe(0);
  });

  it('zero-fills the new-learners trend and passes through the ranked simulations list', async () => {
    repo.getNewLearnersOnboardedByBucket.mockResolvedValue([
      { bucket: '2024-06-01', count: 3 },
    ]);
    repo.getMostUsedSimulations.mockResolvedValue([
      { scenarioId: 1, title: 'Difficult Conversation', sessionCount: 9 },
      { scenarioId: 2, title: 'De-escalation', sessionCount: 4 },
    ]);

    const result = await service.getOrganizationMetrics(TENANT_ID, '30d');

    expect(result.newLearnersOnboardedTrend).toHaveLength(30);
    expect(
      result.newLearnersOnboardedTrend.find((p) => p.bucket === '2024-06-01'),
    ).toEqual({ bucket: '2024-06-01', count: 3 });
    const otherBuckets = result.newLearnersOnboardedTrend.filter(
      (p) => p.bucket !== '2024-06-01',
    );
    expect(otherBuckets.every((p) => p.count === 0)).toBe(true);
    expect(result.mostUsedSimulations).toEqual([
      { scenarioId: 1, title: 'Difficult Conversation', sessionCount: 9 },
      { scenarioId: 2, title: 'De-escalation', sessionCount: 4 },
    ]);
  });

  it('carries through newLearnersOnboarded and totalRegisteredLearners in the summary', async () => {
    repo.getNewLearnersOnboardedCount.mockResolvedValue(6);
    repo.getTotalRegisteredLearnersCount.mockResolvedValue(42);

    const result = await service.getOrganizationMetrics(TENANT_ID, '30d');

    expect(result.summary.newLearnersOnboarded).toBe(6);
    expect(result.summary.totalRegisteredLearners).toBe(42);
  });
});
