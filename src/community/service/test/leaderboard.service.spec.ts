import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardService } from '../leaderboard.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';
import { LeaderboardView } from '../../type/leaderboard.type';
import { LeaderboardEntryDto } from '../../dto/leaderboard.dto';
import { TenantService } from 'src/tenant/service/tenant.service';
import { UserStatus } from 'src/user/constants/user-status.constants';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;
  let tenantService: jest.Mocked<TenantService>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 1;

  const mockLeaderboardEntry: LeaderboardEntryDto = {
    userId: 1,
    name: 'John Doe',
    profileImageUrl: 'https://example.com/avatar.jpg',
    status: UserStatus.ACTIVE,
    rank: 1,
    minutesPlayed: 120,
    badgeCount: 5,
    currentStreak: 4,
  };

  const mockLeaderboardData = [
    mockLeaderboardEntry,
    {
      userId: 2,
      name: 'Jane Smith',
      profileImageUrl: 'https://example.com/avatar2.jpg',
      status: UserStatus.ACTIVE,
      rank: 2,
      minutesPlayed: 100,
      badgeCount: 3,
      currentStreak: 4,
    },
    {
      userId: 3,
      name: 'Bob Wilson',
      profileImageUrl: undefined,
      status: UserStatus.ACTIVE,
      rank: 3,
      minutesPlayed: 80,
      badgeCount: 1,
      currentStreak: 4,
    },
  ];

  const mockTenantSettings = {
    id: mockTenantId,
    name: 'Test Tenant',
    settings: {
      hideRankInCommunity: false,
    },
  };

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getLeaderboardWithUserDetails: jest.fn(),
      getUserRankWithDetails: jest.fn(),
    };

    const mockTenantService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: UserDailyScoreRepository,
          useValue: mockUserDailyScoreRepository,
        },
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    userDailyScoreRepository = module.get(UserDailyScoreRepository);
    tenantService = module.get(TenantService);

    // Default mock: tenant with hideRankInCommunity = false
    tenantService.findById.mockResolvedValue(mockTenantSettings as any);
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
        hideRankInCommunity: false,
      });
      expect(tenantService.findById).toHaveBeenCalledWith(mockTenantId);
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
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
        hideRankInCommunity: false,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
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
        hideRankInCommunity: false,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
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
        hideRankInCommunity: false,
      });
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
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
        false,
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
        hideRankInCommunity: false,
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

    it('should pass hideRankInCommunity=true to repository when tenant setting is enabled', async () => {
      tenantService.findById.mockResolvedValue({
        id: mockTenantId,
        name: 'Test Tenant',
        settings: {
          hideRankInCommunity: true,
        },
      } as any);

      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_WEEK);

      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        true,
      );
    });

    it('should handle tenant with no settings', async () => {
      tenantService.findById.mockResolvedValue({
        id: mockTenantId,
        name: 'Test Tenant',
        settings: undefined,
      } as any);

      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_WEEK);

      // hideRankInCommunity defaults to false when settings is undefined
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
      );
    });

    it('should handle tenant not found', async () => {
      tenantService.findById.mockResolvedValue(null);

      userDailyScoreRepository.getLeaderboardWithUserDetails.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await service.getLeaderboard(mockTenantId, LeaderboardView.LAST_WEEK);

      // hideRankInCommunity defaults to false when tenant is not found
      expect(
        userDailyScoreRepository.getLeaderboardWithUserDetails,
      ).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        undefined,
        false,
      );
    });
  });

  describe('getMyRank', () => {
    it('should return user rank when user has activity', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 3,
        currentStreak: 4,
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
        hideRankInCommunity: false,
      });
      expect(tenantService.findById).toHaveBeenCalledWith(mockTenantId);
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        false,
      );
    });

    it('should return null when user has no activity in window', async () => {
      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(null);

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toBeNull();
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        false,
      );
    });

    it('should pass hideRankInCommunity=true when tenant setting is enabled', async () => {
      tenantService.findById.mockResolvedValue({
        id: mockTenantId,
        name: 'Test Tenant',
        settings: {
          hideRankInCommunity: true,
        },
      } as any);

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue({
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: undefined, // rank is hidden
        minutesPlayed: 120,
        badgeCount: 3,
        currentStreak: 4,
      });

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).not.toBeNull();
      expect(result!.rank).toBeUndefined();
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        true,
      );
    });

    it('should return null when user has no activity even with hideRankInCommunity true', async () => {
      tenantService.findById.mockResolvedValue({
        id: mockTenantId,
        name: 'Test Tenant',
        settings: {
          hideRankInCommunity: true,
        },
      } as any);

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(null);

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).toBeNull();
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        true,
      );
    });

    it('should return rank for LAST_MONTH window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 10,
        minutesPlayed: 200,
        badgeCount: 5,
        currentStreak: 4,
        hideRankInCommunity: false,
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
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        false,
      );
    });

    it('should return rank for LAST_YEAR window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 25,
        minutesPlayed: 500,
        badgeCount: 10,
        currentStreak: 4,
        hideRankInCommunity: false,
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
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        false,
      );
    });

    it('should return rank for ALL_TIME window', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: 1,
        minutesPlayed: 1000,
        badgeCount: 20,
        currentStreak: 4,
        hideRankInCommunity: false,
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
      expect(
        userDailyScoreRepository.getUserRankWithDetails,
      ).toHaveBeenCalledWith(
        mockUserId,
        mockTenantId,
        expect.any(Date),
        expect.any(Date),
        false,
      );
    });

    it('should handle user with no profile image', async () => {
      const rankResult = {
        userId: mockUserId,
        name: 'John Doe',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 0,
        currentStreak: 4,
      };

      userDailyScoreRepository.getUserRankWithDetails.mockResolvedValue(
        rankResult,
      );

      const result = await service.getMyRank(
        mockUserId,
        mockTenantId,
        LeaderboardView.LAST_WEEK,
      );

      expect(result).not.toBeNull();
      expect(result!.profileImageUrl).toBeUndefined();
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
