import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationController } from '../authorization.controller';
import { PermissionsService } from '../../service/permissions.service';
import { GroupService } from '../../service/group.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ExecutionContext } from '@nestjs/common';
import { ChangeUserRolesDto } from '../../../user/dto/group.dto';
import { PERMISSIONS } from '../../constants/permissions.constants';

describe('AuthorizationController', () => {
  let controller: AuthorizationController;
  let permissionsService: jest.Mocked<PermissionsService>;
  let groupService: jest.Mocked<GroupService>;

  const mockPermissions = [
    'user.read',
    'user.write',
    'chat.read',
    'chat.write',
  ];

  const mockRequest = {
    user: {
      id: '123',
      email: 'test@example.com',
      role: 'admin',
    },
  };

  beforeEach(async () => {
    const mockPermissionsService = {
      getUserPermissions: jest.fn(),
    };

    const mockGroupService = {
      changeUserRoles: jest.fn(),
      getAllRoles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthorizationController],
      providers: [
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: GroupService,
          useValue: mockGroupService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.user = mockRequest.user;
          return true;
        },
      })
      .compile();

    controller = module.get<AuthorizationController>(AuthorizationController);
    permissionsService = module.get(PermissionsService);
    groupService = module.get(GroupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPermissions', () => {
    it('should return user permissions successfully', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(mockPermissions);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(1);
    });

    it('should parse string user id to integer', async () => {
      const request = {
        user: {
          id: '456',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(456);
    });

    it('should return empty array when user has no permissions', async () => {
      permissionsService.getUserPermissions.mockResolvedValue([]);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual([]);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle large user id numbers', async () => {
      const request = {
        user: {
          id: '999999999',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        999999999,
      );
    });

    it('should propagate errors from permissions service', async () => {
      const error = new Error('Database connection failed');
      permissionsService.getUserPermissions.mockRejectedValue(error);

      await expect(controller.getPermissions(mockRequest)).rejects.toThrow(
        'Database connection failed',
      );
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle permission service returning null', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(null as any);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toBeNull();
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle permission service returning undefined', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(undefined as any);

      const result = await controller.getPermissions(mockRequest);

      expect(result).toBeUndefined();
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(123);
    });

    it('should handle different permission arrays', async () => {
      const customPermissions = ['admin.full', 'system.manage'];
      permissionsService.getUserPermissions.mockResolvedValue(
        customPermissions,
      );

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(customPermissions);
      expect(result).toHaveLength(2);
    });

    it('should handle numeric string conversion edge cases', async () => {
      const request = {
        user: {
          id: '0',
        },
      };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(request);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(0);
    });

    it('should call service only once per request', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await controller.getPermissions(mockRequest);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe('changeUserRoles', () => {
    const mockChangeUserRolesDto: ChangeUserRolesDto = {
      userId: 123,
      groupIds: [1, 2, 3],
    };

    const mockSuccessResponse = {
      success: true,
      message: 'User roles updated successfully',
    };

    it('should change user roles successfully', async () => {
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      const result = await controller.changeUserRoles(mockChangeUserRolesDto);

      expect(result).toEqual(mockSuccessResponse);
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(
        mockChangeUserRolesDto,
      );
      expect(groupService.changeUserRoles).toHaveBeenCalledTimes(1);
    });

    it('should handle different user IDs', async () => {
      const differentDto = { userId: 456, groupIds: [2, 4] };
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      const result = await controller.changeUserRoles(differentDto);

      expect(result).toEqual(mockSuccessResponse);
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(differentDto);
    });

    it('should handle different group IDs', async () => {
      const differentDto = { userId: 123, groupIds: [5, 6, 7, 8] };
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      const result = await controller.changeUserRoles(differentDto);

      expect(result).toEqual(mockSuccessResponse);
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(differentDto);
    });

    it('should propagate errors from group service', async () => {
      const error = new Error('User not found');
      groupService.changeUserRoles.mockRejectedValue(error);

      await expect(
        controller.changeUserRoles(mockChangeUserRolesDto),
      ).rejects.toThrow('User not found');
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(
        mockChangeUserRolesDto,
      );
    });

    it('should handle service returning null', async () => {
      groupService.changeUserRoles.mockResolvedValue(null as any);

      const result = await controller.changeUserRoles(mockChangeUserRolesDto);

      expect(result).toBeNull();
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(
        mockChangeUserRolesDto,
      );
    });

    it('should handle service returning undefined', async () => {
      groupService.changeUserRoles.mockResolvedValue(undefined as any);

      const result = await controller.changeUserRoles(mockChangeUserRolesDto);

      expect(result).toBeUndefined();
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(
        mockChangeUserRolesDto,
      );
    });

    it('should handle empty group IDs array', async () => {
      const emptyDto = { userId: 123, groupIds: [] };
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      const result = await controller.changeUserRoles(emptyDto);

      expect(result).toEqual(mockSuccessResponse);
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(emptyDto);
    });

    it('should handle single group ID', async () => {
      const singleGroupDto = { userId: 123, groupIds: [1] };
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      const result = await controller.changeUserRoles(singleGroupDto);

      expect(result).toEqual(mockSuccessResponse);
      expect(groupService.changeUserRoles).toHaveBeenCalledWith(singleGroupDto);
    });

    it('should call service only once per request', async () => {
      groupService.changeUserRoles.mockResolvedValue(mockSuccessResponse);

      await controller.changeUserRoles(mockChangeUserRolesDto);

      expect(groupService.changeUserRoles).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllRoles', () => {
    const mockRoles = [
      { id: 1, name: 'admin', createdAt: new Date(), updatedAt: new Date() },
      {
        id: 2,
        name: 'counselor',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { id: 3, name: 'learner', createdAt: new Date(), updatedAt: new Date() },
    ];

    it('should return all roles successfully', async () => {
      groupService.getAllRoles.mockResolvedValue(mockRoles);

      const result = await controller.getAllRoles();

      expect(result).toEqual(mockRoles);
      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no roles exist', async () => {
      groupService.getAllRoles.mockResolvedValue([]);

      const result = await controller.getAllRoles();

      expect(result).toEqual([]);
      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from group service', async () => {
      const error = new Error('Database connection failed');
      groupService.getAllRoles.mockRejectedValue(error);

      await expect(controller.getAllRoles()).rejects.toThrow(
        'Database connection failed',
      );
      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });

    it('should handle service returning null', async () => {
      groupService.getAllRoles.mockResolvedValue(null as any);

      const result = await controller.getAllRoles();

      expect(result).toBeNull();
      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });

    it('should handle service returning undefined', async () => {
      groupService.getAllRoles.mockResolvedValue(undefined as any);

      const result = await controller.getAllRoles();

      expect(result).toBeUndefined();
      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });

    it('should handle different role structures', async () => {
      const customRoles = [
        {
          id: 10,
          name: 'super_admin',
          description: 'Full system access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 11,
          name: 'moderator',
          description: 'Content moderation',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      groupService.getAllRoles.mockResolvedValue(customRoles);

      const result = await controller.getAllRoles();

      expect(result).toEqual(customRoles);
      expect(result).toHaveLength(2);
    });

    it('should call service only once per request', async () => {
      groupService.getAllRoles.mockResolvedValue(mockRoles);

      await controller.getAllRoles();

      expect(groupService.getAllRoles).toHaveBeenCalledTimes(1);
    });
  });

  describe('Controller metadata', () => {
    it('should have correct route path', () => {
      const metadata = Reflect.getMetadata('path', AuthorizationController);
      expect(metadata).toBe('v1/authorization');
    });

    it('should have JwtAuthGuard applied to getPermissions', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        controller.getPermissions,
      );
      expect(guards).toBeDefined();
    });

    it('should have correct HTTP method for changeUserRoles', () => {
      const method = Reflect.getMetadata('method', controller.changeUserRoles);
      expect(method).toBe(1); // 1 = POST method
    });

    it('should have correct route path for changeUserRoles', () => {
      const path = Reflect.getMetadata('path', controller.changeUserRoles);
      expect(path).toBe('change-roles');
    });

    it('should have correct HTTP method for getAllRoles', () => {
      const method = Reflect.getMetadata('method', controller.getAllRoles);
      expect(method).toBe(0); // 0 = GET method
    });

    it('should have correct route path for getAllRoles', () => {
      const path = Reflect.getMetadata('path', controller.getAllRoles);
      expect(path).toBe('roles');
    });

    it('should be decorated with ApiTags', () => {
      const tags = Reflect.getMetadata(
        'swagger/apiUseTags',
        AuthorizationController,
      );
      expect(tags).toEqual(['Authorization']);
    });
  });

  describe('AuthPermissions decorator', () => {
    it('should have correct permissions for changeUserRoles', () => {
      const permissions = Reflect.getMetadata(
        'permissions',
        controller.changeUserRoles,
      );
      expect(permissions).toEqual({
        permissions: [PERMISSIONS.EDIT_USER_ROLE],
        operator: 'AND',
      });
    });

    it('should have correct permissions for getAllRoles', () => {
      const permissions = Reflect.getMetadata(
        'permissions',
        controller.getAllRoles,
      );
      expect(permissions).toEqual({
        permissions: [PERMISSIONS.VIEW_USER_ROLES],
        operator: 'AND',
      });
    });

    it('should verify EDIT_USER_ROLE permission constant exists', () => {
      expect(PERMISSIONS.EDIT_USER_ROLE).toBe('edit:user:role');
    });

    it('should verify VIEW_USER_ROLES permission constant exists', () => {
      expect(PERMISSIONS.VIEW_USER_ROLES).toBe('view:user:roles');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle rapid successive calls', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const promises = [
        controller.getPermissions(mockRequest),
        controller.getPermissions(mockRequest),
        controller.getPermissions(mockRequest),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toEqual(mockPermissions);
      });
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(3);
    });

    it('should handle different user ids in parallel', async () => {
      const request1 = { user: { id: '100' } };
      const request2 = { user: { id: '200' } };
      const request3 = { user: { id: '300' } };

      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      await Promise.all([
        controller.getPermissions(request1),
        controller.getPermissions(request2),
        controller.getPermissions(request3),
      ]);

      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(100);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(200);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(300);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(3);
    });

    it('should maintain correct behavior with service timeout', async () => {
      jest.setTimeout(10000);

      permissionsService.getUserPermissions.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockPermissions), 100),
          ),
      );

      const result = await controller.getPermissions(mockRequest);

      expect(result).toEqual(mockPermissions);
    });
  });
});
