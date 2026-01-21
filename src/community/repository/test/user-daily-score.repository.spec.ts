import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { UserDailyScoreRepository } from '../user-daily-score.repository';

describe('UserDailyScoreRepository', () => {
  let repository: UserDailyScoreRepository;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockQuery: jest.Mock;

  const mockUserId = 1;
  const mockTenantId = 'tenant-123';
  const mockDate = new Date('2025-01-15');
  const mockStartDate = new Date('2025-01-01');
  const mockEndDate = new Date('2025-01-15');

  beforeEach(async () => {
    mockQuery = jest.fn();

    const mockEntityManager = {
      connection: {
        options: { type: 'postgres' },
      },
    } as unknown as EntityManager;

    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDailyScoreRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<UserDailyScoreRepository>(UserDailyScoreRepository);
    // Override the query method
    repository.query = mockQuery;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upsertDailyScore', () => {
    it('should call query with correct parameters for upserting daily score', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 30);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_daily_scores'),
        expect.arrayContaining([
          mockUserId,
          mockTenantId,
          expect.any(Date),
          30,
        ]),
      );
    });

    it('should normalize date to remove time component', async () => {
      const dateWithTime = new Date('2025-01-15T14:30:00Z');
      mockQuery.mockResolvedValue(undefined);

      await repository.upsertDailyScore(
        mockUserId,
        mockTenantId,
        dateWithTime,
        15,
      );

      const queryCall = mockQuery.mock.calls[0];
      const normalizedDate = queryCall[1][2];
      // The date is normalized to YYYY-MM-DD format (ISO string split at 'T')
      // This creates a new Date object from just the date portion
      const expectedNormalizedDate = new Date(
        dateWithTime.toISOString().split('T')[0],
      );
      expect(normalizedDate.getTime()).toBe(expectedNormalizedDate.getTime());
    });

    it('should handle zero minutes to add', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 0);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([mockUserId, mockTenantId, expect.any(Date), 0]),
      );
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockQuery.mockRejectedValue(error);

      await expect(
        repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 30),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('getLeaderboardWithUserDetails', () => {
    const mockLeaderboardData = [
      {
        userId: 1,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: '1',
        minutesPlayed: '120',
        badgeCount: '5',
      },
      {
        userId: 2,
        name: 'Jane Smith',
        profileImageUrl: null,
        rank: '2',
        minutesPlayed: '100',
        badgeCount: '3',
      },
    ];

    it('should return leaderboard data with correct formatting', async () => {
      mockQuery
        .mockResolvedValueOnce(mockLeaderboardData)
        .mockResolvedValueOnce([{ count: '2' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        userId: 1,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: 1,
        minutesPlayed: 120,
        badgeCount: 5,
      });
      expect(result.data[1].profileImageUrl).toBeUndefined(); // null converted to undefined
      expect(result.totalCount).toBe(2);
    });

    it('should use default pagination when not provided', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '0' }]);

      await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      // Default limit is 50, offset is 0
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        mockTenantId,
        mockStartDate,
        mockEndDate,
        50,
        0,
      ]);
    });

    it('should use provided pagination parameters', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '0' }]);

      await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
        { limit: 10, offset: 20 },
      );

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        mockTenantId,
        mockStartDate,
        mockEndDate,
        10,
        20,
      ]);
    });

    it('should return empty data when no results', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '0' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.data).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should handle null count result', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: null }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.totalCount).toBe(0);
    });

    it('should handle empty count result array', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.totalCount).toBe(0);
    });

    it('should parse string values to numbers correctly', async () => {
      const dataWithStringValues = [
        {
          userId: 1,
          name: 'Test User',
          profileImageUrl: null,
          rank: '42',
          minutesPlayed: '999',
          badgeCount: '15',
        },
      ];

      mockQuery
        .mockResolvedValueOnce(dataWithStringValues)
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.data[0].rank).toBe(42);
      expect(result.data[0].minutesPlayed).toBe(999);
      expect(result.data[0].badgeCount).toBe(15);
    });

    it('should handle invalid number values with fallback to 0', async () => {
      const dataWithInvalidValues = [
        {
          userId: 1,
          name: 'Test User',
          profileImageUrl: null,
          rank: 'invalid',
          minutesPlayed: undefined,
          badgeCount: null,
        },
      ];

      mockQuery
        .mockResolvedValueOnce(dataWithInvalidValues)
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result.data[0].rank).toBe(0);
      expect(result.data[0].minutesPlayed).toBe(0);
      expect(result.data[0].badgeCount).toBe(0);
    });
  });

  describe('getUserRankWithDetails', () => {
    const mockRankResult = [
      {
        userId: 1,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: '5',
        minutesPlayed: '60',
        badgeCount: '3',
      },
    ];

    it('should return user rank when user has activity', async () => {
      mockQuery.mockResolvedValue(mockRankResult);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result).toEqual({
        userId: 1,
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        rank: 5,
        minutesPlayed: 60,
        badgeCount: 3,
      });
    });

    it('should return null when user has no activity', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result).toBeNull();
    });

    it('should handle null profile image', async () => {
      const resultWithNullImage = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: null,
          rank: '5',
          minutesPlayed: '60',
          badgeCount: '3',
        },
      ];

      mockQuery.mockResolvedValue(resultWithNullImage);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result?.profileImageUrl).toBeUndefined();
    });

    it('should pass correct parameters to query', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE rs."userId" = $4'),
        [mockTenantId, mockStartDate, mockEndDate, mockUserId],
      );
    });

    it('should parse string values to numbers correctly', async () => {
      const resultWithStringValues = [
        {
          userId: 1,
          name: 'Test User',
          profileImageUrl: null,
          rank: '100',
          minutesPlayed: '500',
          badgeCount: '25',
        },
      ];

      mockQuery.mockResolvedValue(resultWithStringValues);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
      );

      expect(result?.rank).toBe(100);
      expect(result?.minutesPlayed).toBe(500);
      expect(result?.badgeCount).toBe(25);
    });
  });

  describe('getUserDetailsForNoActivity', () => {
    it('should return user details when user exists', async () => {
      const mockUserDetails = [
        {
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          badgeCount: '5',
        },
      ];

      mockQuery.mockResolvedValue(mockUserDetails);

      const result = await repository.getUserDetailsForNoActivity(mockUserId);

      expect(result).toEqual({
        name: 'John Doe',
        profileImageUrl: 'https://example.com/avatar.jpg',
        badgeCount: 5,
      });
    });

    it('should return default values when user not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repository.getUserDetailsForNoActivity(mockUserId);

      expect(result).toEqual({
        name: '',
        profileImageUrl: undefined,
        badgeCount: 0,
      });
    });

    it('should handle null profile image', async () => {
      const mockUserDetails = [
        {
          name: 'John Doe',
          profileImageUrl: null,
          badgeCount: '3',
        },
      ];

      mockQuery.mockResolvedValue(mockUserDetails);

      const result = await repository.getUserDetailsForNoActivity(mockUserId);

      expect(result.profileImageUrl).toBeNull();
    });

    it('should parse badge count correctly', async () => {
      const mockUserDetails = [
        {
          name: 'Test User',
          profileImageUrl: null,
          badgeCount: '42',
        },
      ];

      mockQuery.mockResolvedValue(mockUserDetails);

      const result = await repository.getUserDetailsForNoActivity(mockUserId);

      expect(result.badgeCount).toBe(42);
    });

    it('should handle invalid badge count with fallback to 0', async () => {
      const mockUserDetails = [
        {
          name: 'Test User',
          profileImageUrl: null,
          badgeCount: 'invalid',
        },
      ];

      mockQuery.mockResolvedValue(mockUserDetails);

      const result = await repository.getUserDetailsForNoActivity(mockUserId);

      expect(result.badgeCount).toBe(0);
    });

    it('should pass correct user ID to query', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getUserDetailsForNoActivity(mockUserId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE u.id = $1'),
        [mockUserId],
      );
    });
  });

  describe('getTotalSimulationMinutesPerUser', () => {
    let mockCreateQueryBuilder: any;
    let mockQueryBuilder: any;

    beforeEach(() => {
      mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(),
      };
      mockCreateQueryBuilder = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      mockCreateQueryBuilder.mockRestore();
    });

    it('should return empty array when no tenantIds and no userIds provided', async () => {
      const result = await repository.getTotalSimulationMinutesPerUser();

      expect(result).toEqual([]);
      expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
    });

    it('should query with tenantIds filter', async () => {
      const tenantIds = ['tenant-1', 'tenant-2'];
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, totalMinutes: '120' },
        { userId: 2, totalMinutes: '60' },
      ]);

      const result =
        await repository.getTotalSimulationMinutesPerUser(tenantIds);

      expect(mockCreateQueryBuilder).toHaveBeenCalledWith('user_daily_score');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_daily_score.minutesPlayed IS NOT NULL',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_daily_score.minutesPlayed > 0',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_daily_score.tenantId IN (:...tenantIds)',
        { tenantIds },
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user_daily_score.userId',
        'userId',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'SUM(user_daily_score.minutesPlayed)',
        'totalMinutes',
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith(
        'user_daily_score.userId',
      );
      expect(result).toEqual([
        { userId: 1, totalMinutes: 120 },
        { userId: 2, totalMinutes: 60 },
      ]);
    });

    it('should query with userIds filter', async () => {
      const userIds = [1, 2, 3];
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, totalMinutes: '100' },
      ]);

      const result = await repository.getTotalSimulationMinutesPerUser(
        undefined,
        userIds,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user_daily_score.userId IN (:...userIds)',
        { userIds },
      );
      expect(result).toEqual([{ userId: 1, totalMinutes: 100 }]);
    });

    it('should handle invalid totalMinutes with fallback to 0', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, totalMinutes: 'invalid' },
        { userId: 2, totalMinutes: null },
        { userId: 3, totalMinutes: undefined },
      ]);

      const result = await repository.getTotalSimulationMinutesPerUser([
        'tenant-1',
      ]);

      expect(result[0].totalMinutes).toBe(0);
      expect(result[1].totalMinutes).toBe(0);
      expect(result[2].totalMinutes).toBe(0);
    });

    it('should return empty array when no matching records', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await repository.getTotalSimulationMinutesPerUser([
        'tenant-1',
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('getMaxActiveDaysPerUser', () => {
    it('should return empty array when no tenantIds and no userIds provided', async () => {
      const result = await repository.getMaxActiveDaysPerUser();

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should query with userIds filter', async () => {
      const userIds = [1, 2, 3];
      mockQuery.mockResolvedValue([
        { userId: 1, maxStreak: '7' },
        { userId: 2, maxStreak: '5' },
      ]);

      const result = await repository.getMaxActiveDaysPerUser(
        undefined,
        userIds,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"minutesPlayed" > 0'),
        userIds,
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"userId" IN'),
        expect.any(Array),
      );
      expect(result).toEqual([
        { userId: 1, maxStreak: 7 },
        { userId: 2, maxStreak: 5 },
      ]);
    });

    it('should query with tenantIds filter', async () => {
      const tenantIds = ['tenant-1', 'tenant-2'];
      mockQuery.mockResolvedValue([{ userId: 1, maxStreak: '10' }]);

      const result = await repository.getMaxActiveDaysPerUser(tenantIds);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id IN'),
        tenantIds,
      );
      expect(result).toEqual([{ userId: 1, maxStreak: 10 }]);
    });

    it('should parse maxStreak as integer', async () => {
      mockQuery.mockResolvedValue([{ userId: 1, maxStreak: '15' }]);

      const result = await repository.getMaxActiveDaysPerUser(['tenant-1']);

      expect(result[0].maxStreak).toBe(15);
    });

    it('should handle invalid maxStreak with fallback to 0', async () => {
      mockQuery.mockResolvedValue([
        { userId: 1, maxStreak: 'invalid' },
        { userId: 2, maxStreak: null },
        { userId: 3, maxStreak: undefined },
      ]);

      const result = await repository.getMaxActiveDaysPerUser(['tenant-1']);

      expect(result[0].maxStreak).toBe(0);
      expect(result[1].maxStreak).toBe(0);
      expect(result[2].maxStreak).toBe(0);
    });

    it('should return empty array when no matching records', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repository.getMaxActiveDaysPerUser(['tenant-1']);

      expect(result).toEqual([]);
    });

    it('should build correct SQL with island-gap detection for streaks', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getMaxActiveDaysPerUser(['tenant-1']);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WITH active_days AS'),
        expect.any(Array),
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('islands AS'),
        expect.any(Array),
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('streak_length AS'),
        expect.any(Array),
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('MAX(streak_length) as "maxStreak"'),
        expect.any(Array),
      );
    });
  });
});
