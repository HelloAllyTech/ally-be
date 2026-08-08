import { Test, TestingModule } from '@nestjs/testing';
import { CommunityController } from '../community.controller';
import { LeaderboardService } from '../../service/leaderboard.service';
import { TokenUser } from 'src/auth/type/auth.types';
import {
  LeaderboardView,
  LeaderboardSortBy,
} from '../../type/leaderboard.type';
import { SortOrder } from 'src/common/type/common.type';
import {
  GetLeaderboardQueryDto,
  GetMyRankQueryDto,
  LeaderboardEntryDto,
} from '../../dto/leaderboard.dto';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserStatus } from 'src/user/constants/user-status.constants';

describe('CommunityController', () => {
  let controller: CommunityController;
  let leaderboardService: jest.Mocked<LeaderboardService>;

  const mockUser: TokenUser = {
    id: 1,
    tenantId: 'tenant-123',
    username: 'testuser',
  };

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
  ];

  const mockGuard = { canActivate: jest.fn(() => true) };

  beforeEach(async () => {
    const mockLeaderboardService = {
      getLeaderboard: jest.fn(),
      getMyRank: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        {
          provide: LeaderboardService,
          useValue: mockLeaderboardService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<CommunityController>(CommunityController);
    leaderboardService = module.get(LeaderboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard for LAST_WEEK window', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_WEEK,
        totalCount: 2,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      const result = await controller.getLeaderboard(query, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        mockUser.tenantId,
        LeaderboardView.LAST_WEEK,
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          order: undefined,
        },
      );
    });

    it('should return leaderboard for LAST_MONTH window', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_MONTH,
      };

      const expectedResponse = {
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_MONTH,
        totalCount: 2,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      const result = await controller.getLeaderboard(query, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        mockUser.tenantId,
        LeaderboardView.LAST_MONTH,
        expect.any(Object),
      );
    });

    it('should return leaderboard for LAST_YEAR window', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_YEAR,
      };

      const expectedResponse = {
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_YEAR,
        totalCount: 2,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      const result = await controller.getLeaderboard(query, mockUser);

      expect(result).toEqual(expectedResponse);
    });

    it('should return leaderboard for ALL_TIME window', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.ALL_TIME,
      };

      const expectedResponse = {
        data: mockLeaderboardData,
        window: LeaderboardView.ALL_TIME,
        totalCount: 2,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      const result = await controller.getLeaderboard(query, mockUser);

      expect(result).toEqual(expectedResponse);
    });

    it('should pass pagination parameters to service', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_WEEK,
        limit: 10,
        offset: 20,
        sortBy: LeaderboardSortBy.SCORE,
        order: SortOrder.DESC,
      };

      const expectedResponse = {
        data: mockLeaderboardData,
        window: LeaderboardView.LAST_WEEK,
        totalCount: 100,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      await controller.getLeaderboard(query, mockUser);

      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        mockUser.tenantId,
        LeaderboardView.LAST_WEEK,
        {
          limit: 10,
          offset: 20,
          sortBy: LeaderboardSortBy.SCORE,
          order: SortOrder.DESC,
        },
      );
    });

    it('should return empty leaderboard when no data', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        data: [],
        window: LeaderboardView.LAST_WEEK,
        totalCount: 0,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      const result = await controller.getLeaderboard(query, mockUser);

      expect(result.data).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should handle service errors', async () => {
      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const error = new Error('Service error');
      leaderboardService.getLeaderboard.mockRejectedValue(error);

      await expect(controller.getLeaderboard(query, mockUser)).rejects.toThrow(
        'Service error',
      );
    });

    it('should use user tenantId from token', async () => {
      const customUser: TokenUser = {
        id: 999,
        tenantId: 'custom-tenant',
        username: 'customuser',
      };

      const query: GetLeaderboardQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        data: [],
        window: LeaderboardView.LAST_WEEK,
        totalCount: 0,
        hideRankInCommunity: false,
      };

      leaderboardService.getLeaderboard.mockResolvedValue(expectedResponse);

      await controller.getLeaderboard(query, customUser);

      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        'custom-tenant',
        LeaderboardView.LAST_WEEK,
        expect.any(Object),
      );
    });
  });

  describe('getMyRank', () => {
    it('should return user rank for LAST_WEEK window', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        userId: mockUser.id,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 3,
        currentStreak: 4,
        window: LeaderboardView.LAST_WEEK,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      const result = await controller.getMyRank(query, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(leaderboardService.getMyRank).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.tenantId,
        LeaderboardView.LAST_WEEK,
      );
    });

    it('should return user rank for LAST_MONTH window', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_MONTH,
      };

      const expectedResponse = {
        userId: mockUser.id,
        name: 'John Doe',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 10,
        minutesPlayed: 200,
        badgeCount: 5,
        currentStreak: 4,
        window: LeaderboardView.LAST_MONTH,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      const result = await controller.getMyRank(query, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(leaderboardService.getMyRank).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.tenantId,
        LeaderboardView.LAST_MONTH,
      );
    });

    it('should return user rank for LAST_YEAR window', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_YEAR,
      };

      const expectedResponse = {
        userId: mockUser.id,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: 25,
        minutesPlayed: 500,
        badgeCount: 10,
        currentStreak: 4,
        window: LeaderboardView.LAST_YEAR,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      const result = await controller.getMyRank(query, mockUser);

      expect(result).toEqual(expectedResponse);
    });

    it('should return user rank for ALL_TIME window', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.ALL_TIME,
      };

      const expectedResponse = {
        userId: mockUser.id,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        status: UserStatus.ACTIVE,
        rank: 1,
        minutesPlayed: 1000,
        badgeCount: 20,
        currentStreak: 4,
        window: LeaderboardView.ALL_TIME,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      const result = await controller.getMyRank(query, mockUser);

      expect(result).toEqual(expectedResponse);
    });

    it('should return null when user has no activity', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      leaderboardService.getMyRank.mockResolvedValue(null);

      const result = await controller.getMyRank(query, mockUser);

      expect(result).toBeNull();
    });

    it('should handle service errors', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const error = new Error('Service error');
      leaderboardService.getMyRank.mockRejectedValue(error);

      await expect(controller.getMyRank(query, mockUser)).rejects.toThrow(
        'Service error',
      );
    });

    it('should use user id and tenantId from token', async () => {
      const customUser: TokenUser = {
        id: 999,
        tenantId: 'custom-tenant',
        username: 'customuser',
      };

      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        userId: customUser.id,
        name: 'Custom User',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 50,
        minutesPlayed: 30,
        badgeCount: 1,
        currentStreak: 4,
        window: LeaderboardView.LAST_WEEK,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      await controller.getMyRank(query, customUser);

      expect(leaderboardService.getMyRank).toHaveBeenCalledWith(
        999,
        'custom-tenant',
        LeaderboardView.LAST_WEEK,
      );
    });

    it('should handle user with no profile image', async () => {
      const query: GetMyRankQueryDto = {
        window: LeaderboardView.LAST_WEEK,
      };

      const expectedResponse = {
        userId: mockUser.id,
        name: 'John Doe',
        profileImageUrl: undefined,
        status: UserStatus.ACTIVE,
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 0,
        currentStreak: 4,
        window: LeaderboardView.LAST_WEEK,
        hideRankInCommunity: false,
      };

      leaderboardService.getMyRank.mockResolvedValue(expectedResponse);

      const result = await controller.getMyRank(query, mockUser);

      expect(result?.profileImageUrl).toBeUndefined();
    });
  });
});
