import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationController } from '../authorization.controller';
import { PermissionsService } from '../../service/permissions.service';
import { GroupService } from '../../service/group.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ExecutionContext } from '@nestjs/common';
import { ChangeUserRolesDto } from '../../../user/dto/group.dto';
import {
  CreatePermissionDto,
  DeleteGroupsPermissionDto,
  DeletePermissionDto,
  GrantPermissionToRolesDto,
} from '../../dto/permissions.dto';
import { UserRole } from 'src/common/constants/user.constants';

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

  const mockRoles = [
    { id: 1, name: 'admin' },
    { id: 2, name: 'counselor' },
    { id: 3, name: 'learner' },
  ];

  const mockSuccessResponse = {
    success: true,
    message: 'User roles updated successfully',
  };

  const mockPermissionResponse = {
    id: 1,
    name: 'delete:permission',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGrantResponse = {
    message: 'Permission "delete:permission" granted to roles',
  };

  const mockDeleteResponse = {
    Message: 'Permission "delete:permission"deleted successfully',
  };

  beforeEach(async () => {
    const mockPermissionsServiceObj = {
      getUserPermissions: jest.fn(),
      createPermission: jest.fn(),
      grantPermissionToRoles: jest.fn(),
      deletePermission: jest.fn(),
      deleteGroupsPermission: jest.fn(),
    };

    const mockGroupServiceObj = {
      changeUserRoles: jest.fn(),
      getAllRoles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthorizationController],
      providers: [
        {
          provide: PermissionsService,
          useValue: mockPermissionsServiceObj,
        },
        {
          provide: GroupService,
          useValue: mockGroupServiceObj,
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

  // ===== getPermissions Tests =====
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

  // ===== changeUserRoles Tests =====
  describe('changeUserRoles', () => {
    const mockChangeUserRolesDto: ChangeUserRolesDto = {
      userId: 123,
      groupIds: [1, 2, 3],
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

  // ===== getAllRoles Tests =====
  describe('getAllRoles', () => {
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

    it('should handle different role structures', async () => {
      const customRoles = [
        { id: 10, name: 'super_admin' },
        { id: 11, name: 'moderator' },
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

  // ===== createPermission Tests =====
  describe('createPermission', () => {
    it('should create permission successfully', async () => {
      const dto: CreatePermissionDto = {
        permissionName: 'delete:permission',
      };

      permissionsService.createPermission.mockResolvedValue(
        mockPermissionResponse,
      );

      const result = await controller.createPermission(dto);

      expect(result).toEqual(mockPermissionResponse);
      expect(permissionsService.createPermission).toHaveBeenCalledWith(dto);
      expect(permissionsService.createPermission).toHaveBeenCalledTimes(1);
    });

    it('should handle different permission names', async () => {
      const dto: CreatePermissionDto = {
        permissionName: 'edit:users:roles',
      };

      permissionsService.createPermission.mockResolvedValue({
        ...mockPermissionResponse,
        name: 'edit:users:roles',
      });

      const result = await controller.createPermission(dto);

      expect(result.name).toBe('edit:users:roles');
      expect(permissionsService.createPermission).toHaveBeenCalledWith(dto);
    });

    it('should propagate errors from service', async () => {
      const dto: CreatePermissionDto = {
        permissionName: 'delete:permission',
      };
      const error = new Error('Permission already exists');
      permissionsService.createPermission.mockRejectedValue(error);

      await expect(controller.createPermission(dto)).rejects.toThrow(
        'Permission already exists',
      );
    });
  });

  // ===== grantPermissionToRoles Tests =====
  describe('grantPermissionToRoles', () => {
    const mockGrantDto: GrantPermissionToRolesDto = {
      permissionName: 'delete:permission',
      roles: [UserRole.ADMIN, UserRole.ADMIN],
    };

    it('should grant permission to roles successfully', async () => {
      permissionsService.grantPermissionToRoles.mockResolvedValue(
        mockGrantResponse,
      );

      const result = await controller.grantPermissionToRoles(mockGrantDto);

      expect(result).toEqual(mockGrantResponse);
      expect(permissionsService.grantPermissionToRoles).toHaveBeenCalledWith(
        mockGrantDto,
      );
      expect(permissionsService.grantPermissionToRoles).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should handle single role', async () => {
      const singleRoleDto: GrantPermissionToRolesDto = {
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN],
      };

      permissionsService.grantPermissionToRoles.mockResolvedValue(
        mockGrantResponse,
      );

      const result = await controller.grantPermissionToRoles(singleRoleDto);

      expect(result).toEqual(mockGrantResponse);
      expect(permissionsService.grantPermissionToRoles).toHaveBeenCalledWith(
        singleRoleDto,
      );
    });

    it('should handle multiple roles', async () => {
      const multiRoleDto: GrantPermissionToRolesDto = {
        permissionName: 'edit:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN, UserRole.COUNSELOR],
      };

      permissionsService.grantPermissionToRoles.mockResolvedValue(
        mockGrantResponse,
      );

      const result = await controller.grantPermissionToRoles(multiRoleDto);

      expect(result).toEqual(mockGrantResponse);
      expect(permissionsService.grantPermissionToRoles).toHaveBeenCalledWith(
        multiRoleDto,
      );
    });

    it('should propagate errors from service', async () => {
      const error = new Error('Permission not found');
      permissionsService.grantPermissionToRoles.mockRejectedValue(error);

      await expect(
        controller.grantPermissionToRoles(mockGrantDto),
      ).rejects.toThrow('Permission not found');
    });
  });

  // ===== deletePermission Tests =====
  describe('deletePermission', () => {
    const mockDeleteDto: DeletePermissionDto = {
      permissionName: 'delete:permission',
    };

    it('should delete permission successfully', async () => {
      permissionsService.deletePermission.mockResolvedValue(mockDeleteResponse);

      const result = await controller.deletePermission(mockDeleteDto);

      expect(result).toEqual(mockDeleteResponse);
      expect(permissionsService.deletePermission).toHaveBeenCalledWith(
        mockDeleteDto,
      );
      expect(permissionsService.deletePermission).toHaveBeenCalledTimes(1);
    });

    it('should handle different permission names', async () => {
      const differentDto: DeletePermissionDto = {
        permissionName: 'edit:permission',
      };

      permissionsService.deletePermission.mockResolvedValue(mockDeleteResponse);

      const result = await controller.deletePermission(differentDto);

      expect(result).toEqual(mockDeleteResponse);
      expect(permissionsService.deletePermission).toHaveBeenCalledWith(
        differentDto,
      );
    });

    it('should propagate errors from service', async () => {
      const error = new Error('Permission not found');
      permissionsService.deletePermission.mockRejectedValue(error);

      await expect(controller.deletePermission(mockDeleteDto)).rejects.toThrow(
        'Permission not found',
      );
    });
  });

  // ===== deleteGroupsPermission Tests =====
  describe('deleteGroupsPermission', () => {
    const mockDeleteGroupDto: DeleteGroupsPermissionDto = {
      permissionName: 'delete:permission',
      roles: [UserRole.ADMIN, UserRole.ADMIN],
    };

    it('should delete group permission successfully', async () => {
      permissionsService.deleteGroupsPermission.mockResolvedValue(
        mockDeleteResponse,
      );

      const result =
        await controller.deleteGroupsPermission(mockDeleteGroupDto);

      expect(result).toEqual(mockDeleteResponse);
      expect(permissionsService.deleteGroupsPermission).toHaveBeenCalledWith(
        mockDeleteGroupDto,
      );
      expect(permissionsService.deleteGroupsPermission).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should handle single role deletion', async () => {
      const singleRoleDto: DeleteGroupsPermissionDto = {
        permissionName: 'delete:permission',
        roles: [UserRole.ADMIN],
      };

      permissionsService.deleteGroupsPermission.mockResolvedValue(
        mockDeleteResponse,
      );

      const result = await controller.deleteGroupsPermission(singleRoleDto);

      expect(result).toEqual(mockDeleteResponse);
      expect(permissionsService.deleteGroupsPermission).toHaveBeenCalledWith(
        singleRoleDto,
      );
    });

    it('should handle multiple roles deletion', async () => {
      const multiRoleDto: DeleteGroupsPermissionDto = {
        permissionName: 'edit:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN, UserRole.COUNSELOR],
      };

      permissionsService.deleteGroupsPermission.mockResolvedValue(
        mockDeleteResponse,
      );

      const result = await controller.deleteGroupsPermission(multiRoleDto);

      expect(result).toEqual(mockDeleteResponse);
      expect(permissionsService.deleteGroupsPermission).toHaveBeenCalledWith(
        multiRoleDto,
      );
    });

    it('should propagate errors from service', async () => {
      const error = new Error('Permission not found');
      permissionsService.deleteGroupsPermission.mockRejectedValue(error);

      await expect(
        controller.deleteGroupsPermission(mockDeleteGroupDto),
      ).rejects.toThrow('Permission not found');
    });
  });

  describe('Integration Workflows', () => {
    it('should handle concurrent user permission requests', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const request1 = { user: { id: '100' } };
      const request2 = { user: { id: '200' } };
      const request3 = { user: { id: '300' } };

      const results = await Promise.all([
        controller.getPermissions(request1),
        controller.getPermissions(request2),
        controller.getPermissions(request3),
      ]);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toEqual(mockPermissions);
      });
      expect(permissionsService.getUserPermissions).toHaveBeenCalledTimes(3);
    });

    it('should handle user roles change and retrieve permissions', async () => {
      groupService.changeUserRoles.mockResolvedValueOnce(mockSuccessResponse);

      const changeDto: ChangeUserRolesDto = {
        userId: 123,
        groupIds: [1, 2],
      };

      const changeResult = await controller.changeUserRoles(changeDto);
      expect(changeResult.success).toBe(true);

      permissionsService.getUserPermissions.mockResolvedValueOnce(
        mockPermissions,
      );

      const permissions = await controller.getPermissions(mockRequest);
      expect(permissions).toEqual(mockPermissions);
    });

    it('should handle complete permission lifecycle', async () => {
      // Create permission
      const createDto: CreatePermissionDto = {
        permissionName: 'test:permission',
      };
      permissionsService.createPermission.mockResolvedValueOnce({
        ...mockPermissionResponse,
        name: 'test:permission',
      });

      const createdPermission = await controller.createPermission(createDto);
      expect(createdPermission.name).toBe('test:permission');

      // Grant permission to roles
      const grantDto: GrantPermissionToRolesDto = {
        permissionName: 'test:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN],
      };
      permissionsService.grantPermissionToRoles.mockResolvedValueOnce(
        mockGrantResponse,
      );

      const grantResult = await controller.grantPermissionToRoles(grantDto);
      expect(grantResult.message).toContain('granted to roles');

      // Delete group permission
      const deleteGroupDto: DeleteGroupsPermissionDto = {
        permissionName: 'test:permission',
        roles: [UserRole.ADMIN],
      };
      permissionsService.deleteGroupsPermission.mockResolvedValueOnce(
        mockDeleteResponse,
      );

      const deleteGroupResult =
        await controller.deleteGroupsPermission(deleteGroupDto);
      expect(deleteGroupResult.Message).toContain('deleted successfully');

      // Delete permission
      const deleteDto: DeletePermissionDto = {
        permissionName: 'test:permission',
      };
      permissionsService.deletePermission.mockResolvedValueOnce(
        mockDeleteResponse,
      );

      const deleteResult = await controller.deletePermission(deleteDto);
      expect(deleteResult.Message).toContain('deleted successfully');
    });

    it('should handle full authorization management workflow', async () => {
      // Get all available roles
      groupService.getAllRoles.mockResolvedValueOnce(mockRoles);

      const roles = await controller.getAllRoles();
      expect(roles).toHaveLength(3);

      // Create new permission
      permissionsService.createPermission.mockResolvedValueOnce(
        mockPermissionResponse,
      );

      const createdPermission = await controller.createPermission({
        permissionName: 'new:permission',
      });
      expect(createdPermission.id).toBe(1);

      // Grant to all roles
      permissionsService.grantPermissionToRoles.mockResolvedValueOnce(
        mockGrantResponse,
      );

      const grantResult = await controller.grantPermissionToRoles({
        permissionName: 'new:permission',
        roles: [UserRole.ADMIN, UserRole.ADMIN, UserRole.COUNSELOR],
      });
      expect(grantResult.message).toContain('granted');
    });

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
