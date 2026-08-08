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
      mockQuery.mockResolvedValue([]);

      await repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 30);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_daily_scores'),
        expect.arrayContaining([
          mockUserId,
          mockTenantId,
          expect.any(String),
          30,
        ]),
      );
    });

    it('should bucket the day in the business timezone, not UTC', async () => {
      // 22:30 UTC on Jan 15 is 04:00 IST on Jan 16 — the user experienced this
      // as a late-night Jan 16 session, so it must be credited to Jan 16.
      const lateNightIst = new Date('2025-01-15T22:30:00Z');
      mockQuery.mockResolvedValue([]);

      await repository.upsertDailyScore(
        mockUserId,
        mockTenantId,
        lateNightIst,
        15,
      );

      const [, params] = mockQuery.mock.calls[0];
      expect(params[2]).toBe('2025-01-16');
      expect(lateNightIst.toISOString().split('T')[0]).toBe('2025-01-15');
    });

    it('should handle zero minutes to add', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 0);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          mockUserId,
          mockTenantId,
          expect.any(String),
          0,
        ]),
      );
    });

    it('should report the active-day threshold crossing from RETURNING', async () => {
      mockQuery.mockResolvedValue([
        {
          businessDate: '2025-01-15',
          minutesAfter: '1.00',
          crossedActiveThreshold: true,
        },
      ]);

      const result = await repository.upsertDailyScore(
        mockUserId,
        mockTenantId,
        mockDate,
        0.5,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('RETURNING'),
        expect.any(Array),
      );
      expect(result).toEqual({
        businessDate: '2025-01-15',
        minutesAfter: 1,
        crossedActiveThreshold: true,
      });
    });

    it('should default to not crossing when the driver returns no rows', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repository.upsertDailyScore(
        mockUserId,
        mockTenantId,
        mockDate,
        30,
      );

      expect(result.crossedActiveThreshold).toBe(false);
      expect(result.minutesAfter).toBe(0);
      expect(result.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockQuery.mockRejectedValue(error);

      await expect(
        repository.upsertDailyScore(mockUserId, mockTenantId, mockDate, 30),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('incrementTotalScore', () => {
    it('should call query with correct parameters for incrementing total score', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.incrementTotalScore(mockUserId, mockTenantId, 0.5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_daily_scores'),
        expect.arrayContaining([
          mockUserId,
          mockTenantId,
          expect.any(String),
          0.5,
        ]),
      );
    });

    it("should bind today's business date as a plain YYYY-MM-DD string", async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.incrementTotalScore(mockUserId, mockTenantId, 0.25);

      const queryCall = mockQuery.mock.calls[0];
      const normalizedDate = queryCall[1][2];
      // A Date bound through node-postgres renders in the process timezone, so
      // the day bucket must be a timezone-free string instead.
      expect(typeof normalizedDate).toBe('string');
      expect(normalizedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(queryCall[0]).toContain('$3::date');
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockQuery.mockRejectedValue(error);

      await expect(
        repository.incrementTotalScore(mockUserId, mockTenantId, 0.5),
      ).rejects.toThrow('Database connection failed');
    });

    it('should use correct SQL for upsert with ON CONFLICT', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.incrementTotalScore(mockUserId, mockTenantId, 0.5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT ("userId", "tenant_id", "date")'),
        expect.any(Array),
      );
    });
  });

  describe('decrementTotalScore', () => {
    let mockEntityManager: jest.Mocked<any>;

    beforeEach(() => {
      mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          query: mockQuery,
        }),
      };

      // Mock dataSource.getRepository for the no-EntityManager case
      (mockDataSource as any).getRepository = jest
        .fn()
        .mockReturnValue({ query: mockQuery });
    });

    it('should call query with correct parameters for decrementing total score', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.decrementTotalScore(mockUserId, mockTenantId, 0.5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_daily_scores'),
        expect.arrayContaining([
          mockUserId,
          mockTenantId,
          expect.any(String),
          -0.5,
        ]),
      );
    });

    it('should use provided EntityManager when passed', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.decrementTotalScore(
        mockUserId,
        mockTenantId,
        0.25,
        mockEntityManager,
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        expect.anything(),
      );
    });

    it('should use dataSource.getRepository when no EntityManager provided', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.decrementTotalScore(mockUserId, mockTenantId, 0.25);

      expect((mockDataSource as any).getRepository).toHaveBeenCalled();
    });

    it("should bind today's business date as a plain YYYY-MM-DD string", async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.decrementTotalScore(mockUserId, mockTenantId, 0.5);

      const queryCall = mockQuery.mock.calls[0];
      const normalizedDate = queryCall[1][2];
      expect(typeof normalizedDate).toBe('string');
      expect(normalizedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(queryCall[0]).toContain('$3::date');
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockQuery.mockRejectedValue(error);

      await expect(
        repository.decrementTotalScore(mockUserId, mockTenantId, 0.5),
      ).rejects.toThrow('Database connection failed');
    });

    it('should pass negative amount as parameter for decrementing', async () => {
      mockQuery.mockResolvedValue(undefined);

      await repository.decrementTotalScore(mockUserId, mockTenantId, 0.5);

      const queryCall = mockQuery.mock.calls[0];
      const amount = queryCall[1][3];
      expect(amount).toBe(-0.5);
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
        currentStreak: '4',
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
        currentStreak: 4,
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

      // Default limit is 50, offset is 0. The trailing param is the business
      // date the streak CTE compares against, in place of CURRENT_DATE.
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        mockTenantId,
        mockStartDate,
        mockEndDate,
        50,
        0,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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

    it('should return undefined rank when hideRankInCommunity is true', async () => {
      const leaderboardData = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '1',
          minutesPlayed: '120',
          badgeCount: '5',
        },
      ];

      mockQuery
        .mockResolvedValueOnce(leaderboardData)
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
        undefined,
        true,
      );

      expect(result.data[0].rank).toBeUndefined();
      expect(result.data[0].minutesPlayed).toBe(120);
      expect(result.data[0].badgeCount).toBe(5);
    });

    it('should return rank when hideRankInCommunity is false', async () => {
      const leaderboardData = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '1',
          minutesPlayed: '120',
          badgeCount: '5',
        },
      ];

      mockQuery
        .mockResolvedValueOnce(leaderboardData)
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
        undefined,
        false,
      );

      expect(result.data[0].rank).toBe(1);
    });

    it('should return rank when hideRankInCommunity is undefined', async () => {
      const leaderboardData = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '1',
          minutesPlayed: '120',
          badgeCount: '5',
        },
      ];

      mockQuery
        .mockResolvedValueOnce(leaderboardData)
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await repository.getLeaderboardWithUserDetails(
        mockTenantId,
        mockStartDate,
        mockEndDate,
        undefined,
        undefined,
      );

      expect(result.data[0].rank).toBe(1);
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
      mockQuery
        .mockResolvedValueOnce(mockRankResult)
        // Second call is the shared streak lookup, reused so "my rank" and the
        // leaderboard row can never disagree.
        .mockResolvedValueOnce([
          { userId: 1, currentStreak: '4', longestStreak: '9' },
        ]);

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
        currentStreak: 4,
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

    it('should return undefined rank when hideRankInCommunity is true', async () => {
      const rankResult = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '5',
          minutesPlayed: '60',
          badgeCount: '3',
        },
      ];

      mockQuery.mockResolvedValue(rankResult);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
        true,
      );

      expect(result?.rank).toBeUndefined();
      expect(result?.minutesPlayed).toBe(60);
      expect(result?.badgeCount).toBe(3);
    });

    it('should return rank when hideRankInCommunity is false', async () => {
      const rankResult = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '5',
          minutesPlayed: '60',
          badgeCount: '3',
        },
      ];

      mockQuery.mockResolvedValue(rankResult);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
        false,
      );

      expect(result?.rank).toBe(5);
    });

    it('should return rank when hideRankInCommunity is undefined', async () => {
      const rankResult = [
        {
          userId: 1,
          name: 'John Doe',
          profileImageUrl: 'https://example.com/avatar.jpg',
          rank: '5',
          minutesPlayed: '60',
          badgeCount: '3',
        },
      ];

      mockQuery.mockResolvedValue(rankResult);

      const result = await repository.getUserRankWithDetails(
        mockUserId,
        mockTenantId,
        mockStartDate,
        mockEndDate,
        undefined,
      );

      expect(result?.rank).toBe(5);
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

  describe('getStreakStatsForUsers', () => {
    const TODAY = '2026-08-09';

    it('should return empty array without querying when tenantId is missing', async () => {
      const result = await repository.getStreakStatsForUsers('', [1], TODAY);

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return empty array without querying for an explicitly empty user list', async () => {
      const result = await repository.getStreakStatsForUsers(
        'tenant-1',
        [],
        TODAY,
      );

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should scope by tenant and bind the user list and business date', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getStreakStatsForUsers('tenant-1', [1, 2], TODAY);

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        'tenant-1',
        [1, 2],
        TODAY,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id = $1'),
        expect.any(Array),
      );
    });

    it('should bind null for the user list when scanning every user in the tenant', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getStreakStatsForUsers('tenant-1', undefined, TODAY);

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        'tenant-1',
        null,
        TODAY,
      ]);
    });

    it('should de-duplicate active days so cross-tenant rows cannot split a run', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getStreakStatsForUsers('tenant-1', [1], TODAY);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT "userId", "date"::date'),
        expect.any(Array),
      );
    });

    it('should build the gaps-and-islands SQL over the active-day threshold', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getStreakStatsForUsers('tenant-1', [1], TODAY);

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('"minutesPlayed" >= 1.00');
      expect(sql).toContain('WITH active_days AS');
      expect(sql).toContain('islands AS');
      expect(sql).toContain('runs AS');
      expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY "userId"');
    });

    it('should derive the current streak from the caller-supplied business date, not CURRENT_DATE', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getStreakStatsForUsers('tenant-1', [1], TODAY);

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('last_day >= $3::date - 1');
      expect(sql).not.toContain('CURRENT_DATE');
    });

    it('should map every streak statistic off the row', async () => {
      mockQuery.mockResolvedValue([
        {
          userId: '7',
          longestStreak: '9',
          currentStreak: '3',
          streakStartDate: '2026-08-07',
          lastActiveDate: '2026-08-09',
          previousRunLength: '9',
          previousRunEndedOn: '2026-07-05',
        },
      ]);

      const result = await repository.getStreakStatsForUsers(
        'tenant-1',
        [7],
        TODAY,
      );

      expect(result).toEqual([
        {
          userId: 7,
          currentStreak: 3,
          longestStreak: 9,
          streakStartDate: '2026-08-07',
          lastActiveDate: '2026-08-09',
          previousRunLength: 9,
          previousRunEndedOn: '2026-07-05',
        },
      ]);
    });

    it('should null out the optional dates when the user has no current or previous run', async () => {
      mockQuery.mockResolvedValue([
        {
          userId: 7,
          longestStreak: '0',
          currentStreak: '0',
          streakStartDate: null,
          lastActiveDate: null,
          previousRunLength: null,
          previousRunEndedOn: null,
        },
      ]);

      const [row] = await repository.getStreakStatsForUsers(
        'tenant-1',
        [7],
        TODAY,
      );

      expect(row).toEqual({
        userId: 7,
        currentStreak: 0,
        longestStreak: 0,
        streakStartDate: null,
        lastActiveDate: null,
        previousRunLength: null,
        previousRunEndedOn: null,
      });
    });
  });

  describe('getUserStreaks', () => {
    it('should return a zeroed row for a user with no active days', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repository.getUserStreaks(
        7,
        'tenant-1',
        '2026-08-09',
      );

      expect(result).toEqual({
        userId: 7,
        currentStreak: 0,
        longestStreak: 0,
        streakStartDate: null,
        lastActiveDate: null,
        previousRunLength: null,
        previousRunEndedOn: null,
      });
    });

    it('should default the business date when the caller omits it', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.getUserStreaks(7, 'tenant-1');

      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('tenant-1');
      expect(params[1]).toEqual([7]);
      expect(params[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('business-timezone day handling', () => {
    it('should never let Postgres resolve the current date for any query in this repository', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.upsertDailyScore(1, 'tenant-1', new Date(), 5);
      await repository.incrementTotalScore(1, 'tenant-1', 1);
      await repository.getStreakStatsForUsers('tenant-1', [1], '2026-08-09');

      // CURRENT_DATE resolves in the Postgres session timezone, which nothing
      // in this repo sets. Every day boundary must come from the business
      // timezone computed in Node instead.
      for (const [sql] of mockQuery.mock.calls) {
        expect(sql).not.toContain('CURRENT_DATE');
      }
    });

    it('should bind the day as a YYYY-MM-DD string, never a Date', async () => {
      mockQuery.mockResolvedValue([]);

      await repository.upsertDailyScore(
        1,
        'tenant-1',
        new Date('2026-08-08T22:30:00.000Z'),
        5,
      );

      const [sql, params] = mockQuery.mock.calls[0];
      // 22:30 UTC on Aug 8 is 04:00 IST on Aug 9 — the business day is Aug 9.
      expect(params[2]).toBe('2026-08-09');
      expect(typeof params[2]).toBe('string');
      expect(sql).toContain('$3::date');
    });
  });
});
