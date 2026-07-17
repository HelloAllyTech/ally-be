import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsService } from '../permissions.service';
import { RedisService } from '../../../redis/service/redis.service';
import { GroupService } from '../group.service';
import { GroupPermissionsService } from '../group-permissions.service';
import { UserGroupService } from '../user-group.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let redisService: jest.Mocked<RedisService>;
  let groupService: jest.Mocked<GroupService>;
  let groupPermissionsService: jest.Mocked<GroupPermissionsService>;
  let userGroupService: jest.Mocked<UserGroupService>;

  const mockUserRoles = [
    {
      id: 1,
      name: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      name: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
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
    { groupId: 10, permission: 'user.read' },
    { groupId: 10, permission: 'user.write' },
    { groupId: 20, permission: 'chat.read' },
    { groupId: 20, permission: 'chat.write' },
  ];

  beforeEach(async () => {
    const mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const mockGroupService = {
      getUserRolesByUserId: jest.fn(),
    };

    const mockGroupPermissionsService = {
      getGroupPermissions: jest.fn(),
    };

    const mockUserGroupService = {
      getUserGroups: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: GroupService,
          useValue: mockGroupService,
        },
        {
          provide: GroupPermissionsService,
          useValue: mockGroupPermissionsService,
        },
        {
          provide: UserGroupService,
          useValue: mockUserGroupService,
        },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
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
    const userId = 123;

    it('should return cached user roles if available', async () => {
      const cachedRoles = ['admin', 'user'];
      redisService.get.mockResolvedValue(JSON.stringify(cachedRoles));

      const result = await service.getUserRoles(userId);

      expect(result).toEqual(cachedRoles);
      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId}`);
      expect(groupService.getUserRolesByUserId).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should fetch and cache user roles when not in cache', async () => {
      redisService.get.mockResolvedValue(null);
      groupService.getUserRolesByUserId.mockResolvedValue(mockUserRoles as any);

      const result = await service.getUserRoles(userId);

      expect(result).toEqual(['admin', 'user']);
      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId}`);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(userId);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:roles:${userId}`,
        JSON.stringify(['admin', 'user']),
        1800,
      );
    });

    it('should handle empty roles array', async () => {
      redisService.get.mockResolvedValue(null);
      groupService.getUserRolesByUserId.mockResolvedValue([]);

      const result = await service.getUserRoles(userId);

      expect(result).toEqual([]);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:roles:${userId}`,
        JSON.stringify([]),
        1800,
      );
    });

    it('should handle single role', async () => {
      const singleRole = [
        {
          id: 1,
          name: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      redisService.get.mockResolvedValue(null);
      groupService.getUserRolesByUserId.mockResolvedValue(singleRole as any);

      const result = await service.getUserRoles(userId);

      expect(result).toEqual(['admin']);
    });

    it('should handle different user ids', async () => {
      const userId1 = 100;
      const userId2 = 200;

      redisService.get.mockResolvedValue(null);
      groupService.getUserRolesByUserId.mockResolvedValue(mockUserRoles as any);

      await service.getUserRoles(userId1);
      await service.getUserRoles(userId2);

      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId1}`);
      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId2}`);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledTimes(2);
    });
  });

  describe('isMultiTenantAdmin', () => {
    const userId = 123;

    it('should return true if user has MULTI_TENANT_ADMIN role', async () => {
      redisService.get.mockResolvedValue(
        JSON.stringify(['MULTI_TENANT_ADMIN']),
      );

      const result = await service.isMultiTenantAdmin(userId);

      expect(result).toBe(true);
      expect(redisService.get).toHaveBeenCalledWith(`user:roles:${userId}`);
    });

    it('should return false if user does not have MULTI_TENANT_ADMIN role', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(['LEARNER', 'ADMIN']));

      const result = await service.isMultiTenantAdmin(userId);

      expect(result).toBe(false);
    });

    it('should return false if user has no roles', async () => {
      redisService.get.mockResolvedValue(JSON.stringify([]));

      const result = await service.isMultiTenantAdmin(userId);

      expect(result).toBe(false);
    });
  });

  describe('getUserPermissions', () => {
    const userId = 123;

    it('should return cached permissions when all groups are cached', async () => {
      const cachedGroups = [10, 20];
      redisService.get
        .mockResolvedValueOnce(JSON.stringify(cachedGroups)) // user groups
        .mockResolvedValueOnce(JSON.stringify(['user.read', 'user.write'])) // group 10
        .mockResolvedValueOnce(JSON.stringify(['chat.read', 'chat.write'])); // group 20

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual([
        'user.read',
        'user.write',
        'chat.read',
        'chat.write',
      ]);
      expect(redisService.get).toHaveBeenCalledWith(`user:groups:${userId}`);
      expect(redisService.get).toHaveBeenCalledWith(`group:permissions:10`);
      expect(redisService.get).toHaveBeenCalledWith(`group:permissions:20`);
      expect(
        groupPermissionsService.getGroupPermissions,
      ).not.toHaveBeenCalled();
    });

    it('should fetch and cache user groups when not in cache', async () => {
      redisService.get
        .mockResolvedValueOnce(null) // user groups not cached
        .mockResolvedValueOnce(JSON.stringify(['user.read', 'user.write']))
        .mockResolvedValueOnce(JSON.stringify(['chat.read', 'chat.write']));

      userGroupService.getUserGroups.mockResolvedValue(mockUserGroups as any);

      const result = await service.getUserPermissions(userId);

      expect(userGroupService.getUserGroups).toHaveBeenCalledWith(userId);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:groups:${userId}`,
        JSON.stringify([10, 20]),
        1800,
      );
      expect(result).toEqual([
        'user.read',
        'user.write',
        'chat.read',
        'chat.write',
      ]);
    });

    it('should return empty array when user has no groups', async () => {
      redisService.get.mockResolvedValueOnce(null);
      userGroupService.getUserGroups.mockResolvedValue([]);

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual([]);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:groups:${userId}`,
        JSON.stringify([]),
        1800,
      );
      expect(
        groupPermissionsService.getGroupPermissions,
      ).not.toHaveBeenCalled();
    });

    it('should fetch and cache permissions for groups not in cache', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20])) // user groups
        .mockResolvedValueOnce(null) // group 10 not cached
        .mockResolvedValueOnce(null); // group 20 not cached

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        mockGroupPermissions as any,
      );

      const result = await service.getUserPermissions(userId);

      expect(groupPermissionsService.getGroupPermissions).toHaveBeenCalledWith([
        10, 20,
      ]);
      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:10`,
        JSON.stringify(['user.read', 'user.write']),
        1800,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:20`,
        JSON.stringify(['chat.read', 'chat.write']),
        1800,
      );
      expect(result).toEqual([
        'user.read',
        'user.write',
        'chat.read',
        'chat.write',
      ]);
    });

    it('should handle mix of cached and non-cached group permissions', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20, 30])) // user groups
        .mockResolvedValueOnce(JSON.stringify(['user.read', 'user.write'])) // group 10 cached
        .mockResolvedValueOnce(null) // group 20 not cached
        .mockResolvedValueOnce(null); // group 30 not cached

      const missingPermissions = [
        { groupId: 20, permission: 'chat.read' },
        { groupId: 20, permission: 'chat.write' },
        { groupId: 30, permission: 'admin.full' },
      ];

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        missingPermissions as any,
      );

      const result = await service.getUserPermissions(userId);

      expect(groupPermissionsService.getGroupPermissions).toHaveBeenCalledWith([
        20, 30,
      ]);
      expect(result).toContain('user.read');
      expect(result).toContain('user.write');
      expect(result).toContain('chat.read');
      expect(result).toContain('chat.write');
      expect(result).toContain('admin.full');
      expect(result).toHaveLength(5);
    });

    it('should deduplicate permissions from multiple groups', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20])) // user groups
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const duplicatePermissions = [
        { groupId: 10, permission: 'user.read' },
        { groupId: 10, permission: 'user.write' },
        { groupId: 20, permission: 'user.read' }, // duplicate
        { groupId: 20, permission: 'chat.read' },
      ];

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        duplicatePermissions as any,
      );

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual(['user.read', 'user.write', 'chat.read']);
      expect(result).toHaveLength(3);
    });

    it('should handle single group with single permission', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10]))
        .mockResolvedValueOnce(null);

      groupPermissionsService.getGroupPermissions.mockResolvedValue([
        { groupId: 10, permission: 'user.read' },
      ] as any);

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual(['user.read']);
    });

    it('should handle groups with no permissions', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20]))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      groupPermissionsService.getGroupPermissions.mockResolvedValue([]);

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual([]);
    });

    it('should cache multiple groups in parallel', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10, 20, 30]))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const permissions = [
        { groupId: 10, permission: 'perm1' },
        { groupId: 20, permission: 'perm2' },
        { groupId: 30, permission: 'perm3' },
      ];

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        permissions as any,
      );

      await service.getUserPermissions(userId);

      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:10`,
        JSON.stringify(['perm1']),
        1800,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:20`,
        JSON.stringify(['perm2']),
        1800,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:30`,
        JSON.stringify(['perm3']),
        1800,
      );
    });

    it('should handle cached user groups with empty array', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify([]));

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual([]);
      expect(userGroupService.getUserGroups).not.toHaveBeenCalled();
    });

    it('should group multiple permissions for same group correctly', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10]))
        .mockResolvedValueOnce(null);

      const multiplePermissions = [
        { groupId: 10, permission: 'perm1' },
        { groupId: 10, permission: 'perm2' },
        { groupId: 10, permission: 'perm3' },
      ];

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        multiplePermissions as any,
      );

      const result = await service.getUserPermissions(userId);

      expect(result).toEqual(['perm1', 'perm2', 'perm3']);
      expect(redisService.set).toHaveBeenCalledWith(
        `group:permissions:10`,
        JSON.stringify(['perm1', 'perm2', 'perm3']),
        1800,
      );
    });

    it('should handle large number of groups', async () => {
      const manyGroups = Array.from({ length: 10 }, (_, i) => i + 1);
      redisService.get.mockResolvedValue(null);

      userGroupService.getUserGroups.mockResolvedValue(
        manyGroups.map((groupId) => ({
          id: groupId,
          userId,
          groupId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as any,
      );

      groupPermissionsService.getGroupPermissions.mockResolvedValue(
        manyGroups.map((groupId) => ({
          groupId,
          permission: `perm${groupId}`,
        })) as any,
      );

      const result = await service.getUserPermissions(userId);

      expect(result).toHaveLength(10);
      expect(groupPermissionsService.getGroupPermissions).toHaveBeenCalledWith(
        manyGroups,
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should handle concurrent permission requests', async () => {
      redisService.get
        .mockResolvedValueOnce(JSON.stringify([10]))
        .mockResolvedValueOnce(JSON.stringify(['user.read']))
        .mockResolvedValueOnce(JSON.stringify([10]))
        .mockResolvedValueOnce(JSON.stringify(['user.read']))
        .mockResolvedValueOnce(JSON.stringify([10]))
        .mockResolvedValueOnce(JSON.stringify(['user.read']));

      const promises = [
        service.getUserPermissions(123),
        service.getUserPermissions(456),
        service.getUserPermissions(789),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(redisService.get).toHaveBeenCalled();
    });
  });
});
