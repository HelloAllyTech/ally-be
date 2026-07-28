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
      getTopOrgsByCompletedSims: jest.fn().mockResolvedValue([]),
      getPracticeMinutesByBucket: jest.fn().mockResolvedValue([]),
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

  describe('bucket axis + gap-fill', () => {
    it('30d defaults to a 30-label DAY axis (day branch, not weekly)', async () => {
      const res = await service.getHighlights('30d');

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

      const res = await service.getHighlights('30d');

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
      const res = await service.getHighlights('30d', 'week');

      expect(res.bucket).toBe('week');
      expect(res.practiceMinutes.map((p) => p.bucket)).toEqual(WEEKLY_AXIS);
    });

    it('12m produces a 12-label month axis', async () => {
      const res = await service.getHighlights('12m');

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

      const res = await service.getHighlights('30d');

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

      const res = await service.getHighlights('30d');

      expect(res.summary.totalAiCostUsd).toBe(10);
      expect(res.summary.costPerCompletedSimUsd).toBeNull();
    });
  });

  describe('summary ratios', () => {
    it('nulls funnel/quiz percentages on empty denominators', async () => {
      const res = await service.getHighlights('30d');

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

      const res = await service.getHighlights('30d');

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

  describe('sparse average series', () => {
    it('passes quality/CSAT trends through un-gap-filled', async () => {
      repo.getQualityTrendByBucket.mockResolvedValue([
        { bucket: '2024-06-01', avgCompositeScore: 82.5, evaluatedSessions: 4 },
      ]);
      repo.getCsatTrendByBucket.mockResolvedValue([
        { bucket: '2024-06-02', avgRating: 4.25, responses: 8 },
      ]);

      const res = await service.getHighlights('30d');

      expect(res.qualityTrend).toEqual([
        { bucket: '2024-06-01', avgCompositeScore: 82.5, evaluatedSessions: 4 },
      ]);
      expect(res.csatTrend).toEqual([
        { bucket: '2024-06-02', avgRating: 4.25, responses: 8 },
      ]);
    });
  });
});
