import { Test, TestingModule } from '@nestjs/testing';
import { CommunitySharedService } from '../community-shared.service';
import { UserDailyScoreRepository } from '../../repository/user-daily-score.repository';

describe('CommunitySharedService', () => {
  let service: CommunitySharedService;
  let userDailyScoreRepository: jest.Mocked<UserDailyScoreRepository>;

  beforeEach(async () => {
    const mockUserDailyScoreRepository = {
      getTotalSimulationMinutesPerUser: jest.fn(),
      getMaxActiveDaysPerUser: jest.fn(),
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
    it('should return max active days per user with tenantIds', async () => {
      const tenantIds = ['tenant-1', 'tenant-2'];
      const mockResult = [
        { userId: 1, maxStreak: 7 },
        { userId: 2, maxStreak: 5 },
      ];

      userDailyScoreRepository.getMaxActiveDaysPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getMaxActiveDaysPerUser(tenantIds);

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getMaxActiveDaysPerUser,
      ).toHaveBeenCalledWith(tenantIds, undefined);
    });

    it('should return max active days per user with userIds', async () => {
      const userIds = [1, 2, 3];
      const mockResult = [{ userId: 1, maxStreak: 10 }];

      userDailyScoreRepository.getMaxActiveDaysPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getMaxActiveDaysPerUser(undefined, userIds);

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getMaxActiveDaysPerUser,
      ).toHaveBeenCalledWith(undefined, userIds);
    });

    it('should return max active days with both tenantIds and userIds', async () => {
      const tenantIds = ['tenant-1'];
      const userIds = [1, 2];
      const mockResult = [
        { userId: 1, maxStreak: 3 },
        { userId: 2, maxStreak: 14 },
      ];

      userDailyScoreRepository.getMaxActiveDaysPerUser.mockResolvedValue(
        mockResult,
      );

      const result = await service.getMaxActiveDaysPerUser(tenantIds, userIds);

      expect(result).toEqual(mockResult);
      expect(
        userDailyScoreRepository.getMaxActiveDaysPerUser,
      ).toHaveBeenCalledWith(tenantIds, userIds);
    });

    it('should return empty array when no filters provided', async () => {
      userDailyScoreRepository.getMaxActiveDaysPerUser.mockResolvedValue([]);

      const result = await service.getMaxActiveDaysPerUser();

      expect(result).toEqual([]);
      expect(
        userDailyScoreRepository.getMaxActiveDaysPerUser,
      ).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should propagate repository errors', async () => {
      const error = new Error('Database error');
      userDailyScoreRepository.getMaxActiveDaysPerUser.mockRejectedValue(error);

      await expect(
        service.getMaxActiveDaysPerUser(['tenant-1']),
      ).rejects.toThrow('Database error');
    });
  });
});
