import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardService } from '../leaderboard.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { LeaderboardView } from '../../type/leaderboard.type';
import { LeaderboardEntryDto } from '../../dto/leaderboard.dto';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;

  const mockLeaderboardEntry: LeaderboardEntryDto = {
    userId: 1,
    name: 'John Doe',
    profileImageUrl: 'https://example.com/avatar.jpg',
    rank: 1,
    minutesPlayed: 120,
    badgeCount: 5,
  };

  const mockLeaderboardData = [
    mockLeaderboardEntry,
    {
      userId: 2,
      name: 'Jane Smith',
      profileImageUrl: 'https://example.com/avatar2.jpg',
      rank: 2,
      minutesPlayed: 100,
      badgeCount: 3,
    },
    {
      userId: 3,
      name: 'Bob Wilson',
      profileImageUrl: undefined,
      rank: 3,
      minutesPlayed: 80,
      badgeCount: 1,
    },
  ];

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getLeaderboardWithUserDetails: jest.fn(),
      getUserRankWithDetails: jest.fn(),
      getUserDetailsForNoActivity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard for LAST_WEEK window', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: mockLeaderboardData,
        totalCount: 3,
      });

      const result = await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toEqual({
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_WEEK,
        totalCount: 3,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });

    it('should return leaderboard for LAST_MONTH window', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: mockLeaderboardData,
        totalCount: 3,
      });

      const result = await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.LAST_MONTH,
      );

      expect(result).toEqual({
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_MONTH,
        totalCount: 3,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });

    it('should return leaderboard for LAST_YEAR window', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: mockLeaderboardData,
        totalCount: 3,
      });

      const result = await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.LAST_YEAR,
      );

      expect(result).toEqual({
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_YEAR,
        totalCount: 3,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });

    it('should return leaderboard for ALL_TIME window', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: mockLeaderboardData,
        totalCount: 3,
      });

      const result = await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.ALL_TIME,
      );

      expect(result).toEqual({
        data: mockLeaderboardData,
        window: LeaderboardView.ALL_TIME,
        totalCount: 3,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });

    it('should pass pagination parameters to repository', async () => {
      const pagination = { limit: 10, offset: 20 };
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: mockLeaderboardData,
        totalCount: 100,
      });

      await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.LAST_WEEK,
        pagination,
      );

      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        pagination,
      );
    });

    it('should return empty leaderboard when no data', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      const result = await service.getLeaderboard(
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toEqual({
        data: [],
        window: LeaderboardView.LAST_WEEK,
        totalCount: 0,
      });
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockRejectedValue(
        error,
      );

      await expect(
        service.getLeaderboard(mockTenantId, LeaderboardView.LAST_WEEK),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getMyRank', () => {
    it('should return user rank when user has activity', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 3,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toEqual({
        ...rankResult,
        window: LeaderboardView.LAST_WEEK,
      });
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('should return zero rank when user has no activity in window', async () => {
      const userDetails = {
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        badgeCount: 3,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(null);
      userDailyScoreRepository.getUserDetailsForNoActivity.mockResolvedValue(
        userDetails,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toEqual({
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: 0,
        minutesPlayed: 0,
        badgeCount: 3,
        window: LeaderboardView.LAST_WEEK,
      });
      expect(
        userDailyScoreRepository.getUserDetailsForNoActivity,
      ).toHaveBeenCalledWith(mockUserId);
    });

    it('should return rank for LAST_MONTH window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        rank: 10,
        minutesPlayed: 200,
        badgeCount: 5,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_MONTH,
      );

      expect(result).toEqual({
        ...rankResult,
        window: LeaderboardView.LAST_MONTH,
      });
    });

    it('should return rank for LAST_YEAR window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        rank: 25,
        minutesPlayed: 500,
        badgeCount: 10,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_YEAR,
      );

      expect(result).toEqual({
        ...rankResult,
        window: LeaderboardView.LAST_YEAR,
      });
    });

    it('should return rank for ALL_TIME window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: 1,
        minutesPlayed: 1000,
        badgeCount: 20,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.ALL_TIME,
      );

      expect(result).toEqual({
        ...rankResult,
        window: LeaderboardView.ALL_TIME,
      });
    });

    it('should handle user with no profile image', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 0,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result.profileImageUrl).toBeUndefined();
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      userDailyScoreRepository.getUserRankWithDetails.mockRejectedValue(error);

      await expect(
        service.getMyRank(mockUserId, mockTenantId, LeaderboardView.LAST_WEEK),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getDateRange (tested through public methods)', () => {
    it('should calculate correct date range for LAST_WEEK', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_WEEK);

      const [, startDate, endDate] =
        userDailyScoreRepository.getLeaderboardWithUserDetails.mock.calls[0];

      // Start date should be 6 days ago at midnight
      const expectedStartDate = new Date();
      expectedStartDate.setDate(expectedStartDate.getDate() - 6);
      expectedStartDate.setHours(0, 0, 0, 0);

      // End date should be today at 23:59:59.999
      const expectedEndDate = new Date();
      expectedEndDate.setHours(23, 59, 59, 999);

      expect(startDate.getDate()).toBe(expectedStartDate.getDate());
      expect(endDate.getDate()).toBe(expectedEndDate.getDate());
    });

    it('should calculate correct date range for LAST_MONTH', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_MONTH);

      const [, startDate, endDate] =
        userDailyScoreRepository.getLeaderboardWithUserDetails.mock.calls[0];

      // Start date should be 27 days ago at midnight
      const expectedStartDate = new Date();
      expectedStartDate.setDate(expectedStartDate.getDate() - 27);
      expectedStartDate.setHours(0, 0, 0, 0);

      expect(startDate.getDate()).toBe(expectedStartDate.getDate());
      expect(endDate.getDate()).toBe(new Date().getDate());
    });

    it('should calculate correct date range for LAST_YEAR', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_YEAR);

      const [, startDate] =
        userDailyScoreRepository.getLeaderboardWithUserDetails.mock.calls[0];

      // Start date should be 363 days ago
      const expectedStartDate = new Date();
      expectedStartDate.setDate(expectedStartDate.getDate() - 363);
      expectedStartDate.setHours(0, 0, 0, 0);

      expect(startDate.getDate()).toBe(expectedStartDate.getDate());
    });

    it('should calculate correct date range for ALL_TIME', async () => {
      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.ALL_TIME);

      const [, startDate] =
        userDailyScoreRepository.getLeaderboardWithUserDetails.mock.calls[0];

      // Start date should be 2020-01-01
      expect(startDate.getFullYear()).toBe(2020);
      expect(startDate.getMonth()).toBe(0);
      expect(startDate.getDate()).toBe(1);
    });
  });
});
