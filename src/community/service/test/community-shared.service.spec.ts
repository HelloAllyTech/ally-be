import { Test, TestingModule } from '@nestjs/testing';
import { CommunitySharedService } from '../community-shared.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';

describe('CommunitySharedService', () => {
  let service: CommunitySharedService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getTotalSimulationMinutesPerUser: jest.fn(),
      getStreakStatsForUsers: jest.fn(),
      getUserStreaks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitySharedService,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
      ],
    }).compile();

    service = module.get<CommunitySharedService>(CommunitySharedService);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTotalSimulationMinutesPerUser', () => {
    it('should return total simulation minutes per user with tenantIds', async () => {
      const tenantIds = ['tenant-1', 'tenant-2'];
      const mockResult = [
        { userId: 1, totalMinutes: 120 },
        { userId: 2, totalMinutes: 60 },
      ];

      userDailyScoreRepository.getTotalSimulationMinutesPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getTotalSimulationMinutesPerUser(tenantIds);

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getTotalSimulationMinutesPerUser,
      ).toHaveBeenCalledWith(tenantIds, undefined);
    });

    it('should return total simulation minutes per user with userIds', async () => {
      const userIds = [1, 2, 3];
      const mockResult = [{ userId: 1, totalMinutes: 100 }];

      userDailyScoreRepository.getTotalSimulationMinutesPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getTotalSimulationMinutesPerUser(
        undefined,
        userIds,
      );

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getTotalSimulationMinutesPerUser,
      ).toHaveBeenCalledWith(undefined, userIds);
    });

    it('should return total simulation minutes with both tenantIds and userIds', async () => {
      const tenantIds = ['tenant-1'];
      const userIds = [1, 2];
      const mockResult = [
        { userId: 1, totalMinutes: 50 },
        { userId: 2, totalMinutes: 75 },
      ];

      userDailyScoreRepository.getTotalSimulationMinutesPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getTotalSimulationMinutesPerUser(
        tenantIds,
        userIds,
      );

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getTotalSimulationMinutesPerUser,
      ).toHaveBeenCalledWith(tenantIds, userIds);
    });

    it('should return empty array when no filters provided', async () => {
      userDailyScoreRepository.getTotalSimulationMinutesPerUser.mockResolvedValue(
        [],
      );

      const result = await service.getTotalSimulationMinutesPerUser();

      expect(result).toEqual([]);
      expect(
        userDailyScoreRepository.getTotalSimulationMinutesPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should propagate repository errors', async () => {
      const error = new Error('Database error');
      userDailyScoreRepository.getTotalSimulationMinutesPerUser.mockRejectedValue(
        error,
      );

      await expect(
        service.getTotalSimulationMinutesPerUser(['tenant-1']),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getMaxActiveDaysPerUser', () => {
    const streakRow = (userId: number, longestStreak: number) => ({
      userId,
      longestStreak,
      currentStreak: 0,
      streakStartDate: null,
      lastActiveDate: null,
      previousRunLength: null,
      previousRunEndedOn: null,
    });

    it('should query each tenant separately so streaks stay tenant-scoped', async () => {
      userDailyScoreRepository.getStreakStatsForUsers
        .mockResolvedValueOnce([streakRow(1, 7), streakRow(2, 5)])
        .mockResolvedValueOnce([streakRow(3, 4)]);

      const result = await service.getMaxActiveDaysPerUser([
        'tenant-1',
        'tenant-2',
      ]);

      expect(
        userDailyScoreRepository.getStreakStatsForUsers,
      ).toHaveBeenCalledTimes(2);
      expect(
        userDailyScoreRepository.getStreakStatsForUsers,
      ).toHaveBeenNthCalledWith(1, 'tenant-1', undefined, expect.any(String));
      expect(
        userDailyScoreRepository.getStreakStatsForUsers,
      ).toHaveBeenNthCalledWith(2, 'tenant-2', undefined, expect.any(String));
      expect(result).toEqual([
        { userId: 1, maxStreak: 7 },
        { userId: 2, maxStreak: 5 },
        { userId: 3, maxStreak: 4 },
      ]);
    });

    it('should forward the userIds filter to each tenant query', async () => {
      const userIds = [1, 2, 3];
      userDailyScoreRepository.getStreakStatsForUsers.mockResolvedValue([
        streakRow(1, 10),
      ]);

      const result = await service.getMaxActiveDaysPerUser(
        ['tenant-1'],
        userIds,
      );

      expect(
        userDailyScoreRepository.getStreakStatsForUsers,
      ).toHaveBeenCalledWith('tenant-1', userIds, expect.any(String));
      expect(result).toEqual([{ userId: 1, maxStreak: 10 }]);
    });

    it('should collapse a multi-tenant user to their best run, not the sum or a split', async () => {
      userDailyScoreRepository.getStreakStatsForUsers
        .mockResolvedValueOnce([streakRow(1, 6)])
        .mockResolvedValueOnce([streakRow(1, 2)]);

      const result = await service.getMaxActiveDaysPerUser(
        ['tenant-1', 'tenant-2'],
        [1],
      );

      // One row per user. Passing both tenants through a single un-scoped query
      // duplicated the user's calendar days and split their islands, reporting
      // a genuine six-day run as two.
      expect(result).toEqual([{ userId: 1, maxStreak: 6 }]);
    });

    it('should return empty array without querying when no tenants provided', async () => {
      const result = await service.getMaxActiveDaysPerUser();

      expect(result).toEqual([]);
      expect(
        userDailyScoreRepository.getStreakStatsForUsers,
      ).not.toHaveBeenCalled();
    });

    it('should propagate repository errors', async () => {
      const error = new Error('Database error');
      userDailyScoreRepository.getStreakStatsForUsers.mockRejectedValue(error);

      await expect(
        service.getMaxActiveDaysPerUser(['tenant-1']),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getStreakStatsForUser', () => {
    it('should delegate to the tenant-scoped single-user lookup', async () => {
      const row = {
        userId: 7,
        currentStreak: 3,
        longestStreak: 9,
        streakStartDate: '2026-08-07',
        lastActiveDate: '2026-08-09',
        previousRunLength: 9,
        previousRunEndedOn: '2026-07-05',
      };
      userDailyScoreRepository.getUserStreaks.mockResolvedValue(row);

      const result = await service.getStreakStatsForUser(7, 'tenant-1');

      expect(result).toEqual(row);
      expect(userDailyScoreRepository.getUserStreaks).toHaveBeenCalledWith(
        7,
        'tenant-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });
  });
});
