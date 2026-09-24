import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChartPreferenceService } from '../chart-preference.service';
import { AnalyticsChartPreference } from '../../entity/analytics-chart-preference.entity';

describe('ChartPreferenceService', () => {
  let service: ChartPreferenceService;
  let repo: { find: jest.Mock; createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartPreferenceService,
        {
          provide: getRepositoryToken(AnalyticsChartPreference),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<ChartPreferenceService>(ChartPreferenceService);
  });

  describe('getForUser', () => {
    it('passes through a stored "allTime" grain', async () => {
      repo.find.mockResolvedValueOnce([
        { chartId: 'goals.xp', range: 'all', bucket: 'allTime' },
      ]);

      const result = await service.getForUser(1);

      expect(result.preferences).toEqual([
        { chartId: 'goals.xp', range: 'all', bucket: 'allTime' },
      ]);
    });

    it('still passes through ordinary bucket grains', async () => {
      repo.find.mockResolvedValueOnce([
        { chartId: 'highlights.practice', range: '90d', bucket: 'quarter' },
      ]);

      const result = await service.getForUser(1);

      expect(result.preferences).toEqual([
        { chartId: 'highlights.practice', range: '90d', bucket: 'quarter' },
      ]);
    });

    it('drops a bucket value retired from the live grain list, falling back to null', async () => {
      repo.find.mockResolvedValueOnce([
        { chartId: 'highlights.practice', range: '90d', bucket: 'fortnight' },
      ]);

      const result = await service.getForUser(1);

      expect(result.preferences).toEqual([
        { chartId: 'highlights.practice', range: '90d', bucket: null },
      ]);
    });

    it('drops a row whose range and bucket are both unrecognised', async () => {
      repo.find.mockResolvedValueOnce([
        { chartId: 'stale.chart', range: 'decade', bucket: 'fortnight' },
      ]);

      const result = await service.getForUser(1);

      expect(result.preferences).toEqual([]);
    });
  });

  describe('saveForUser', () => {
    it('upserts an "allTime" grain the same way as any other bucket value', async () => {
      const execute = jest.fn().mockResolvedValue(undefined);
      const orUpdate = jest.fn().mockReturnValue({ execute });
      const values = jest.fn().mockReturnValue({ orUpdate });
      const into = jest.fn().mockReturnValue({ values });
      const insert = jest.fn().mockReturnValue({ into });
      repo.createQueryBuilder.mockReturnValue({ insert });
      repo.find.mockResolvedValueOnce([
        { chartId: 'goals.xp', range: 'all', bucket: 'allTime' },
      ]);

      await service.saveForUser(7, {
        preferences: [{ chartId: 'goals.xp', range: 'all', bucket: 'allTime' }],
      });

      expect(values).toHaveBeenCalledWith([
        { userId: 7, chartId: 'goals.xp', range: 'all', bucket: 'allTime' },
      ]);
      expect(orUpdate).toHaveBeenCalledWith(
        ['range', 'bucket'],
        ['userId', 'chartId'],
      );
    });
  });
});
