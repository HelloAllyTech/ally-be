import { Test, TestingModule } from '@nestjs/testing';
import { PracticeStreakService } from '../practice-streak.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { PracticeStreakGroupBy } from '../../type/practice-streak.type';

describe('PracticeStreakService', () => {
  let service: PracticeStreakService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getPracticeMinutesByBucket: jest.fn(),
      getUserStreaks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeStreakService,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
      ],
    }).compile();

    service = module.get<PracticeStreakService>(PracticeStreakService);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);

    userDailyScoreRepository.getUserStreaks.mockResolvedValue({
      currentStreak: 3,
      longestStreak: 9,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to DAY grouping and assembles cells + streaks', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([
      { bucket: '2026-07-08', minutes: 12.345 },
      { bucket: '2026-07-09', minutes: 0 },
      { bucket: '2026-07-10', minutes: 40 },
    ]);

    const result = await service.getPracticeStreak(mockUserId, mockTenantId);

    expect(result.groupBy).toBe(PracticeStreakGroupBy.DAY);
    expect(result.cells).toEqual([
      { periodStart: '2026-07-08', periodEnd: '2026-07-08', minutes: 12.35 },
      { periodStart: '2026-07-09', periodEnd: '2026-07-09', minutes: 0 },
      { periodStart: '2026-07-10', periodEnd: '2026-07-10', minutes: 40 },
    ]);
    expect(result.totalMinutes).toBe(52.35);
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(9);

    // day grouping maps to the 'day' truncation unit
    const [, , unit] =
      userDailyScoreRepository.getPracticeMinutesByBucket.mock.calls[0];
    expect(unit).toBe('day');
  });

  it('maps WEEK grouping to the week unit and computes inclusive period ends', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([
      { bucket: '2026-07-06', minutes: 65 }, // Monday
    ]);

    const result = await service.getPracticeStreak(
      mockUserId,
      mockTenantId,
      PracticeStreakGroupBy.WEEK,
    );

    const [, , unit] =
      userDailyScoreRepository.getPracticeMinutesByBucket.mock.calls[0];
    expect(unit).toBe('week');
    // week bucket end is start + 6 days
    expect(result.cells[0]).toEqual({
      periodStart: '2026-07-06',
      periodEnd: '2026-07-12',
      minutes: 65,
    });
  });

  it('maps MONTH grouping to the month unit and ends on the last day of the month', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([
      { bucket: '2026-02-01', minutes: 300 },
    ]);

    const result = await service.getPracticeStreak(
      mockUserId,
      mockTenantId,
      PracticeStreakGroupBy.MONTH,
    );

    const [, , unit] =
      userDailyScoreRepository.getPracticeMinutesByBucket.mock.calls[0];
    expect(unit).toBe('month');
    // Feb 2026 has 28 days
    expect(result.cells[0]).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      minutes: 300,
    });
  });

  it('honours an explicit from/to range', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([]);

    await service.getPracticeStreak(
      mockUserId,
      mockTenantId,
      PracticeStreakGroupBy.DAY,
      '2026-01-01',
      '2026-01-31',
    );

    const [userId, tenantId, , from, to] =
      userDailyScoreRepository.getPracticeMinutesByBucket.mock.calls[0];
    expect(userId).toBe(mockUserId);
    expect(tenantId).toBe(mockTenantId);
    expect((from as Date).toISOString().split('T')[0]).toBe('2026-01-01');
    expect((to as Date).toISOString().split('T')[0]).toBe('2026-01-31');
  });

  it('derives a default 30-day window for DAY grouping when no range is given', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([]);

    await service.getPracticeStreak(mockUserId, mockTenantId);

    const [, , , from, to] =
      userDailyScoreRepository.getPracticeMinutesByBucket.mock.calls[0];
    const diffDays = Math.round(
      ((to as Date).getTime() - (from as Date).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(29); // 30 inclusive buckets
  });
});
