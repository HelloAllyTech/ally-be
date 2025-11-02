import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsService } from '../permissions.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';
import { GroupPermissionsService } from '../group-permissions.service';
import { UserGroupService } from '../user-group.service';

import { Permission } from 'src/common/entities/permission.entity';
import { UserRole } from 'src/common/constants/user.constants';
import { DeleteResult } from 'typeorm';
import { PermissionRepository } from 'src/authorization/repository/permission.repository';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepository: jest.Mocked<PermissionRepository>;
  let redisService: jest.Mocked<RedisService>;
  let groupService: jest.Mocked<GroupService>;
  let groupPermissionsService: jest.Mocked<GroupPermissionsService>;
  let userGroupService: jest.Mocked<UserGroupService>;

  const mockPermission: Permission = {
    id: 1,
    name: 'delete:permission',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserRoles = [
    { id: 1, name: 'admin', createdAt: new Date(), updatedAt: new Date() },
    { id: 2, name: 'user', createdAt: new Date(), updatedAt: new Date() },
  ];

  const mockUserGroups = [
    {
      id: 1,
      userId: 123,
      groupId: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      userId: 123,
      groupId: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockGroupPermissions = [
    {
      id: 1,
      groupId: 10,
      permissionId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      groupId: 20,
      permissionId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockGroups = [
    {
      id: 10,
      name: UserRole.ADMIN,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 20,
      name: UserRole.ADMIN,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const deleteResultMock: DeleteResult = {
    raw: [],
    affected: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: PermissionRepository,
          useValue: {
            getPermissionByName: jest.fn(),
            createPermission: jest.fn(),
            deletePermissionById: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: GroupService,
          useValue: {
            getUserRolesByUserId: jest.fn(),
            getGroupsByNames: jest.fn(),
          },
        },
        {
          provide: GroupPermissionsService,
          useValue: {
            getGroupPermissions: jest.fn(),
            findByPermissionId: jest.fn(),
            createGroupPermission: jest.fn(),
            deleteGroupsPermission: jest.fn(),
          },
        },
        {
          provide: UserGroupService,
          useValue: {
            getUserGroups: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    permissionRepository = module.get(PermissionRepository);
    redisService = module.get(RedisService);
    groupService = module.get(GroupService);
    groupPermissionsService = module.get(GroupPermissionsService);
    userGroupService = module.get(UserGroupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserRoles', () => {
    it('should get user roles from cache', async () => {
      const userId = 123;
      const cachedRoles = ['admin', 'user'];
      redisService.get.mockResolvedValue(JSON.stringify(cachedRoles));

      const result = await service.getUserRoles(userId);

      expect(result).toEqual(cachedRoles);
      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId}`);
    });

    it('should fetch and cache user roles', async () => {
      const userId = 123;
      redisService.get.mockResolvedValue(null);
      groupService.getUserRolesByUserId.mockResolvedValue(mockUserRoles);

      const result = await service.getUserRoles(userId);

      expect(result).toEqual(['admin', 'user']);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:roles:${userId}`,
        JSON.stringify(['admin', 'user']),
      );
    });
  });

  describe('getUserPermissions', () => {
    it('should get user permissions from cached groups and permissions', async () => {
      const userId = 123;
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20]))
        .mockResolvedValueOnce(JSON.stringify(['read:users', 'write:users']))
        .mockResolvedValueOnce(
          JSON.stringify(['read:reports', 'write:reports']),
        );

      const result = await service.getUserPermissions(userId);

      expect(result.sort()).toEqual(
        ['read:users', 'write:users', 'read:reports', 'write:reports'].sort(),
      );
    });

    it('should fetch user groups and cache permissions', async () => {
      const userId = 123;
      const mockPermissions = [
        { groupId: 10, permission: 'read:users' },
        { groupId: 10, permission: 'write:users' },
        { groupId: 20, permission: 'read:reports' },
      ];

      redisService.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      userGroupService.getUserGroups.mockResolvedValue(mockUserGroups);
      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        mockPermissions,
      );

      const result = await service.getUserPermissions(userId);

      expect(result.sort()).toEqual(
        ['read:users', 'write:users', 'read:reports'].sort(),
      );
      expect(redisService.set).toHaveBeenCalledWith(
        `user:groups:${userId}`,
        JSON.stringify([10, 20]),
        1800,
      );
    });
  });

  describe('createPermission', () => {
    it('should create a new permission successfully', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(null);
      permissionRepository.createPermission.mockResolvedValue(mockPermission);

      const result = await service.createPermission({
        permissionName: 'delete:permission',
      });

      expect(result).toEqual(mockPermission);
      expect(permissionRepository.createPermission).toHaveBeenCalledWith(
        'delete:permission',
      );
    });
  });

  describe('grantPermissionToRoles', () => {
    it('should grant permission to new roles successfully', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValue([mockGroups[0]]);
      groupPermissionsService.findByPermissionId.mockResolvedValue([]);

      groupPermissionsService.createGroupPermission.mockResolvedValue([
        mockGroupPermissions[0],
      ]);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.grantPermissionToRoles({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN],
      });

      expect(result.message).toContain('granted to roles');
      expect(
        groupPermissionsService.createGroupPermission,
      ).toHaveBeenCalledWith([10], 1);
      expect(redisService.del).toHaveBeenCalledWith(`group:permissions:10`);
    });

    it('should grant permission to multiple roles', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValue(mockGroups);
      groupPermissionsService.findByPermissionId.mockResolvedValue([]);
      groupPermissionsService.createGroupPermission.mockResolvedValue(
        mockGroupPermissions,
      );
      redisService.del.mockResolvedValue(undefined);

      const result = await service.grantPermissionToRoles({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN],
      });

      expect(result.message).toContain('granted to roles');
      expect(
        groupPermissionsService.createGroupPermission,
      ).toHaveBeenCalledWith([10, 20], 1);
    });

    it('should grant permission only to roles that do not have it', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValue(mockGroups);
      groupPermissionsService.findByPermissionId.mockResolvedValue([
        mockGroupPermissions[0],
      ]);

      groupPermissionsService.createGroupPermission.mockResolvedValue([
        mockGroupPermissions[1],
      ]);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.grantPermissionToRoles({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN],
      });

      expect(result.message).toContain('granted to roles');
      expect(
        groupPermissionsService.createGroupPermission,
      ).toHaveBeenCalledWith([20], 1);
    });
  });

  describe('deleteGroupsPermission', () => {
    it('should delete permission from roles successfully', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValue([mockGroups[0]]);
      groupPermissionsService.deleteGroupsPermission.mockResolvedValue(
        deleteResultMock,
      );
      redisService.del.mockResolvedValue(undefined);

      const result = await service.deleteGroupsPermission({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN],
      });

      expect(result.Message).toContain('deleted successfully');
      expect(
        groupPermissionsService.deleteGroupsPermission,
      ).toHaveBeenCalledWith(1, [10]);
      expect(redisService.del).toHaveBeenCalledWith(`group:permissions:10`);
    });

    it('should delete permission from multiple roles', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValue(mockGroups);
      groupPermissionsService.deleteGroupsPermission.mockResolvedValue(
        deleteResultMock,
      );
      redisService.del.mockResolvedValue(undefined);

      const result = await service.deleteGroupsPermission({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN],
      });

      expect(result.Message).toContain('deleted successfully');
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('deletePermission', () => {
    it('should delete permission and invalidate all caches', async () => {
      permissionRepository.getPermissionByName.mockResolvedValue(
        mockPermission,
      );
      groupPermissionsService.findByPermissionId.mockResolvedValue(
        mockGroupPermissions,
      );

      groupPermissionsService.deleteGroupsPermission.mockResolvedValue(
        deleteResultMock,
      );
      permissionRepository.deletePermissionById.mockResolvedValue(
        deleteResultMock,
      );
      redisService.del.mockResolvedValue(undefined);

      const result = await service.deletePermission({
        permissionName: 'delete:permission',
      });

      expect(result.Message).toContain('deleted successfully');
      expect(permissionRepository.deletePermissionById).toHaveBeenCalledWith(1);
      expect(redisService.del).toHaveBeenCalledWith(`group:permissions:10`);
      expect(redisService.del).toHaveBeenCalledWith(`group:permissions:20`);
    });
  });

  describe('Complete Workflow', () => {
    it('should create, grant, and delete permission in sequence', async () => {
      permissionRepository.getPermissionByName.mockResolvedValueOnce(null);
      permissionRepository.createPermission.mockResolvedValueOnce(
        mockPermission,
      );

      const createResult = await service.createPermission({
        permissionName: 'delete:permission',
      });
      expect(createResult.id).toBe(1);

      permissionRepository.getPermissionByName.mockResolvedValueOnce(
        mockPermission,
      );
      groupService.getGroupsByNames.mockResolvedValueOnce(mockGroups);
      groupPermissionsService.findByPermissionId.mockResolvedValueOnce([]);
      groupPermissionsService.createGroupPermission.mockResolvedValueOnce(
        mockGroupPermissions,
      );
      redisService.del.mockResolvedValueOnce(undefined);
      redisService.del.mockResolvedValueOnce(undefined);

      const grantResult = await service.grantPermissionToRoles({
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN],
      });
      expect(grantResult.message).toContain('granted to roles');

      permissionRepository.getPermissionByName.mockResolvedValueOnce(
        mockPermission,
      );
      groupPermissionsService.findByPermissionId.mockResolvedValueOnce(
        mockGroupPermissions,
      );
      groupPermissionsService.deleteGroupsPermission.mockResolvedValueOnce(
        deleteResultMock,
      );
      permissionRepository.deletePermissionById.mockResolvedValueOnce(
        deleteResultMock,
      );
      redisService.del.mockResolvedValue(undefined);

      const deleteResult = await service.deletePermission({
        permissionName: 'delete:permission',
      });
      expect(deleteResult.Message).toContain('deleted successfully');
    });

    it('should get user permissions after granting to roles', async () => {
      const userId = 123;

      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20]))
        .mockResolvedValueOnce(
          JSON.stringify(['delete:permission', 'edit:permission']),
        )
        .mockResolvedValueOnce(
          JSON.stringify(['delete:permission', 'read:permission']),
        );

      const result = await service.getUserPermissions(userId);

      expect(result).toContain('delete:permission');
      expect(result).toContain('edit:permission');
      expect(result).toContain('read:permission');
      expect(result).toHaveLength(3);
    });
  });
});
