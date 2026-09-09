import { Test, TestingModule } from '@nestjs/testing';

import { GoalsXpAnalyticsService } from '../goals-xp-analytics.service';
import { GoalsXpAnalyticsRepository } from '../../repository/goals-xp-analytics.repository';

/**
 * Fixed "now" = 2026-08-20 (mid Q3/August), with a data floor of 2026-06-10
 * (June, Q2). That yields:
 *   - month axis:   2026-06-01, 2026-07-01, 2026-08-01 (Aug in progress)
 *   - quarter axis: 2026-04-01 (Q2), 2026-07-01 (Q3, in progress)
 *   - year axis:    2026-01-01 (in progress)
 */
const FIXED_NOW = new Date('2026-08-20T12:00:00.000Z');
const DATA_FLOOR = new Date('2026-06-10T00:00:00.000Z');

describe('GoalsXpAnalyticsService', () => {
  let service: GoalsXpAnalyticsService;
  let repo: jest.Mocked<GoalsXpAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<GoalsXpAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getActualXpByPeriod: jest.fn().mockResolvedValue([]),
      getGoalsByGrain: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsXpAnalyticsService,
        { provide: GoalsXpAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(GoalsXpAnalyticsService);
    repo = module.get(GoalsXpAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('period axis', () => {
    it('defaults to month, spanning the data floor through the in-progress month', async () => {
      const res = await service.getGoalsXp({});

      expect(res.grain).toBe('month');
      expect(res.points.map((p) => p.periodStart)).toEqual([
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
      ]);
      expect(res.points.map((p) => p.periodLabel)).toEqual([
        'Jun 2026',
        'Jul 2026',
        'Aug 2026',
      ]);
      expect(res.points.map((p) => p.inProgress)).toEqual([false, false, true]);
    });

    it('buckets by quarter, truncating the floor to the start of its quarter', async () => {
      const res = await service.getGoalsXp({ grain: 'quarter' });

      expect(res.points.map((p) => p.periodStart)).toEqual([
        '2026-04-01',
        '2026-07-01',
      ]);
      expect(res.points.map((p) => p.periodLabel)).toEqual([
        'Q2 2026',
        'Q3 2026',
      ]);
      expect(res.points.map((p) => p.inProgress)).toEqual([false, true]);
    });

    it('buckets by year', async () => {
      const res = await service.getGoalsXp({ grain: 'year' });

      expect(res.points).toHaveLength(1);
      expect(res.points[0]).toMatchObject({
        periodStart: '2026-01-01',
        periodLabel: '2026',
        inProgress: true,
      });
    });

    it('measures the data floor for every grain', async () => {
      await service.getGoalsXp({ grain: 'year' });
      expect(repo.getDataFloor).toHaveBeenCalled();
    });
  });

  describe('actual XP', () => {
    it('reads actual XP per period from the repository', async () => {
      repo.getActualXpByPeriod.mockResolvedValue([
        { periodStart: '2026-06-01', actualXp: 1_545 },
        { periodStart: '2026-07-01', actualXp: 1_615 },
      ]);

      const res = await service.getGoalsXp({});

      expect(res.points.map((p) => p.actualXp)).toEqual([1_545, 1_615, 0]);
    });

    it('never fabricates actual XP for a period with no rows — a real zero, not a gap', async () => {
      const res = await service.getGoalsXp({});
      expect(res.points.every((p) => p.actualXp === 0)).toBe(true);
    });
  });

  describe('goals', () => {
    it('attaches a goal where one exists and reports hasGoal', async () => {
      repo.getGoalsByGrain.mockResolvedValue(
        new Map([
          ['2026-07-01', 2_000],
          ['2026-08-01', 1_000],
        ]),
      );

      const res = await service.getGoalsXp({});

      expect(res.points).toEqual([
        expect.objectContaining({
          periodStart: '2026-06-01',
          goalXp: null,
          hasGoal: false,
        }),
        expect.objectContaining({
          periodStart: '2026-07-01',
          goalXp: 2_000,
          hasGoal: true,
        }),
        expect.objectContaining({
          periodStart: '2026-08-01',
          goalXp: 1_000,
          hasGoal: true,
        }),
      ]);
    });

    it('never fabricates a goal as zero — a missing row is null, not 0', async () => {
      const res = await service.getGoalsXp({});

      for (const point of res.points) {
        expect(point.goalXp).toBeNull();
        expect(point.hasGoal).toBe(false);
      }
    });

    it('reads goals for the requested grain only', async () => {
      await service.getGoalsXp({ grain: 'quarter' });
      expect(repo.getGoalsByGrain).toHaveBeenCalledWith('quarter');
    });
  });

  describe('scoping', () => {
    it('is always platform-wide — Goals has no tenant filter', async () => {
      const res = await service.getGoalsXp({});
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
