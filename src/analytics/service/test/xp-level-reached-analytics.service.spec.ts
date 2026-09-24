import { Test, TestingModule } from '@nestjs/testing';

import { XpLevelReachedAnalyticsService } from '../xp-level-reached-analytics.service';
import { XpLevelReachedAnalyticsRepository } from '../../repository/xp-level-reached-analytics.repository';
import { MAX_LEVEL } from 'src/progress/progress.constants';

/** Fixed "now" = Wednesday 2024-06-12T12:00:00Z. */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');

describe('XpLevelReachedAnalyticsService', () => {
  let service: XpLevelReachedAnalyticsService;
  let repo: jest.Mocked<XpLevelReachedAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<XpLevelReachedAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getLevelCrossings: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpLevelReachedAnalyticsService,
        { provide: XpLevelReachedAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(XpLevelReachedAnalyticsService);
    repo = module.get(XpLevelReachedAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to 90d in weekly buckets', async () => {
      const res = await service.getLevelsReached({});
      expect(res.window.bucket).toBe('week');
      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });

    it('measures the data floor only for an unbounded all-time range', async () => {
      await service.getLevelsReached({ range: 'all' });
      expect(repo.getDataFloor).toHaveBeenCalled();
    });

    it('measures the data floor for an all-time range even with a `from` date', async () => {
      await service.getLevelsReached({
        range: 'all',
        from: '2024-05-01',
      });
      expect(repo.getDataFloor).toHaveBeenCalled();
    });

    it('accepts a quarter bucket, which the shared window resolver does not natively list', async () => {
      const res = await service.getLevelsReached({
        range: '12m',
        bucket: 'quarter',
      });
      expect(res.window.bucket).toBe('quarter');
      expect(repo.getLevelCrossings).toHaveBeenCalledWith(
        expect.any(Date),
        'quarter',
      );
    });
  });

  describe('gap-filled axis', () => {
    it('includes every level 1..MAX_LEVEL on every bucket, even with no rows', async () => {
      const res = await service.getLevelsReached({
        range: '30d',
        bucket: 'week',
      });

      expect(res.points.length).toBeGreaterThan(0);
      for (const point of res.points) {
        expect(point.levelCounts).toHaveLength(MAX_LEVEL);
        expect(point.levelCounts.map((l) => l.level)).toEqual(
          Array.from({ length: MAX_LEVEL }, (_, i) => i + 1),
        );
        expect(point.levelCounts.every((l) => l.users === 0)).toBe(true);
      }
    });

    it('places a crossing on the right bucket and level, zero everywhere else', async () => {
      repo.getLevelCrossings.mockResolvedValue([
        { bucket: '2024-05-20', level: 3, users: 4 },
      ]);

      const res = await service.getLevelsReached({
        range: '90d',
        bucket: 'week',
      });
      const point = res.points.find((p) => p.bucket === '2024-05-20');

      expect(point).toBeDefined();
      const level3 = point!.levelCounts.find((l) => l.level === 3);
      expect(level3?.users).toBe(4);
      expect(
        point!.levelCounts
          .filter((l) => l.level !== 3)
          .every((l) => l.users === 0),
      ).toBe(true);
    });

    it('lets one bucket carry crossings on several levels at once — nested, never exclusive', async () => {
      repo.getLevelCrossings.mockResolvedValue([
        { bucket: '2024-05-20', level: 1, users: 2 },
        { bucket: '2024-05-20', level: 2, users: 2 },
        { bucket: '2024-05-20', level: 3, users: 2 },
      ]);

      const res = await service.getLevelsReached({
        range: '90d',
        bucket: 'week',
      });
      const point = res.points.find((p) => p.bucket === '2024-05-20')!;

      expect(point.levelCounts[0].users).toBe(2);
      expect(point.levelCounts[1].users).toBe(2);
      expect(point.levelCounts[2].users).toBe(2);
    });
  });

  describe('crossings before the window', () => {
    it('drops a crossing the repository returned from before window.start', async () => {
      // The repository is queried all-time-up-to-endExclusive, so it can (and
      // does, deliberately) return crossings that predate the requested window.
      repo.getLevelCrossings.mockResolvedValue([
        { bucket: '2024-01-01', level: 5, users: 9 },
      ]);

      const res = await service.getLevelsReached({
        range: '30d',
        bucket: 'week',
      });

      const anyLevel5 = res.points.some((p) =>
        p.levelCounts.some((l) => l.level === 5 && l.users > 0),
      );
      expect(anyLevel5).toBe(false);
    });
  });

  describe('scoping', () => {
    it('is always platform-wide — this chart has no tenant filter', async () => {
      const res = await service.getLevelsReached({});
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
