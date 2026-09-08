import { Test, TestingModule } from '@nestjs/testing';

import { XpGrowthAnalyticsService } from '../xp-growth-analytics.service';
import { XpGrowthAnalyticsRepository } from '../../repository/xp-growth-analytics.repository';

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z, with a data floor of 2024-04-10.
 * For the endpoint's defaults (range='all', monthly buckets) that yields the axis
 * 2024-04-01 .. 2024-06-01, whose last bucket is the in-progress one.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');
const MONTHLY_AXIS = ['2024-04-01', '2024-05-01', '2024-06-01'];

describe('XpGrowthAnalyticsService', () => {
  let service: XpGrowthAnalyticsService;
  let repo: jest.Mocked<XpGrowthAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<XpGrowthAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getXpByBucket: jest.fn().mockResolvedValue([]),
      getXpBefore: jest.fn().mockResolvedValue(0),
      getWindowTotals: jest.fn().mockResolvedValue({ xp: 0, earners: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpGrowthAnalyticsService,
        { provide: XpGrowthAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(XpGrowthAnalyticsService);
    repo = module.get(XpGrowthAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to all-time in monthly buckets, measuring the data floor', async () => {
      const res = await service.getXpGrowth({});

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
      await service.getXpGrowth({ range: '90d' });

      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });

    it('passes the requested grain and tenant through to the query', async () => {
      await service.getXpGrowth({
        range: '30d',
        bucket: 'day',
        tenantId: 'acme',
      });

      expect(repo.getXpByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
        'acme',
      );
    });

    it('supports every grain the chart control offers', async () => {
      for (const bucket of ['day', 'week', 'month', 'year'] as const) {
        const res = await service.getXpGrowth({ range: '12m', bucket });
        expect(res.window.bucket).toBe(bucket);
        expect(res.points.length).toBeGreaterThan(0);
      }
    });
  });

  describe('points', () => {
    it('accumulates a running total across the axis', async () => {
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-04-01', xpEarned: 100, earners: 4 },
        { bucket: '2024-05-01', xpEarned: 250, earners: 9 },
        { bucket: '2024-06-01', xpEarned: 50, earners: 2 },
      ]);

      const res = await service.getXpGrowth({});

      expect(res.points).toEqual([
        {
          bucket: '2024-04-01',
          xpEarned: 100,
          cumulativeXp: 100,
          earners: 4,
        },
        {
          bucket: '2024-05-01',
          xpEarned: 250,
          cumulativeXp: 350,
          earners: 9,
        },
        { bucket: '2024-06-01', xpEarned: 50, cumulativeXp: 400, earners: 2 },
      ]);
    });

    it('gap-fills an empty bucket with a real zero and carries the total forward', async () => {
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-04-01', xpEarned: 120, earners: 3 },
      ]);

      const res = await service.getXpGrowth({});

      // A cumulative total cannot fall: the empty months hold the line.
      expect(res.points.map((p) => p.xpEarned)).toEqual([120, 0, 0]);
      expect(res.points.map((p) => p.cumulativeXp)).toEqual([120, 120, 120]);
      expect(res.points.map((p) => p.earners)).toEqual([3, 0, 0]);
    });

    it('is monotonic in cumulativeXp for any bucket ordering from the repository', async () => {
      // Rows arriving out of order must not reorder the axis or the running sum.
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-06-01', xpEarned: 5, earners: 1 },
        { bucket: '2024-04-01', xpEarned: 10, earners: 1 },
      ]);

      const res = await service.getXpGrowth({});

      expect(res.points.map((p) => p.bucket)).toEqual(MONTHLY_AXIS);
      expect(res.points.map((p) => p.cumulativeXp)).toEqual([10, 10, 15]);
    });
  });

  describe('baseline', () => {
    it('measures the baseline even for an all-time window', async () => {
      // The all-time window starts at the PLATFORM data floor (first user or
      // session), not at the first award, so XP can predate it. Assuming zero
      // here would drop that XP from the chart and from the lifetime total.
      repo.getXpBefore.mockResolvedValue(32_110);
      repo.getWindowTotals.mockResolvedValue({ xp: 3_295, earners: 12 });
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-05-01', xpEarned: 3_295, earners: 12 },
      ]);

      const res = await service.getXpGrowth({});

      expect(repo.getXpBefore).toHaveBeenCalled();
      expect(res.summary).toEqual({
        baselineXp: 32_110,
        xpEarnedInWindow: 3_295,
        cumulativeXp: 35_405,
        earners: 12,
      });
      // Every point carries the pre-floor XP; none of it goes missing.
      expect(res.points[0].cumulativeXp).toBe(32_110);
      expect(res.points[res.points.length - 1].cumulativeXp).toBe(35_405);
    });

    it('opens the curve at the pre-window total for a narrowed window', async () => {
      repo.getXpBefore.mockResolvedValue(9_000);
      repo.getWindowTotals.mockResolvedValue({ xp: 1_000, earners: 12 });
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-06-01', xpEarned: 1_000, earners: 12 },
      ]);

      const res = await service.getXpGrowth({ range: '30d', bucket: 'month' });

      expect(repo.getXpBefore).toHaveBeenCalledWith(
        expect.any(Date),
        undefined,
      );
      // Lifetime, not since-the-window-opened.
      expect(res.points[res.points.length - 1].cumulativeXp).toBe(10_000);
      expect(res.summary).toEqual({
        baselineXp: 9_000,
        xpEarnedInWindow: 1_000,
        cumulativeXp: 10_000,
        earners: 12,
      });
    });
  });

  describe('summary', () => {
    it('takes distinct earners from the window aggregate, not the bucket sum', async () => {
      // The same 5 learners active in all three months: 5, not 15.
      repo.getXpByBucket.mockResolvedValue([
        { bucket: '2024-04-01', xpEarned: 10, earners: 5 },
        { bucket: '2024-05-01', xpEarned: 10, earners: 5 },
        { bucket: '2024-06-01', xpEarned: 10, earners: 5 },
      ]);
      repo.getWindowTotals.mockResolvedValue({ xp: 30, earners: 5 });

      const res = await service.getXpGrowth({});

      expect(res.summary.earners).toBe(5);
      expect(res.summary.xpEarnedInWindow).toBe(30);
    });
  });

  describe('scoping', () => {
    it('reports the tenant filter with nothing left platform-wide', async () => {
      const res = await service.getXpGrowth({ tenantId: 'acme' });

      expect(res.scoping).toEqual({ tenantId: 'acme', unscopedSections: [] });
    });

    it('normalises a blank tenant to no filter', async () => {
      const res = await service.getXpGrowth({ tenantId: '   ' });

      expect(res.scoping.tenantId).toBeNull();
      expect(repo.getXpByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        undefined,
      );
    });
  });
});
