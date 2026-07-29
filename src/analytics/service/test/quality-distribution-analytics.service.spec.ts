import { Test, TestingModule } from '@nestjs/testing';

import { QualityDistributionAnalyticsService } from '../quality-distribution-analytics.service';
import {
  MIN_SCORE_SAMPLE_SIZE,
  QualityDistributionAnalyticsRepository,
} from '../../repository/quality-distribution-analytics.repository';

/**
 * Fixed "now" = 2024-06-12T12:00:00Z with a data floor of 2024-04-01. The default
 * range is `all`, so the window is [2024-04-01, 2024-06-13) at MONTH grain and the
 * contiguous axis is exactly three buckets:
 *   2024-04-01, 2024-05-01, 2024-06-01
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-01T00:00:00.000Z');
const MONTHLY_AXIS = ['2024-04-01', '2024-05-01', '2024-06-01'];

describe('QualityDistributionAnalyticsService', () => {
  let service: QualityDistributionAnalyticsService;
  let repo: jest.Mocked<QualityDistributionAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<
      jest.Mocked<QualityDistributionAnalyticsRepository>
    > = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getQualityByBucket: jest.fn().mockResolvedValue([]),
      getQualityOverall: jest.fn().mockResolvedValue({
        median: null,
        p25: null,
        p75: null,
        evaluatedSessions: 0,
      }),
      getSatisfactionByBucket: jest.fn().mockResolvedValue([]),
      getSatisfactionOverall: jest
        .fn()
        .mockResolvedValue({ low: 0, mid: 0, high: 0, responses: 0 }),
      getCompletedSessionsByBucket: jest.fn().mockResolvedValue([]),
      getCompletedSessionsOverall: jest.fn().mockResolvedValue(0),
      getLowRatingTags: jest
        .fn()
        .mockResolvedValue({ tags: [], taggedResponses: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityDistributionAnalyticsService,
        {
          provide: QualityDistributionAnalyticsRepository,
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get(QualityDistributionAnalyticsService);
    repo = module.get(QualityDistributionAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('defaults to an all-time monthly window measured from the data floor', async () => {
    const result = await service.getQualityDistribution({});

    expect(repo.getDataFloor).toHaveBeenCalled();
    expect(result.window.from).toBe('2024-04-01');
    expect(result.window.to).toBe('2024-06-12');
    expect(result.window.bucket).toBe('month');
    expect(result.window.allTime).toBe(true);
    expect(result.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(result.scoreDomain).toEqual([0, 100]);
    expect(result.ratingDomain).toEqual([1, 5]);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('leaves the quality series SPARSE — an empty bucket is absent, never zero', async () => {
    repo.getQualityByBucket.mockResolvedValue([
      {
        bucket: '2024-04-01',
        median: 61,
        p25: 52,
        p75: 70,
        evaluatedSessions: 40,
      },
      {
        bucket: '2024-06-01',
        median: 66,
        p25: 58,
        p75: 74,
        evaluatedSessions: 35,
      },
    ]);

    const result = await service.getQualityDistribution({});

    // May is missing from the data and must stay missing: a percentile has no
    // meaningful zero, and a 0 on a 0-100 score axis reads as a collapse.
    expect(result.quality.map((q) => q.bucket)).toEqual([
      '2024-04-01',
      '2024-06-01',
    ]);
    expect(result.quality[0].median).toBe(61);
  });

  it('nulls the percentiles of a thin bucket and keeps the session count', async () => {
    repo.getQualityByBucket.mockResolvedValue([
      {
        bucket: '2024-06-01',
        median: 88,
        p25: 80,
        p75: 95,
        evaluatedSessions: MIN_SCORE_SAMPLE_SIZE - 1,
      },
    ]);

    const result = await service.getQualityDistribution({});

    expect(result.quality[0].median).toBeNull();
    expect(result.quality[0].p25).toBeNull();
    expect(result.quality[0].p75).toBeNull();
    expect(result.quality[0].evaluatedSessions).toBe(MIN_SCORE_SAMPLE_SIZE - 1);
  });

  it('GAP-FILLS the satisfaction counts to a contiguous axis', async () => {
    repo.getSatisfactionByBucket.mockResolvedValue([
      { bucket: '2024-06-01', low: 2, mid: 3, high: 15, responses: 20 },
    ]);
    repo.getCompletedSessionsByBucket.mockResolvedValue([
      { bucket: '2024-05-01', completedSessions: 30 },
      { bucket: '2024-06-01', completedSessions: 50 },
    ]);

    const result = await service.getQualityDistribution({});

    expect(result.satisfaction.map((s) => s.bucket)).toEqual(MONTHLY_AXIS);
    // A month with no ratings is a real zero for a COUNT.
    expect(result.satisfaction[0]).toEqual({
      bucket: '2024-04-01',
      low: 0,
      mid: 0,
      high: 0,
      responses: 0,
      top2BoxPct: null,
      completedSessions: 0,
      responseRatePct: null,
    });
    // ...but every share over a zero denominator stays null: 0/0 is not 0%, and
    // "nobody was asked" is not "nobody was satisfied".
    expect(result.satisfaction[1].responses).toBe(0);
    expect(result.satisfaction[1].top2BoxPct).toBeNull();
    expect(result.satisfaction[1].completedSessions).toBe(30);
    expect(result.satisfaction[1].responseRatePct).toBe(0);
    // The populated bucket carries both derived shares.
    expect(result.satisfaction[2].top2BoxPct).toBe(75);
    expect(result.satisfaction[2].responseRatePct).toBe(40);
  });

  it('does not clamp a response rate above 100% (the bucket-boundary artefact)', async () => {
    // A session that ends at 23:58 and is rated at 00:02 lands in two different
    // buckets. Clamping would hide a boundary effect behind an exact-looking
    // number; the honest fix is a coarser bucket, which the reader can pick.
    repo.getSatisfactionByBucket.mockResolvedValue([
      { bucket: '2024-06-01', low: 0, mid: 0, high: 3, responses: 3 },
    ]);
    repo.getCompletedSessionsByBucket.mockResolvedValue([
      { bucket: '2024-06-01', completedSessions: 2 },
    ]);

    const result = await service.getQualityDistribution({});

    expect(result.satisfaction[2].responseRatePct).toBe(150);
  });

  it('pools the tag tail into one "Other" row so the parts still sum', async () => {
    const tags = [
      { tag: 't1', count: 40 },
      { tag: 't2', count: 30 },
      { tag: 't3', count: 20 },
      { tag: 't4', count: 15 },
      { tag: 't5', count: 12 },
      { tag: 't6', count: 9 },
      { tag: 't7', count: 7 },
      { tag: 't8', count: 5 },
      { tag: 't9', count: 3 },
      { tag: 't10', count: 2 },
      { tag: 't11', count: 1 },
    ];
    repo.getLowRatingTags.mockResolvedValue({ tags, taggedResponses: 90 });

    const result = await service.getQualityDistribution({});

    expect(result.lowRatingTags).toHaveLength(9);
    expect(result.lowRatingTags.slice(0, 8).map((t) => t.tag)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
    ]);
    expect(result.lowRatingTags[8]).toEqual({ tag: 'Other', count: 6 });
    // The pareto's own denominator travels with it.
    expect(result.summary.taggedLowRatings).toBe(90);
  });

  it('emits no "Other" row when the tail is empty', async () => {
    repo.getLowRatingTags.mockResolvedValue({
      tags: [
        { tag: 't1', count: 4 },
        { tag: 't2', count: 2 },
      ],
      taggedResponses: 6,
    });

    const result = await service.getQualityDistribution({});

    expect(result.lowRatingTags.map((t) => t.tag)).toEqual(['t1', 't2']);
  });

  it('applies the floor to the summary too, and nulls shares over zero denominators', async () => {
    repo.getQualityOverall.mockResolvedValue({
      median: 74,
      p25: 66,
      p75: 82,
      evaluatedSessions: MIN_SCORE_SAMPLE_SIZE - 1,
    });

    const result = await service.getQualityDistribution({});

    expect(result.summary.medianScore).toBeNull();
    expect(result.summary.p25).toBeNull();
    expect(result.summary.p75).toBeNull();
    expect(result.summary.evaluatedSessions).toBe(MIN_SCORE_SAMPLE_SIZE - 1);
    // No responses and no completed sessions in the default mocks.
    expect(result.summary.top2BoxPct).toBeNull();
    expect(result.summary.responseRatePct).toBeNull();
  });

  it('reports the summary shares once the denominators exist', async () => {
    repo.getQualityOverall.mockResolvedValue({
      median: 70,
      p25: 60,
      p75: 80,
      evaluatedSessions: 200,
    });
    repo.getSatisfactionOverall.mockResolvedValue({
      low: 10,
      mid: 10,
      high: 80,
      responses: 100,
    });
    repo.getCompletedSessionsOverall.mockResolvedValue(400);

    const result = await service.getQualityDistribution({});

    expect(result.summary.medianScore).toBe(70);
    expect(result.summary.top2BoxPct).toBe(80);
    expect(result.summary.responseRatePct).toBe(25);
    expect(result.summary.completedSessions).toBe(400);
  });

  it('passes a trimmed tenant filter to every query and echoes it', async () => {
    const result = await service.getQualityDistribution({ tenantId: ' ally ' });

    expect(repo.getQualityByBucket).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'month',
      'ally',
    );
    expect(repo.getLowRatingTags).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });

  it('does not measure the data floor for an explicit range', async () => {
    const result = await service.getQualityDistribution({ range: '30d' });

    expect(repo.getDataFloor).not.toHaveBeenCalled();
    expect(result.window.from).toBe('2024-05-14');
    // 30 days on a weekly axis, not a daily one: a percentile needs a sample per
    // bucket, and a daily axis would suppress nearly every cell.
    expect(result.window.bucket).toBe('week');
  });
});
