import { Test, TestingModule } from '@nestjs/testing';
import { CoachingLoopAnalyticsService } from '../coaching-loop-analytics.service';
import {
  CoachingLoopAnalyticsRepository,
  CoachingLoopCompletedRow,
  CoachingLoopReviewRow,
  MIN_COACHING_SAMPLE_SIZE,
} from '../../repository/coaching-loop-analytics.repository';

// Fixed "now" = 2024-06-12T12:00:00Z. range='30d' -> a daily axis over
// 2024-05-14 .. 2024-06-12 (30 buckets), endExclusive 2024-06-13.
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const emptyTotals: CoachingLoopReviewRow = {
  bucket: '',
  sharedSessions: 0,
  reviewsWithComment: 0,
  comments: 0,
  medianHoursToFirstComment: null,
  p90HoursToFirstComment: null,
};

describe('CoachingLoopAnalyticsService', () => {
  let service: CoachingLoopAnalyticsService;
  let repository: jest.Mocked<CoachingLoopAnalyticsRepository>;

  const setup = async (opts?: {
    reviews?: CoachingLoopReviewRow[];
    completed?: CoachingLoopCompletedRow[];
    totals?: CoachingLoopReviewRow;
    dataFloor?: Date;
  }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachingLoopAnalyticsService,
        {
          provide: CoachingLoopAnalyticsRepository,
          useValue: {
            getDataFloor: jest
              .fn()
              .mockResolvedValue(
                opts?.dataFloor ?? new Date('2024-01-01T00:00:00.000Z'),
              ),
            getReviewsByBucket: jest
              .fn()
              .mockResolvedValue(opts?.reviews ?? []),
            getCompletedSessionsByBucket: jest
              .fn()
              .mockResolvedValue(opts?.completed ?? []),
            getReviewTotals: jest
              .fn()
              .mockResolvedValue(opts?.totals ?? emptyTotals),
          },
        },
      ],
    }).compile();

    service = module.get(CoachingLoopAnalyticsService);
    repository = module.get(CoachingLoopAnalyticsRepository);
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(FIXED_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('defaults to an all-time monthly window and measures the data floor to get it', async () => {
    await setup({ dataFloor: new Date('2024-03-01T00:00:00.000Z') });

    const result = await service.getCoachingLoop({});

    expect(repository.getDataFloor).toHaveBeenCalled();
    expect(result.window.allTime).toBe(true);
    expect(result.window.bucket).toBe('month');
    expect(result.window.from).toBe('2024-03-01');
    // 4 months: March .. June, gap-filled.
    expect(result.points.map((p) => p.bucket)).toEqual([
      '2024-03-01',
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
    expect(result.minSampleSize).toBe(MIN_COACHING_SAMPLE_SIZE);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('does not measure the data floor for an explicit bounded range', async () => {
    await setup();

    const result = await service.getCoachingLoop({ range: '30d' });

    expect(repository.getDataFloor).not.toHaveBeenCalled();
    expect(result.points).toHaveLength(30);
    expect(result.points[0].bucket).toBe('2024-05-14');
    expect(result.points[29].bucket).toBe('2024-06-12');
  });

  it('gap-fills the counts with real zeros across a contiguous axis', async () => {
    await setup({
      reviews: [
        {
          bucket: '2024-06-10',
          sharedSessions: 3,
          reviewsWithComment: 2,
          comments: 5,
          medianHoursToFirstComment: 4.5,
          p90HoursToFirstComment: 30,
        },
      ],
      completed: [{ bucket: '2024-06-10', completedSessions: 12 }],
    });

    const result = await service.getCoachingLoop({ range: '30d' });

    const quiet = result.points.find((p) => p.bucket === '2024-06-11')!;
    // "Nobody shared a session that day" is a fact, so counts are zero-filled…
    expect(quiet.sharedSessions).toBe(0);
    expect(quiet.completedSessions).toBe(0);
    expect(quiet.comments).toBe(0);
    // …and every derived figure over that zero denominator stays null.
    expect(quiet.sharePct).toBeNull();
    expect(quiet.medianHoursToFirstComment).toBeNull();
    expect(quiet.p90HoursToFirstComment).toBeNull();

    const busy = result.points.find((p) => p.bucket === '2024-06-10')!;
    expect(busy.sharedSessions).toBe(3);
    expect(busy.completedSessions).toBe(12);
    expect(busy.sharePct).toBe(25);
  });

  it('suppresses the turnaround percentiles below the sample floor, keeping the counts', async () => {
    await setup({
      reviews: [
        {
          bucket: '2024-06-10',
          sharedSessions: 6,
          reviewsWithComment: MIN_COACHING_SAMPLE_SIZE - 1,
          comments: 9,
          medianHoursToFirstComment: 2.5,
          p90HoursToFirstComment: 11,
        },
        {
          bucket: '2024-06-11',
          sharedSessions: 8,
          reviewsWithComment: MIN_COACHING_SAMPLE_SIZE,
          comments: 14,
          medianHoursToFirstComment: 6.25,
          p90HoursToFirstComment: 48,
        },
      ],
      completed: [
        { bucket: '2024-06-10', completedSessions: 24 },
        { bucket: '2024-06-11', completedSessions: 16 },
      ],
    });

    const result = await service.getCoachingLoop({ range: '30d' });

    const below = result.points.find((p) => p.bucket === '2024-06-10')!;
    // A median turnaround over four reviews is noise that reads as a measurement.
    expect(below.medianHoursToFirstComment).toBeNull();
    expect(below.p90HoursToFirstComment).toBeNull();
    // The counts and the share are unaffected — only the percentiles go.
    expect(below.reviewsWithComment).toBe(MIN_COACHING_SAMPLE_SIZE - 1);
    expect(below.comments).toBe(9);
    expect(below.sharePct).toBe(25);

    const atFloor = result.points.find((p) => p.bucket === '2024-06-11')!;
    expect(atFloor.medianHoursToFirstComment).toBe(6.25);
    expect(atFloor.p90HoursToFirstComment).toBe(48);
  });

  it('sums the completions from the trend and re-queries the window percentiles', async () => {
    await setup({
      completed: [
        { bucket: '2024-06-10', completedSessions: 20 },
        { bucket: '2024-06-11', completedSessions: 30 },
      ],
      totals: {
        bucket: '',
        sharedSessions: 10,
        reviewsWithComment: 8,
        comments: 21,
        medianHoursToFirstComment: 5,
        p90HoursToFirstComment: 72,
      },
    });

    const result = await service.getCoachingLoop({ range: '30d' });

    expect(result.summary.completedSessions).toBe(50);
    expect(result.summary.sharedSessions).toBe(10);
    expect(result.summary.sharePct).toBe(20);
    expect(result.summary.respondedPct).toBe(80);
    // Percentiles come from the whole-window pass, not from the buckets: a median
    // of per-bucket medians weights a quiet day like a busy one.
    expect(result.summary.medianHoursToFirstComment).toBe(5);
    expect(result.summary.p90HoursToFirstComment).toBe(72);
  });

  it('keeps every summary rate null when nothing was shared or completed', async () => {
    await setup();

    const result = await service.getCoachingLoop({ range: '30d' });

    expect(result.summary.completedSessions).toBe(0);
    expect(result.summary.sharePct).toBeNull();
    expect(result.summary.respondedPct).toBeNull();
    expect(result.summary.medianHoursToFirstComment).toBeNull();
    expect(result.summary.p90HoursToFirstComment).toBeNull();
  });

  it('suppresses the summary percentiles below the sample floor', async () => {
    await setup({
      totals: {
        bucket: '',
        sharedSessions: 4,
        reviewsWithComment: MIN_COACHING_SAMPLE_SIZE - 1,
        comments: 6,
        medianHoursToFirstComment: 3,
        p90HoursToFirstComment: 9,
      },
    });

    const result = await service.getCoachingLoop({ range: '30d' });

    expect(result.summary.reviewsWithComment).toBe(
      MIN_COACHING_SAMPLE_SIZE - 1,
    );
    expect(result.summary.respondedPct).toBe(100);
    expect(result.summary.medianHoursToFirstComment).toBeNull();
    expect(result.summary.p90HoursToFirstComment).toBeNull();
  });

  it('passes a trimmed tenant filter to every query and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getCoachingLoop({
      range: '30d',
      tenantId: '  ally  ',
    });

    expect(repository.getReviewsByBucket).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'day',
      'ally',
    );
    expect(repository.getCompletedSessionsByBucket).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'day',
      'ally',
    );
    expect(repository.getReviewTotals).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });
});
