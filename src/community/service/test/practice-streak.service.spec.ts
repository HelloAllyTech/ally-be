import { Test, TestingModule } from '@nestjs/testing';
import { PracticeStreakService } from '../practice-streak.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { PracticeStreakGroupBy } from '../../type/practice-streak.type';
import { TenantService } from 'src/tenant/service/tenant.service';
import { BadgeStreakMilestoneSharedService } from 'src/badge/service/badge-streak-milestone-shared.service';

describe('PracticeStreakService', () => {
  let service: PracticeStreakService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;
  let tenantService: jest.Mocked<TenantService>;
  let milestoneService: jest.Mocked<BadgeStreakMilestoneSharedService>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getPracticeMinutesByBucket: jest.fn(),
      getUserStreaks: jest.fn(),
      getMinutesOnDate: jest.fn(),
    };
    const mockTenantService = { findById: jest.fn() };
    const mockMilestoneService = { getNextMilestone: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeStreakService,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
        { provide: TenantService, useValue: mockTenantService },
        {
          provide: BadgeStreakMilestoneSharedService,
          useValue: mockMilestoneService,
        },
      ],
    }).compile();

    service = module.get<PracticeStreakService>(PracticeStreakService);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);
    tenantService = module.get(TenantService);
    milestoneService = module.get(BadgeStreakMilestoneSharedService);

    userDailyScoreRepository.getUserStreaks.mockResolvedValue({
      userId: mockUserId,
      currentStreak: 3,
      longestStreak: 9,
      streakStartDate: '2026-07-08',
      lastActiveDate: '2026-07-10',
      previousRunLength: null,
      previousRunEndedOn: null,
    });
    userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(5);
    tenantService.findById.mockResolvedValue({ settings: {} } as any);
    milestoneService.getNextMilestone.mockResolvedValue(null);
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

  describe('getPracticeStreakSummary', () => {
    const summary = () =>
      service.getPracticeStreakSummary(mockUserId, mockTenantId);

    it('reports the business timezone and its calendar day', async () => {
      const result = await summary();

      expect(result.businessTimezone).toBe('Asia/Kolkata');
      expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('does not fetch heatmap buckets', async () => {
      await summary();

      expect(
        userDailyScoreRepository.getPracticeMinutesByBucket,
      ).not.toHaveBeenCalled();
    });

    describe('securing the day', () => {
      it('treats a full minute as securing the streak', async () => {
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(1);

        const result = await summary();

        expect(result.practicedToday).toBe(true);
        expect(result.streakSecuredToday).toBe(true);
        expect(result.atRisk).toBe(false);
        expect(result.streakEventToday).toBe('EXTENDED');
      });

      it('treats sub-minute practice as practised but not secured', async () => {
        // The gap the UI has to be honest about: the user has practised today,
        // yet the streak is still at risk because it needs a full minute.
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(0.5);

        const result = await summary();

        expect(result.practicedToday).toBe(true);
        expect(result.streakSecuredToday).toBe(false);
        expect(result.atRisk).toBe(true);
        expect(result.streakEventToday).toBe('PENDING');
      });

      it('flags a live streak with no practice today as at risk', async () => {
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(0);

        const result = await summary();

        expect(result.practicedToday).toBe(false);
        expect(result.atRisk).toBe(true);
        expect(result.streakEventToday).toBe('PENDING');
      });

      it('does not flag at risk when there is no streak to lose', async () => {
        userDailyScoreRepository.getUserStreaks.mockResolvedValue({
          userId: mockUserId,
          currentStreak: 0,
          longestStreak: 0,
          streakStartDate: null,
          lastActiveDate: null,
          previousRunLength: null,
          previousRunEndedOn: null,
        });
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(0);

        const result = await summary();

        expect(result.atRisk).toBe(false);
      });

      it('reports a first-day streak as STARTED rather than EXTENDED', async () => {
        userDailyScoreRepository.getUserStreaks.mockResolvedValue({
          userId: mockUserId,
          currentStreak: 1,
          longestStreak: 1,
          streakStartDate: '2026-08-09',
          lastActiveDate: '2026-08-09',
          previousRunLength: null,
          previousRunEndedOn: null,
        });
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(3);

        const result = await summary();

        expect(result.streakEventToday).toBe('STARTED');
      });
    });

    describe('daily goal', () => {
      it('defaults the goal to the active-day minimum so the copy is honest', async () => {
        const result = await summary();

        expect(result.dailyGoalMinutes).toBe(1);
      });

      it('honours a tenant-configured goal', async () => {
        tenantService.findById.mockResolvedValue({
          settings: { practiceStreak: { dailyGoalMinutes: 15 } },
        } as any);
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(4);

        const result = await summary();

        expect(result.dailyGoalMinutes).toBe(15);
        expect(result.minutesToGoal).toBe(11);
      });

      it('never reports a negative remaining goal', async () => {
        tenantService.findById.mockResolvedValue({
          settings: { practiceStreak: { dailyGoalMinutes: 5 } },
        } as any);
        userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(40);

        const result = await summary();

        expect(result.minutesToGoal).toBe(0);
      });

      it('clamps a goal below the active-day minimum', async () => {
        // A goal under the threshold would tell the user they were done while
        // the streak was still unprotected.
        tenantService.findById.mockResolvedValue({
          settings: { practiceStreak: { dailyGoalMinutes: 0.25 } },
        } as any);

        const result = await summary();

        expect(result.dailyGoalMinutes).toBe(1);
      });

      it('falls back to the default when the tenant lookup fails', async () => {
        tenantService.findById.mockRejectedValue(new Error('tenant gone'));

        const result = await summary();

        expect(result.dailyGoalMinutes).toBe(1);
      });
    });

    describe('previous run', () => {
      it('is null when there is no earlier run', async () => {
        const result = await summary();

        expect(result.previousRun).toBeNull();
      });

      it('reports the earlier run and how long ago it ended', async () => {
        userDailyScoreRepository.getUserStreaks.mockResolvedValue({
          userId: mockUserId,
          currentStreak: 0,
          longestStreak: 12,
          streakStartDate: null,
          lastActiveDate: '2026-08-05',
          previousRunLength: 12,
          previousRunEndedOn: '2026-08-05',
        });

        const result = await summary();

        expect(result.previousRun).toEqual({
          days: 12,
          endedOn: '2026-08-05',
          daysSinceEnded: expect.any(Number),
        });
        expect(result.previousRun!.daysSinceEnded).toBeGreaterThanOrEqual(1);
      });
    });

    describe('next milestone', () => {
      it('is measured against the current streak, not the longest', async () => {
        await summary();

        expect(milestoneService.getNextMilestone).toHaveBeenCalledWith(
          mockUserId,
          mockTenantId,
          3, // currentStreak, not longestStreak (9)
        );
      });

      it('passes the milestone straight through', async () => {
        const milestone = {
          days: 7,
          badgeId: 'badge-1',
          badgeName: 'Week One',
          badgeImageUrl: null,
          daysRemaining: 4,
          alreadyEarned: false,
        };
        milestoneService.getNextMilestone.mockResolvedValue(milestone);

        const result = await summary();

        expect(result.nextMilestone).toEqual(milestone);
      });

      it('is null when the tenant has no threshold above the current streak', async () => {
        const result = await summary();

        expect(result.nextMilestone).toBeNull();
      });
    });
  });

  it('includes the summary fields alongside the heatmap on the full endpoint', async () => {
    userDailyScoreRepository.getPracticeMinutesByBucket.mockResolvedValue([
      { bucket: '2026-07-10', minutes: 40 },
    ]);
    userDailyScoreRepository.getMinutesOnDate.mockResolvedValue(40);

    const result = await service.getPracticeStreak(mockUserId, mockTenantId);

    expect(result.cells).toHaveLength(1);
    expect(result.businessTimezone).toBe('Asia/Kolkata');
    expect(result.streakSecuredToday).toBe(true);
    expect(result.streakEventToday).toBe('EXTENDED');
    expect(result.currentStreak).toBe(3);
  });
});
