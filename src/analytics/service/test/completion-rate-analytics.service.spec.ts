import { Test, TestingModule } from '@nestjs/testing';
import { CompletionRateAnalyticsService } from '../completion-rate-analytics.service';
import { CompletionRateAnalyticsRepository } from '../../repository/completion-rate-analytics.repository';

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z, with a data floor of 2024-04-10.
 * For the endpoint's defaults (range='all', monthly buckets) that yields the axis
 * 2024-04-01 .. 2024-06-01, whose last bucket is the in-progress one.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');
const MONTHLY_AXIS = ['2024-04-01', '2024-05-01', '2024-06-01'];

describe('CompletionRateAnalyticsService', () => {
  let service: CompletionRateAnalyticsService;
  let repo: jest.Mocked<CompletionRateAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<CompletionRateAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getStartedVsCompletedByBucket: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletionRateAnalyticsService,
        { provide: CompletionRateAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(CompletionRateAnalyticsService);
    repo = module.get(CompletionRateAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to all-time in monthly buckets, measuring the data floor', async () => {
      const res = await service.getCompletionRate({});

      expect(repo.getDataFloor).toHaveBeenCalled();
      expect(res.window).toMatchObject({
        from: '2024-04-10',
        to: '2024-06-12',
        label: 'All time',
        bucket: 'month',
        allTime: true,
        inProgressBucket: '2024-06-01',
      });
      expect(res.points.map((p) => p.bucket)).toEqual(MONTHLY_AXIS);
    });

    it('does not measure the data floor for a bounded range', async () => {
      await service.getCompletionRate({ range: '90d' });

      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });

    it('passes the requested grain to the query', async () => {
      await service.getCompletionRate({ range: '30d', bucket: 'day' });

      expect(repo.getStartedVsCompletedByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
        undefined,
      );
    });
  });

  describe('points', () => {
    it('computes the rate and the abandoned residual per bucket', async () => {
      repo.getStartedVsCompletedByBucket.mockResolvedValue([
        { bucket: '2024-05-01', started: 200, completed: 150 },
      ]);

      const res = await service.getCompletionRate({});

      expect(res.points).toContainEqual({
        bucket: '2024-05-01',
        started: 200,
        completed: 150,
        abandoned: 50,
        completionRatePct: 75,
      });
    });

    it('gap-fills the axis with zero COUNTS and a NULL rate', async () => {
      repo.getStartedVsCompletedByBucket.mockResolvedValue([
        { bucket: '2024-05-01', started: 10, completed: 4 },
      ]);

      const res = await service.getCompletionRate({});

      expect(res.points).toHaveLength(MONTHLY_AXIS.length);
      // Zero launches is a fact about the month; 0% completion is not — a rate
      // over a zero denominator is undefined, and plotting it as zero would draw
      // a collapse that never happened.
      expect(res.points[0]).toEqual({
        bucket: '2024-04-01',
        started: 0,
        completed: 0,
        abandoned: 0,
        completionRatePct: null,
      });
    });

    it('clamps the abandoned residual at zero rather than inverting a segment', async () => {
      // A data anomaly: more completions than launches in the bucket.
      repo.getStartedVsCompletedByBucket.mockResolvedValue([
        { bucket: '2024-05-01', started: 5, completed: 8 },
      ]);

      const res = await service.getCompletionRate({});

      const may = res.points.find((p) => p.bucket === '2024-05-01');
      expect(may?.abandoned).toBe(0);
    });
  });

  describe('summary', () => {
    it('takes the rate over the summed counts, not the mean of the bucket rates', async () => {
      repo.getStartedVsCompletedByBucket.mockResolvedValue([
        // A quiet month at 100% and a busy month at 50%: the mean of the rates
        // would be 75%, which weights one launch the same as ninety.
        { bucket: '2024-04-01', started: 1, completed: 1 },
        { bucket: '2024-05-01', started: 99, completed: 49 },
      ]);

      const res = await service.getCompletionRate({});

      expect(res.summary).toEqual({
        started: 100,
        completed: 50,
        abandoned: 50,
        completionRatePct: 50,
      });
    });

    it('reports a null rate for an empty window', async () => {
      const res = await service.getCompletionRate({});

      expect(res.summary).toEqual({
        started: 0,
        completed: 0,
        abandoned: 0,
        completionRatePct: null,
      });
    });
  });

  describe('scoping', () => {
    it('passes a trimmed tenant filter through and echoes it', async () => {
      const res = await service.getCompletionRate({ tenantId: '  ally  ' });

      expect(repo.getStartedVsCompletedByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        'ally',
      );
      expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
    });

    it('treats a blank tenant filter as no filter', async () => {
      const res = await service.getCompletionRate({ tenantId: '   ' });

      expect(repo.getStartedVsCompletedByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        undefined,
      );
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
