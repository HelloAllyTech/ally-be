import { Test, TestingModule } from '@nestjs/testing';
import { HighlightsAnalyticsService } from '../highlights-analytics.service';
import { HighlightsAnalyticsRepository } from '../../repository/highlights-analytics.repository';

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

// Pricing is a lookup table that changes over time — stub it so the cost-merge
// plumbing is tested without coupling to real rates. 'priced-model' costs a
// flat $10 per usage row; 'unpriced-model' has no pricing entry.
jest.mock('../../constants/llm-pricing.constants', () => ({
  computeServiceCostUsd: jest.fn((_service, _provider, model) =>
    model === 'unpriced-model'
      ? { costUsd: 0, priced: false }
      : { costUsd: 10, priced: true },
  ),
}));

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z. For range='30d' this yields:
 *   windowStart  = 2024-05-14 (today - 29d)
 *   endExclusive = 2024-06-13 (start of tomorrow)
 *   daily axis   = 2024-05-14 .. 2024-06-12 (30 days)
 *   weekly axis  = 2024-05-13, 05-20, 05-27, 06-03, 06-10 (Mondays)
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const WEEKLY_AXIS = [
  '2024-05-13',
  '2024-05-20',
  '2024-05-27',
  '2024-06-03',
  '2024-06-10',
];

const usageRow = (
  overrides: Partial<{
    bucket: string;
    service: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    audioMs: number;
    characters: number;
    calls: number;
  }> = {},
) => ({
  bucket: '2024-06-10',
  service: 'llm',
  provider: 'anthropic',
  model: 'priced-model',
  promptTokens: 1000,
  completionTokens: 100,
  audioMs: 0,
  characters: 0,
  calls: 5,
  ...overrides,
});

