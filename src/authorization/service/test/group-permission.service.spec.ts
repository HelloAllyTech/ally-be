import { Test, TestingModule } from '@nestjs/testing';
import { GroupPermissionsService } from '../group-permissions.service';
import { GroupPermissionsRepository } from 'src/authorization/repository/group-permissions.repository';

describe('GroupPermissionsService', () => {
  let service: GroupPermissionsService;
  let repository: jest.Mocked<GroupPermissionsRepository>;

  beforeEach(async () => {
    // Create mock repository
    const mockRepository = {
      findPermissionsByGroupId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupPermissionsService,
        {
          provide: GroupPermissionsRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<GroupPermissionsService>(GroupPermissionsService);
    repository = module.get(GroupPermissionsRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getGroupPermissions', () => {
    it('should return permissions for given group IDs', async () => {
      const groupIds = [1, 2];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 1, permission: 'WRITE_USER' },
        { groupId: 2, permission: 'READ_POST' },
      ];

      repository.findPermissionsByGroupId.mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await service.getGroupPermissions(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith(
        groupIds,
      );
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no permissions found', async () => {
      const groupIds = [999];
      repository.findPermissionsByGroupId.mockResolvedValueOnce([]);

      const result = await service.getGroupPermissions(groupIds);

      expect(result).toEqual([]);
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith([999]);
    });

    it('should handle single group ID in array', async () => {
      const groupIds = [1];
      const expectedPermissions = [
        { groupId: 1, permission: 'ADMIN' },
        { groupId: 1, permission: 'ADMIN' },
      ];

      repository.findPermissionsByGroupId.mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await service.getGroupPermissions(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(result).toHaveLength(2);
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith([1]);
    });

    it('should handle multiple group IDs', async () => {
      const groupIds = [1, 2, 3, 4, 5];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ_USER' },
        { groupId: 2, permission: 'WRITE_USER' },
        { groupId: 3, permission: 'DELETE_USER' },
        { groupId: 4, permission: 'READ_POST' },
        { groupId: 5, permission: 'WRITE_POST' },
      ];

      repository.findPermissionsByGroupId.mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await service.getGroupPermissions(groupIds);

      expect(result).toEqual(expectedPermissions);
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith([
        1, 2, 3, 4, 5,
      ]);
    });

    it('should pass array of groupIds correctly to repository', async () => {
      const groupIds = [10, 20, 30];
      repository.findPermissionsByGroupId.mockResolvedValueOnce([]);

      await service.getGroupPermissions(groupIds);

      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith([
        10, 20, 30,
      ]);
    });

    it('should handle empty array of groupIds', async () => {
      const groupIds: number[] = [];
      repository.findPermissionsByGroupId.mockResolvedValueOnce([]);

      const result = await service.getGroupPermissions(groupIds);

      expect(result).toEqual([]);
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith([]);
    });

    it('should handle repository errors', async () => {
      const groupIds = [1, 2];
      const error = new Error('Database query failed');
      repository.findPermissionsByGroupId.mockRejectedValueOnce(error);

      await expect(service.getGroupPermissions(groupIds)).rejects.toThrow(
        'Database query failed',
      );
      expect(repository.findPermissionsByGroupId).toHaveBeenCalledWith(
        groupIds,
      );
    });

    it('should return permissions with correct structure', async () => {
      const groupIds = [1];
      const expectedPermissions = [{ groupId: 1, permission: 'ADMIN' }];

      repository.findPermissionsByGroupId.mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await service.getGroupPermissions(groupIds);

      expect(result[0]).toHaveProperty('groupId');
      expect(result[0]).toHaveProperty('permission');
      expect(typeof result[0].groupId).toBe('number');
      expect(typeof result[0].permission).toBe('string');
    });

    it('should not modify the data returned from repository', async () => {
      const groupIds = [1];
      const expectedPermissions = [
        { groupId: 1, permission: 'READ' },
        { groupId: 1, permission: 'WRITE' },
      ];

      repository.findPermissionsByGroupId.mockResolvedValueOnce(
        expectedPermissions,
      );

      const result = await service.getGroupPermissions(groupIds);

      // Verify that the service returns exactly what repository returns
      expect(result).toBe(expectedPermissions);
      expect(result).toEqual(expectedPermissions);
    });
  });
});
