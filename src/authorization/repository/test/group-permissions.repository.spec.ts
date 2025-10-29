import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { GroupPermissionsRepository } from '../group-permissions.repository';
import { GroupPermission } from 'src/common/entities/group-permission.entity';

describe('GroupPermissionsRepository', () => {
  let repository: GroupPermissionsRepository;
  let mockRepo: jest.Mocked<Repository<GroupPermission>>;

  beforeEach(async () => {
    // Create mock query builder
    const mockQueryBuilder: Partial<SelectQueryBuilder<GroupPermission>> = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupPermissionsRepository,
        {
          provide: getRepositoryToken(GroupPermission),
          useValue: {
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
          },
        },
      ],
    }).compile();

    repository = module.get<GroupPermissionsRepository>(
      GroupPermissionsRepository,
    );
    mockRepo = module.get(getRepositoryToken(GroupPermission));
  });

  describe('findPermissionsByGroupId', () => {
    it('should find permissions for given group IDs', async () => {
      const groupIds = [1, 2];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 1, permission: 'WRITE_USER' },
        { groupId: 2, permission: 'READ_POST' },
      ];

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedPermissions),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith(
        'group_permissions',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        expect.anything(),
        'permission',
        'permission.id = group_permissions.permissionId',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'group_permissions.groupId',
        'groupId',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'permission.name',
        'permission',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'group_permissions.groupId IN (:...groupIds)',
        { groupIds },
      );
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should return empty array when no permissions found', async () => {
      const groupIds = [999];

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce([]),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should handle multiple group IDs correctly', async () => {
      const groupIds = [1, 2, 3, 4, 5];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 2, permission: 'WRITE_USER' },
        { groupId: 3, permission: 'DELETE_USER' },
        { groupId: 4, permission: 'READ_POST' },
        { groupId: 5, permission: 'WRITE_POST' },
      ];

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedPermissions),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'group_permissions.groupId IN (:...groupIds)',
        { groupIds: [1, 2, 3, 4, 5] },
      );
    });

    it('should handle single group ID in array', async () => {
      const groupIds = [1];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 1, permission: 'WRITE_USER' },
      ];

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedPermissions),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(result).toHaveLength(2);
    });

    it('should call all query builder methods in correct order', async () => {
      const groupIds = [1];
      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce([]),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      await repository.findPermissionsByGroupId(groupIds);

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should return correct structure with groupId and permission properties', async () => {
      const groupIds = [1];
      const expectedPermissions = [{ groupId: 1, permission: 'ADMIN' }];

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedPermissions),
      };

      mockRepo.createQueryBuilder.mockReturnValueOnce(mockQueryBuilder as any);

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result[0]).toHaveProperty('groupId');
      expect(result[0]).toHaveProperty('permission');
      expect(typeof result[0].groupId).toBe('number');
      expect(typeof result[0].permission).toBe('string');
    });
  });
});