describe('HighlightsAnalyticsService', () => {
  let service: HighlightsAnalyticsService;
  let repo: jest.Mocked<HighlightsAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<HighlightsAnalyticsRepository>> = {
      getActiveOrgCount: jest.fn().mockResolvedValue(0),
      getTopOrgsByCompletedSims: jest
        .fn()
        .mockResolvedValue({ rows: [], belowFloor: { orgs: 0, sims: 0 } }),
      getPracticeMinutesByBucket: jest.fn().mockResolvedValue([]),
      getPlayTimeByBucket: jest.fn().mockResolvedValue([]),
      getPlayTimeOverall: jest
        .fn()
        .mockResolvedValue({ avgMinutes: null, sessions: 0 }),
      getQualityTrendByBucket: jest.fn().mockResolvedValue([]),
      getQualityOverall: jest
        .fn()
        .mockResolvedValue({ avgCompositeScore: null, evaluatedSessions: 0 }),
      getCsatTrendByBucket: jest.fn().mockResolvedValue([]),
      getCsatOverall: jest
        .fn()
        .mockResolvedValue({ avgRating: null, responses: 0 }),
      getTrackFunnelCounts: jest
        .fn()
        .mockResolvedValue({ enrolled: 0, started: 0, completed: 0 }),
      getQuizPassCounts: jest
        .fn()
        .mockResolvedValue({ attempts: 0, passed: 0 }),
      getCompletedSimulationsByBucket: jest.fn().mockResolvedValue([]),
      getAiUsageByBucket: jest.fn().mockResolvedValue([]),
      getDataFloor: jest
        .fn()
        .mockResolvedValue(new Date('2023-03-15T00:00:00.000Z')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HighlightsAnalyticsService,
        { provide: HighlightsAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(HighlightsAnalyticsService);
    repo = module.get(HighlightsAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("range='all'", () => {
    it('spans the measured data floor to today, in month buckets', async () => {
      const res = await service.getHighlights({ range: 'all' });

      expect(repo.getDataFloor).toHaveBeenCalled();
      expect(res.bucket).toBe('month');
      expect(res.window).toMatchObject({
        from: '2023-03-15',
        to: '2024-06-12',
        label: 'All time',
        allTime: true,
        inProgressBucket: '2024-06-01',
      });
      // 2023-03 .. 2024-06 inclusive = 16 monthly buckets.
      expect(res.practiceMinutes).toHaveLength(16);
      expect(res.practiceMinutes[0].bucket).toBe('2023-03-01');
    });

    it('passes the requested grain to every bucketed query', async () => {
      await service.getHighlights({ range: 'all', bucket: 'year' });

      for (const fn of [
        repo.getPracticeMinutesByBucket,
        repo.getPlayTimeByBucket,
        repo.getQualityTrendByBucket,
        repo.getCsatTrendByBucket,
        repo.getCompletedSimulationsByBucket,
      ]) {
        expect(fn).toHaveBeenCalledWith(
          expect.any(Date),
          expect.any(Date),
          'year',
          undefined,
        );
      }
      expect(repo.getAiUsageByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'year',
      );
    });

    it('returns no comparison basis even when compare=prev is asked for', async () => {
      const res = await service.getHighlights({
        range: 'all',
        compare: 'prev',
      });

      expect(res.previous).toBeNull();
      expect(res.previousLabel).toBeNull();
      // ...and does not spend the comparison queries either.
      expect(repo.getPlayTimeOverall).toHaveBeenCalledTimes(1);
    });

    it('does not measure the data floor for a bounded range', async () => {
      await service.getHighlights({ range: '90d' });
      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });
  });

  describe('bucket axis + gap-fill', () => {
    it('30d defaults to a 30-label DAY axis (day branch, not weekly)', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.bucket).toBe('day');
      expect(res.practiceMinutes).toHaveLength(30);
      expect(res.practiceMinutes[0].bucket).toBe('2024-05-14');
      expect(res.practiceMinutes[29].bucket).toBe('2024-06-12');
      expect(res.costPerSim).toHaveLength(30);
    });

    it('gap-fills practice minutes with zeros on the contiguous axis', async () => {
      repo.getPracticeMinutesByBucket.mockResolvedValue([
        { bucket: '2024-05-20', minutes: 12.5, activeLearners: 3 },
      ]);

      const res = await service.getHighlights({ range: '30d' });

      const hit = res.practiceMinutes.find((p) => p.bucket === '2024-05-20');
      expect(hit).toEqual({
        bucket: '2024-05-20',
        minutes: 12.5,
        activeLearners: 3,
      });
      const misses = res.practiceMinutes.filter(
        (p) => p.bucket !== '2024-05-20',
      );
      expect(
        misses.every((p) => p.minutes === 0 && p.activeLearners === 0),
      ).toBe(true);
    });

    it('honours an explicit bucket override (30d viewed week-wise)', async () => {
      const res = await service.getHighlights({ range: '30d', bucket: 'week' });

      expect(res.bucket).toBe('week');
      expect(res.practiceMinutes.map((p) => p.bucket)).toEqual(WEEKLY_AXIS);
    });

    it('12m produces a 12-label month axis', async () => {
      const res = await service.getHighlights({ range: '12m' });

      expect(res.bucket).toBe('month');
      expect(res.practiceMinutes.map((p) => p.bucket)).toEqual([
        '2023-07-01',
        '2023-08-01',
        '2023-09-01',
        '2023-10-01',
        '2023-11-01',
        '2023-12-01',
        '2024-01-01',
        '2024-02-01',
        '2024-03-01',
        '2024-04-01',
        '2024-05-01',
        '2024-06-01',
      ]);
    });
  });

  describe('cost per completed simulation', () => {
    it('merges per-bucket cost with the sims denominator and nulls 0-sim buckets', async () => {
      repo.getAiUsageByBucket.mockResolvedValue([
        usageRow({ bucket: '2024-06-10' }),
        usageRow({ bucket: '2024-06-10', model: 'unpriced-model', calls: 7 }),
        usageRow({ bucket: '2024-06-11' }),
      ]);
      repo.getCompletedSimulationsByBucket.mockResolvedValue([
        { bucket: '2024-06-10', count: 4 },
      ]);

      const res = await service.getHighlights({ range: '30d' });

      const withSims = res.costPerSim.find((p) => p.bucket === '2024-06-10');
      expect(withSims).toEqual({
        bucket: '2024-06-10',
        estimatedCostUsd: 10,
        completedSimulations: 4,
        costPerSimUsd: 2.5,
        unpricedCalls: 7,
      });

      // Cost but no completed sims -> ratio is null, never Infinity/NaN.
      const noSims = res.costPerSim.find((p) => p.bucket === '2024-06-11');
      expect(noSims).toEqual({
        bucket: '2024-06-11',
        estimatedCostUsd: 10,
        completedSimulations: 0,
        costPerSimUsd: null,
        unpricedCalls: 0,
      });

      expect(res.summary.totalAiCostUsd).toBe(20);
      expect(res.summary.completedSimulations).toBe(4);
      expect(res.summary.costPerCompletedSimUsd).toBe(5);
    });

    it('nulls the summary cost-per-sim when nothing completed', async () => {
      repo.getAiUsageByBucket.mockResolvedValue([usageRow()]);

      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.totalAiCostUsd).toBe(10);
      expect(res.summary.costPerCompletedSimUsd).toBeNull();
    });
  });

  describe('summary ratios', () => {
    it('nulls funnel/quiz percentages on empty denominators', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.trackCompletionRatePct).toBeNull();
      expect(res.summary.quizPassRatePct).toBeNull();
      expect(res.trackFunnel.quizPassRatePct).toBeNull();
    });

    it('rounds funnel/quiz percentages to one decimal', async () => {
      repo.getTrackFunnelCounts.mockResolvedValue({
        enrolled: 3,
        started: 2,
        completed: 1,
      });
      repo.getQuizPassCounts.mockResolvedValue({ attempts: 3, passed: 2 });

      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.trackCompletionRatePct).toBe(33.3);
      expect(res.summary.quizPassRatePct).toBe(66.7);
      expect(res.trackFunnel).toEqual({
        enrolled: 3,
        started: 2,
        completed: 1,
        quizAttempts: 3,
        quizPassed: 2,
        quizPassRatePct: 66.7,
      });
    });
  });

  describe('window echo', () => {
    it('reports the resolved window with an INCLUSIVE end date', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.window).toMatchObject({
        from: '2024-05-14',
        // endExclusive is 2024-06-13; the label a reader sees must be 06-12.
        to: '2024-06-12',
        label: 'Last 30 days',
        days: 30,
        bucket: 'day',
      });
    });

    it('resolves an explicit from/to window and auto-buckets it', async () => {
      const res = await service.getHighlights({
        from: '2024-03-01',
        to: '2024-03-31',
      });

      expect(res.window).toMatchObject({
        from: '2024-03-01',
        to: '2024-03-31',
        label: '2024-03-01 → 2024-03-31',
        days: 31,
        bucket: 'day',
      });
      expect(res.practiceMinutes).toHaveLength(31);
    });

    it('rejects a one-sided custom range', async () => {
      await expect(
        service.getHighlights({ from: '2024-03-01' }),
      ).rejects.toThrow(/must be supplied together/);
    });

    it('rejects a custom range longer than the cap', async () => {
      await expect(
        service.getHighlights({ from: '2020-01-01', to: '2024-01-01' }),
      ).rejects.toThrow(/limited to 400 days/);
    });
  });

  describe('comparison window', () => {
    it('omits `previous` unless compare=prev is asked for', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.previous).toBeNull();
      expect(res.previousLabel).toBeNull();
      // Only the current window is queried.
      expect(repo.getQualityOverall).toHaveBeenCalledTimes(1);
    });

    it('computes the equal-length preceding window for compare=prev', async () => {
      const res = await service.getHighlights({
        range: '30d',
        compare: 'prev',
      });

      expect(res.previousLabel).toBe('previous 30 days');
      expect(res.previous).not.toBeNull();

      // Current window is [2024-05-14, 2024-06-13); the previous window must be
      // the same 30 days immediately before it, i.e. [2024-04-14, 2024-05-14).
      const calls = repo.getQualityOverall.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0].toISOString().slice(0, 10)).toBe('2024-04-14');
      expect(calls[1][1].toISOString().slice(0, 10)).toBe('2024-05-14');
    });

    it('does NOT recompute the trends for the comparison window', async () => {
      await service.getHighlights({ range: '30d', compare: 'prev' });

      // Summary scalars run twice, trends once — a delta needs one number per
      // window, not a second axis.
      expect(repo.getQualityOverall).toHaveBeenCalledTimes(2);
      expect(repo.getQualityTrendByBucket).toHaveBeenCalledTimes(1);
      expect(repo.getCsatTrendByBucket).toHaveBeenCalledTimes(1);
    });
  });

  describe('tenant scoping', () => {
    it('is platform-wide with no unscoped sections by default', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
      expect(repo.getQualityOverall).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });

    it('threads tenantId to scopable queries and names the ones it cannot scope', async () => {
      const res = await service.getHighlights({
        range: '30d',
        tenantId: 'acme',
      });

      expect(res.scoping.tenantId).toBe('acme');
      // AI spend is mostly tenantless, so it stays platform-wide and says so
      // rather than reporting a fraction of real cost as if it were the whole.
      expect(res.scoping.unscopedSections).toContain('costPerSim');
      expect(res.scoping.unscopedSections).toContain('summary.totalAiCostUsd');

      expect(repo.getQualityOverall).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'acme',
      );
      // ...and the unscopable one is NOT given a tenant to pretend with.
      expect(repo.getAiUsageByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
      );
    });
  });

  describe('minimum org group size', () => {
    it('passes through named orgs and the aggregated below-floor tail', async () => {
      repo.getTopOrgsByCompletedSims.mockResolvedValue({
        rows: [
          { tenantId: 't1', tenantName: 'Big Org', completedSimulations: 40 },
        ],
        belowFloor: { orgs: 6, sims: 11 },
      });

      const res = await service.getHighlights({ range: '30d' });

      expect(res.topOrgs).toEqual([
        { tenantId: 't1', tenantName: 'Big Org', completedSimulations: 40 },
      ]);
      expect(res.topOrgsBelowFloor).toEqual({
        orgs: 6,
        completedSimulations: 11,
      });
    });
  });

  describe('unpriced-call honesty', () => {
    it('totals unpriced calls into the summary so the cost can be caveated', async () => {
      repo.getAiUsageByBucket.mockResolvedValue([
        usageRow({ bucket: '2024-06-10', model: 'unpriced-model', calls: 7 }),
        usageRow({ bucket: '2024-06-11', model: 'unpriced-model', calls: 3 }),
        usageRow({ bucket: '2024-06-11' }),
      ]);

      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.unpricedCalls).toBe(10);
      expect(res.summary.totalAiCostUsd).toBe(10);
    });
  });

  describe('sparse average series', () => {
    it('passes quality/CSAT trends through un-gap-filled', async () => {
      repo.getQualityTrendByBucket.mockResolvedValue([
        { bucket: '2024-06-01', avgCompositeScore: 82.5, evaluatedSessions: 4 },
      ]);
      repo.getCsatTrendByBucket.mockResolvedValue([
        { bucket: '2024-06-02', avgRating: 4.25, responses: 8 },
      ]);

      const res = await service.getHighlights({ range: '30d' });

      expect(res.qualityTrend).toEqual([
        { bucket: '2024-06-01', avgCompositeScore: 82.5, evaluatedSessions: 4 },
      ]);
      expect(res.csatTrend).toEqual([
        { bucket: '2024-06-02', avgRating: 4.25, responses: 8 },
      ]);
    });

    it('puts session length on the full axis, gap-filled with nulls not zeros', async () => {
      repo.getPlayTimeByBucket.mockResolvedValue([
        {
          bucket: '2024-06-03',
          avgMinutes: 14.2,
          medianMinutes: 11.5,
          p95Minutes: 38.4,
          sessions: 17,
        },
      ]);

      const res = await service.getHighlights({ range: '30d' });

      // The axis stays a real calendar: 30 days, not the 1 day that happened
      // to have sessions.
      expect(res.playTime).toHaveLength(30);
      expect(res.playTime.find((p) => p.bucket === '2024-06-03')).toEqual({
        bucket: '2024-06-03',
        avgMinutes: 14.2,
        medianMinutes: 11.5,
        p95Minutes: 38.4,
        sessions: 17,
      });

      const quiet = res.playTime.filter((p) => p.bucket !== '2024-06-03');
      // Null, never 0 — a zero would read as "sessions collapsed to nothing".
      expect(
        quiet.every(
          (p) =>
            p.avgMinutes === null &&
            p.medianMinutes === null &&
            p.p95Minutes === null,
        ),
      ).toBe(true);
      // But the COUNT gap-fills to zero: "nobody practised" is a fact.
      expect(quiet.every((p) => p.sessions === 0)).toBe(true);
    });
  });

  describe('mean session length KPI', () => {
    it('takes the exact whole-window mean, not a mean of the buckets', async () => {
      // Buckets that would average to 20 if re-averaged; the exact figure is 9.
      repo.getPlayTimeByBucket.mockResolvedValue([
        {
          bucket: '2024-06-01',
          avgMinutes: 30,
          medianMinutes: 30,
          p95Minutes: 30,
          sessions: 1,
        },
        {
          bucket: '2024-06-02',
          avgMinutes: 10,
          medianMinutes: 10,
          p95Minutes: 10,
          sessions: 99,
        },
      ]);
      repo.getPlayTimeOverall.mockResolvedValue({
        avgMinutes: 9,
        sessions: 100,
      });

      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.avgPlayTimeMinutes).toBe(9);
      expect(res.summary.playTimeSessions).toBe(100);
    });

    it('reports null rather than zero when nothing was timed', async () => {
      const res = await service.getHighlights({ range: '30d' });

      expect(res.summary.avgPlayTimeMinutes).toBeNull();
      expect(res.summary.playTimeSessions).toBe(0);
    });

    it('computes the comparison window mean too', async () => {
      repo.getPlayTimeOverall
        .mockResolvedValueOnce({ avgMinutes: 14, sessions: 40 })
        .mockResolvedValueOnce({ avgMinutes: 11, sessions: 31 });

      const res = await service.getHighlights({
        range: '30d',
        compare: 'prev',
      });

      expect(res.summary.avgPlayTimeMinutes).toBe(14);
      expect(res.previous?.avgPlayTimeMinutes).toBe(11);
      expect(res.previousLabel).toBeTruthy();
    });

    it('scopes both the trend and the KPI to a tenant filter', async () => {
      await service.getHighlights({ range: '30d', tenantId: 'ally' });

      expect(repo.getPlayTimeByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
        'ally',
      );
      expect(repo.getPlayTimeOverall).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'ally',
      );
    });

    it('does not flag session length as unscoped — sessions carry a tenant', async () => {
      const res = await service.getHighlights({
        range: '30d',
        tenantId: 'ally',
      });

      expect(res.scoping.unscopedSections).not.toContain('playTime');
      expect(res.scoping.unscopedSections).not.toContain(
        'summary.avgPlayTimeMinutes',
      );
    });
  });
});
