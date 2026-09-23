import { Test, TestingModule } from '@nestjs/testing';

import { ActiveUsersXpAnalyticsService } from '../active-users-xp-analytics.service';
import { ActiveUsersXpAnalyticsRepository } from '../../repository/active-users-xp-analytics.repository';

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z. The endpoint defaults to
 * range=90d in weekly buckets, which is exercised in most tests below; a
 * couple of tests switch range to check the all-time / data-floor path.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');

describe('ActiveUsersXpAnalyticsService', () => {
  let service: ActiveUsersXpAnalyticsService;
  let repo: jest.Mocked<ActiveUsersXpAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<ActiveUsersXpAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getActiveUsersByBucket: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActiveUsersXpAnalyticsService,
        { provide: ActiveUsersXpAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(ActiveUsersXpAnalyticsService);
    repo = module.get(ActiveUsersXpAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to 90d in weekly buckets', async () => {
      const res = await service.getActiveUsers({});

      expect(repo.getDataFloor).not.toHaveBeenCalled();
      expect(res.window.bucket).toBe('week');
      expect(res.window.allTime).toBe(false);
    });

    it('measures the data floor only for an unbounded all-time range', async () => {
      await service.getActiveUsers({ range: 'all' });
      expect(repo.getDataFloor).toHaveBeenCalled();
    });

    it('defaults an all-time range to monthly buckets', async () => {
      const res = await service.getActiveUsers({ range: 'all' });
      expect(res.window.bucket).toBe('month');
    });

    it('passes the requested grain through to the repository', async () => {
      await service.getActiveUsers({ range: '30d', bucket: 'day' });

      expect(repo.getActiveUsersByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
      );
    });

    it('measures the data floor for an all-time range bounded by a `from` date', async () => {
      await expect(
        service.getActiveUsers({
          range: 'all',
          from: '2024-05-01',
        }),
      ).resolves.not.toThrow();

      expect(repo.getDataFloor).toHaveBeenCalled();
    });
  });

  describe('points', () => {
    it('reports the repository counts by bucket', async () => {
      // Both dates fall inside the 30d window ending 2024-06-12.
      repo.getActiveUsersByBucket.mockResolvedValue([
        { bucket: '2024-05-20', activeUsers: 12 },
        { bucket: '2024-06-03', activeUsers: 20 },
      ]);

      const res = await service.getActiveUsers({
        range: '30d',
        bucket: 'week',
      });

      const withData = res.points.filter((p) => p.activeUsers > 0);
      expect(withData).toEqual([
        { bucket: '2024-05-20', activeUsers: 12 },
        { bucket: '2024-06-03', activeUsers: 20 },
      ]);
    });

    it('gap-fills a bucket where nobody cleared the threshold with a real zero', async () => {
      repo.getActiveUsersByBucket.mockResolvedValue([
        { bucket: '2024-05-13', activeUsers: 7 },
      ]);

      const res = await service.getActiveUsers({
        range: '30d',
        bucket: 'week',
      });

      // 30d as-of the fixed "now" spans several weekly buckets; every bucket
      // not returned by the repository must still appear, with a zero.
      expect(res.points.length).toBeGreaterThan(1);
      expect(res.points.every((p) => Number.isInteger(p.activeUsers))).toBe(
        true,
      );
      const zeroBuckets = res.points.filter((p) => p.activeUsers === 0);
      expect(zeroBuckets.length).toBeGreaterThan(0);
    });

    it('does not reorder the axis when repository rows arrive out of order', async () => {
      repo.getActiveUsersByBucket.mockResolvedValue([
        { bucket: '2024-05-20', activeUsers: 3 },
        { bucket: '2024-04-15', activeUsers: 9 },
      ]);

      const res = await service.getActiveUsers({
        range: '90d',
        bucket: 'week',
      });
      const buckets = res.points.map((p) => p.bucket);
      const sorted = [...buckets].sort();
      expect(buckets).toEqual(sorted);
    });
  });

  describe('scoping', () => {
    it('is always platform-wide — this chart has no tenant filter', async () => {
      const res = await service.getActiveUsers({});
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
