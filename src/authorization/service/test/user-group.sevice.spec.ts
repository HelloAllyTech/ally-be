import { Test, TestingModule } from '@nestjs/testing';
import { UserGroupService } from '../user-group.service';

import { UserGroup } from 'src/common/entities/user-group.entity';
import { UserGroupRepository } from 'src/authorization/repository/user-group.repository';

describe('UserGroupService', () => {
  let service: UserGroupService;
  let repository: jest.Mocked<UserGroupRepository>;

  beforeEach(async () => {
    // Create mock repository
    const mockRepository = {
      findMany: jest.fn(),
      getUserGroupsByUserIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupService,
        {
          provide: UserGroupRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UserGroupService>(UserGroupService);
    repository = module.get(UserGroupRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserGroups', () => {
    it('should return user groups for a given userId', async () => {
      const userId = 1;
      const expectedUserGroups = [
        { id: 1, userId: 1, groupId: 2 },
        { id: 2, userId: 1, groupId: 3 },
      ] as UserGroup[];

      repository.findMany.mockResolvedValueOnce(expectedUserGroups);

      const result = await service.getUserGroups(userId);

      expect(result).toEqual(expectedUserGroups);
      expect(repository.findMany).toHaveBeenCalledWith({ userId });
      expect(repository.findMany).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when user has no groups', async () => {
      const userId = 999;
      repository.findMany.mockResolvedValueOnce([]);

      const result = await service.getUserGroups(userId);

      expect(result).toEqual([]);
      expect(repository.findMany).toHaveBeenCalledWith({ userId: 999 });
    });

    it('should pass userId correctly to repository', async () => {
      const userId = 42;
      repository.findMany.mockResolvedValueOnce([]);

      await service.getUserGroups(userId);

      expect(repository.findMany).toHaveBeenCalledWith({ userId: 42 });
    });

    it('should handle repository errors', async () => {
      const userId = 1;
      const error = new Error('Database connection failed');
      repository.findMany.mockRejectedValueOnce(error);

      await expect(service.getUserGroups(userId)).rejects.toThrow(
        'Database connection failed',
      );
      expect(repository.findMany).toHaveBeenCalledWith({ userId });
    });
  });

  describe('getUserGroupsByUserIds', () => {
    it('should return user groups for multiple user IDs', async () => {
      const userIds = [1, 2, 3];
      const expectedRoles = [
        { userId: 1, roles: ['ADMIN', 'USER'] },
        { userId: 2, roles: ['USER'] },
        { userId: 3, roles: ['MODERATOR'] },
      ];

      repository.getUserGroupsByUserIds.mockResolvedValueOnce(expectedRoles);

      const result = await service.getUserGroupsByUserIds(userIds);

      expect(result).toEqual(expectedRoles);
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith(userIds);
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no user groups found', async () => {
      const userIds = [999, 888];
      repository.getUserGroupsByUserIds.mockResolvedValueOnce([]);

      const result = await service.getUserGroupsByUserIds(userIds);

      expect(result).toEqual([]);
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith(userIds);
    });

    it('should handle single user ID in array', async () => {
      const userIds = [1];
      const expectedRoles = [{ userId: 1, roles: ['ADMIN'] }];

      repository.getUserGroupsByUserIds.mockResolvedValueOnce(expectedRoles);

      const result = await service.getUserGroupsByUserIds(userIds);

      expect(result).toEqual(expectedRoles);
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith([1]);
    });

    it('should pass array of userIds correctly to repository', async () => {
      const userIds = [10, 20, 30, 40];
      repository.getUserGroupsByUserIds.mockResolvedValueOnce([]);

      await service.getUserGroupsByUserIds(userIds);

      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith([
        10, 20, 30, 40,
      ]);
    });

    it('should handle repository errors', async () => {
      const userIds = [1, 2];
      const error = new Error('Query failed');
      repository.getUserGroupsByUserIds.mockRejectedValueOnce(error);

      await expect(service.getUserGroupsByUserIds(userIds)).rejects.toThrow(
        'Query failed',
      );
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith(userIds);
    });

    it('should handle empty array of userIds', async () => {
      const userIds: number[] = [];
      repository.getUserGroupsByUserIds.mockResolvedValueOnce([]);

      const result = await service.getUserGroupsByUserIds(userIds);

      expect(result).toEqual([]);
      expect(repository.getUserGroupsByUserIds).toHaveBeenCalledWith([]);
    });
  });
});
