import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { GroupPermissionsRepository } from '../group-permissions.repository';
import { GroupPermission } from 'src/authorization/entity/group-permission.entity';

describe('GroupPermissionsRepository', () => {
  let repository: GroupPermissionsRepository;
  let dataSource: jest.Mocked<DataSource>;

  const mockQueryBuilder: Partial<SelectQueryBuilder<GroupPermission>> = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };

  beforeEach(async () => {
    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn(() => mockQueryBuilder),
      }),
    };

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupPermissionsRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<GroupPermissionsRepository>(
      GroupPermissionsRepository,
    );

    // Spy on inherited Repository methods
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findPermissionsByGroupId', () => {
    it('should find permissions for given group IDs', async () => {
      const groupIds = [1, 2];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 1, permission: 'WRITE_USER' },
        { groupId: 2, permission: 'READ_POST' },
      ];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
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

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

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

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce(
        expectedPermissions,
      );

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

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(result).toHaveLength(2);
    });

    it('should call all query builder methods in correct order', async () => {
      const groupIds = [1];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      await repository.findPermissionsByGroupId(groupIds);

      expect(repository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should return correct structure with groupId and permission properties', async () => {
      const groupIds = [1];
      const expectedPermissions = [{ groupId: 1, permission: 'ADMIN' }];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await repository.findPermissionsByGroupId(groupIds);

      expect(result[0]).toHaveProperty('groupId');
      expect(result[0]).toHaveProperty('permission');
      expect(typeof result[0].groupId).toBe('number');
      expect(typeof result[0].permission).toBe('string');
    });

    it('should use entity manager if provided', async () => {
      const groupIds = [1, 2];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 2, permission: 'WRITE_USER' },
      ];

      const mockEmQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedPermissions),
      };

      const emRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(mockEmQueryBuilder),
      };

      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue(emRepository),
      } as any;

      const result = await repository.findPermissionsByGroupId(
        groupIds,
        mockEntityManager,
      );

      expect(result).toEqual(expectedPermissions);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        GroupPermission,
      );
      expect(emRepository.createQueryBuilder).toHaveBeenCalledWith(
        'group_permissions',
      );
      expect(mockEmQueryBuilder.getRawMany).toHaveBeenCalled();
    });
  });
});
