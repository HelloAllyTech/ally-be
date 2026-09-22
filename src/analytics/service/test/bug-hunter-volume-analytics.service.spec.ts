import { Test, TestingModule } from '@nestjs/testing';

import { BugHunterVolumeAnalyticsService } from '../bug-hunter-volume-analytics.service';
import { BugHunterVolumeAnalyticsRepository } from '../../repository/bug-hunter-volume-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');

describe('BugHunterVolumeAnalyticsService', () => {
  let service: BugHunterVolumeAnalyticsService;
  let repo: jest.Mocked<BugHunterVolumeAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<BugHunterVolumeAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getFoundByBucket: jest.fn().mockResolvedValue([]),
      getFixedByBucket: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterVolumeAnalyticsService,
        { provide: BugHunterVolumeAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(BugHunterVolumeAnalyticsService);
    repo = module.get(BugHunterVolumeAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to 90d in weekly buckets', async () => {
      const res = await service.getVolume({});
      expect(res.window.bucket).toBe('week');
      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });

    it('measures its own data floor only for an unbounded all-time range', async () => {
      await service.getVolume({ range: 'all' });
      expect(repo.getDataFloor).toHaveBeenCalled();
    });

    it('queries found and fixed over the same resolved window', async () => {
      await service.getVolume({ range: '30d', bucket: 'day' });

      expect(repo.getFoundByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
      );
      expect(repo.getFixedByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'day',
      );
    });
  });

  describe('points', () => {
    it('merges found and fixed onto a shared bucket axis', async () => {
      repo.getFoundByBucket.mockResolvedValue([
        { bucket: '2024-05-13', count: 5 },
      ]);
      repo.getFixedByBucket.mockResolvedValue([
        { bucket: '2024-05-20', count: 3 },
      ]);

      const res = await service.getVolume({ range: '30d', bucket: 'week' });

      const found = res.points.find((p) => p.bucket === '2024-05-13');
      const fixed = res.points.find((p) => p.bucket === '2024-05-20');
      expect(found).toMatchObject({ found: 5, fixed: 0 });
      expect(fixed).toMatchObject({ found: 0, fixed: 3 });
    });

    it('gap-fills a bucket with neither a find nor a fix with real zeros', async () => {
      const res = await service.getVolume({ range: '30d', bucket: 'week' });

      expect(res.points.length).toBeGreaterThan(0);
      expect(res.points.every((p) => p.found === 0 && p.fixed === 0)).toBe(
        true,
      );
    });

    it('a bucket can carry both a find and a fix independently', async () => {
      repo.getFoundByBucket.mockResolvedValue([
        { bucket: '2024-05-20', count: 7 },
      ]);
      repo.getFixedByBucket.mockResolvedValue([
        { bucket: '2024-05-20', count: 2 },
      ]);

      const res = await service.getVolume({ range: '30d', bucket: 'week' });
      const point = res.points.find((p) => p.bucket === '2024-05-20');

      expect(point).toMatchObject({ found: 7, fixed: 2 });
    });
  });

  describe('scoping', () => {
    it('is always the fixed internal-data scoping — bug_findings has no tenant', async () => {
      const res = await service.getVolume({});
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
