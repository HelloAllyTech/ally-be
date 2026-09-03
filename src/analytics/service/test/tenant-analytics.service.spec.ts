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

const LEARNER_ROW = {
  id: 7,
  name: 'Asha Rao',
  email: 'asha@example.com',
  signupDate: new Date('2024-03-01T00:00:00.000Z'),
  lastPracticeSessionAt: new Date('2024-05-01T00:00:00.000Z'),
  lastActivityAt: new Date('2024-06-10T00:00:00.000Z'),
  daysSinceLastActivity: 2,
  status: 'active' as const,
  roleplaySessionsStarted: 11,
  roleplaySessionsCompleted: 9,
  avgScore: 72.46,
  totalDurationMs: 3_918_000,
  roleplayPointsPerMinute: 4.0245,
  coursesAssigned: 3,
  coursesStarted: 3,
  coursesCompleted: 2,
  level: 4,
  totalXp: 1234,
  itemsTotal: 24,
  itemsCompleted: 18,
  itemsCompletedPct: 75,
  quizzesPassed: 8,
  quizzesAttempted: 11,
  avgQuizScorePct: 78.44,
  readWatchCompleted: 6,
  reflectionCompleted: 4,
};

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
      getTenantDataFloor: jest
        .fn()
        .mockResolvedValue(new Date('2024-02-20T00:00:00.000Z')),
      getLearnerUsageRows: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
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

  it("runs range='all' from the tenant's own data floor, bucketed by month", async () => {
    const result = await service.getOrganizationMetrics(TENANT_ID, 'all');

    expect(repo.getTenantDataFloor).toHaveBeenCalledWith(TENANT_ID);
    expect(result.range).toBe('all');
    expect(result.bucket).toBe('month');
    expect(repo.getCompletedSimulationsByBucket).toHaveBeenCalledWith(
      TENANT_ID,
      new Date('2024-02-20T00:00:00.000Z'),
      new Date('2024-06-13T00:00:00.000Z'),
      'month',
    );
    // Feb (the floor's month) through Jun (today's month), gap-free.
    expect(result.simulationsCompletedTrend.map((p) => p.bucket)).toEqual([
      '2024-02-01',
      '2024-03-01',
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
  });

  it('only measures the data floor for the all-time range', async () => {
    await service.getOrganizationMetrics(TENANT_ID, '12m');

    expect(repo.getTenantDataFloor).not.toHaveBeenCalled();
  });

  it('carries through newLearnersOnboarded and totalRegisteredLearners in the summary', async () => {
    repo.getNewLearnersOnboardedCount.mockResolvedValue(6);
    repo.getTotalRegisteredLearnersCount.mockResolvedValue(42);

    const result = await service.getOrganizationMetrics(TENANT_ID, '30d');

    expect(result.summary.newLearnersOnboarded).toBe(6);
    expect(result.summary.totalRegisteredLearners).toBe(42);
  });
  describe('getLearnerUsage', () => {
    it('passes the status facet through to the repository rather than filtering the page', async () => {
      await service.getLearnerUsage(TENANT_ID, {
        range: '30d',
        status: ['dormant', 'never_started'],
      });

      expect(repo.getLearnerUsageRows).toHaveBeenCalledWith(
        TENANT_ID,
        new Date('2024-05-14T00:00:00.000Z'),
        new Date('2024-06-13T00:00:00.000Z'),
        expect.objectContaining({ statuses: ['dormant', 'never_started'] }),
      );
    });

    it('takes status and daysSinceLastActivity from the repository instead of recomputing them', async () => {
      // The SQL derives both (the facet has to filter before LIMIT/OFFSET, or
      // `count` would describe the unfiltered set). If this layer recomputed
      // them the two could disagree on screen — a row filtered in as dormant
      // showing an "Active" chip.
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [
          { ...LEARNER_ROW, daysSinceLastActivity: 38, status: 'dormant' },
        ],
        count: 1,
      });

      const result = await service.getLearnerUsage(TENANT_ID, { range: '30d' });

      expect(result.data[0].status).toBe('dormant');
      expect(result.data[0].daysSinceLastActivity).toBe(38);
    });

    it('derives lastActivityAt independently of the roleplay-only timestamp', async () => {
      // A learner who only ever does quizzes has no roleplay session at all
      // and used to read as "never started".
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [
          {
            ...LEARNER_ROW,
            lastPracticeSessionAt: null,
            lastActivityAt: new Date('2024-06-11T00:00:00.000Z'),
            daysSinceLastActivity: 1,
            status: 'active',
            roleplaySessionsStarted: 0,
            roleplaySessionsCompleted: 0,
          },
        ],
        count: 1,
      });

      const result = await service.getLearnerUsage(TENANT_ID, { range: '30d' });

      expect(result.data[0].lastPracticeSessionAt).toBeNull();
      expect(result.data[0].status).toBe('active');
    });

    it('rounds the effort percentages to one decimal and carries the counts through', async () => {
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [LEARNER_ROW],
        count: 1,
      });

      const [row] = (await service.getLearnerUsage(TENANT_ID, { range: '30d' }))
        .data;

      expect(row.roleplayPointsPerMinute).toBe(4);
      expect(row.avgQuizScorePct).toBe(78.4);
      expect(row.itemsCompletedPct).toBe(75);
      expect(row.level).toBe(4);
      expect(row.totalXp).toBe(1234);
      expect(row.quizzesPassed).toBe(8);
      expect(row.quizzesAttempted).toBe(11);
      expect(row.readWatchCompleted).toBe(6);
      expect(row.reflectionCompleted).toBe(4);
    });

    it('leaves points-per-minute null when the window holds no practice time', async () => {
      // The repository returns null rather than 0 when durationMs is 0 — a
      // learner with no measurable practice has nothing to rate, which is not
      // the same as rating zero.
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [
          { ...LEARNER_ROW, totalDurationMs: 0, roleplayPointsPerMinute: null },
        ],
        count: 1,
      });

      const [row] = (await service.getLearnerUsage(TENANT_ID, { range: '30d' }))
        .data;

      expect(row.roleplayPointsPerMinute).toBeNull();
      expect(row.totalPracticeMinutes).toBe(0);
    });

    it('carries a negative points-per-minute through instead of flooring it', async () => {
      // Roleplay composite scores go below zero, so the rate can too.
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [{ ...LEARNER_ROW, roleplayPointsPerMinute: -2.36 }],
        count: 1,
      });

      const [row] = (await service.getLearnerUsage(TENANT_ID, { range: '30d' }))
        .data;

      expect(row.roleplayPointsPerMinute).toBe(-2.4);
    });

    it('leaves an ungraded learner null rather than reporting a zero score', async () => {
      repo.getLearnerUsageRows.mockResolvedValue({
        rows: [
          {
            ...LEARNER_ROW,
            avgQuizScorePct: null,
            quizzesAttempted: 0,
            quizzesPassed: 0,
            itemsTotal: 0,
            itemsCompleted: 0,
            itemsCompletedPct: null,
          },
        ],
        count: 1,
      });

      const [row] = (await service.getLearnerUsage(TENANT_ID, { range: '30d' }))
        .data;

      expect(row.avgQuizScorePct).toBeNull();
      expect(row.itemsCompletedPct).toBeNull();
    });
  });
});
