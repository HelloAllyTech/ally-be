import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from '../user.controller';
import { UserService } from '../../service/user.service';
import { GroupService } from 'src/authorization/service/group.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { UserRole } from 'src/common/constants/user.constants';
import { UserStatus } from 'src/user/constants/user-status.constants';
import { AssignUserRoleDto, RemoveUserRoleDto } from '../../dto/group.dto';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { AddUserDto } from '../../dto/add-user.dto';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { UpdateUserStatusDto } from '../../dto/update-user-status.dto';
import { UserSortBy, SortOrder } from '../../enum/user.enum';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  UserListResponseDto,
  UserUpdateResponseDto,
} from '../../dto/user-response.dto';
import { AddUserResponseDto } from '../../dto/user-add-response.dto';
import { AppConfigService } from '../../../config/config.service';
import { UpdateUserPreferencesDto } from 'src/user/dto/update-user-prefernces.dto';
import { AdminTenantService } from '../../service/admin-tenant.service';
import {
  AssignAdminTenantsDto,
  RemoveAdminTenantsDto,
} from '../../dto/admin-tenant.dto';

describe('UserController', () => {
  let controller: UserController;
  let mockUserService: any;
  let mockGroupService: any;
  let mockAdminTenantService: any;

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'testuser',
    tenantId: 'test-tenant',
  };

  const mockUser = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    tenantId: 'test-tenant',
    createdBy: undefined,
    updatedBy: undefined,
    suspendedBy: undefined,
    suspendedAt: undefined,
  };

  const mockMinimalUserInfo = {
    id: 1,
    userId: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
  };

  const mockWaitingList = {
    total_waiting: 2,
    clients: [
      { id: 1, name: 'Client 1' },
      { id: 2, name: 'Client 2' },
    ],
  };

  beforeEach(async () => {
    mockUserService = {
      get: jest.fn(),
      getMinimalUserInfo: jest.fn(),
      getWaitingList: jest.fn(),
      getAllUsers: jest.fn(),
      addUser: jest.fn(),
      bulkAddUsers: jest.fn(),
      completeProfile: jest.fn(),
      updateUser: jest.fn(),
      updateUserStatus: jest.fn(),
      getTermsAndAgreementStatus: jest.fn(),
      approveTermsAndAgreement: jest.fn(),
      updateUserPreferences: jest.fn(),
      getUserPreferences: jest.fn(),
    };

    mockGroupService = {
      assignRole: jest.fn(),
      removeRole: jest.fn(),
    };

    mockAdminTenantService = {
      assignTenants: jest.fn(),
      removeTenants: jest.fn(),
      getTenantsForAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: GroupService, useValue: mockGroupService },
        { provide: AdminTenantService, useValue: mockAdminTenantService },
        { provide: Reflector, useValue: { get: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { checkPermission: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMe', () => {
    it('should return null when user is not found', async () => {
      mockUserService.get.mockResolvedValue(null);

      const result = await controller.getMe(mockTokenUser);

      expect(mockUserService.get).toHaveBeenCalledWith(1);
      expect(mockUserService.getMinimalUserInfo).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return minimal user info when user is found', async () => {
      mockUserService.get.mockResolvedValue(mockUser);
      mockUserService.getMinimalUserInfo.mockReturnValue(mockMinimalUserInfo);

      const result = await controller.getMe(mockTokenUser);

      expect(mockUserService.get).toHaveBeenCalledWith(1);
      expect(mockUserService.getMinimalUserInfo).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockMinimalUserInfo);
    });
  });

  describe('getWaitingList', () => {
    it('should return waiting list', async () => {
      mockUserService.getWaitingList.mockResolvedValue(mockWaitingList);

      const result = await controller.getWaitingList();

      expect(mockUserService.getWaitingList).toHaveBeenCalledWith();
      expect(result).toEqual(mockWaitingList);
    });

    it('should return empty waiting list', async () => {
      const emptyWaitingList = {
        total_waiting: 0,
        clients: [],
      };
      mockUserService.getWaitingList.mockResolvedValue(emptyWaitingList);

      const result = await controller.getWaitingList();

      expect(result).toEqual(emptyWaitingList);
      expect(result.total_waiting).toBe(0);
    });
  });

  describe('assignRole', () => {
    it('should assign role to user', async () => {
      const assignUserRoleDto: AssignUserRoleDto = {
        userId: 1,
        role: UserRole.COUNSELOR,
      };
      mockGroupService.assignRole.mockResolvedValue(true);

      const result = await controller.assignRole(assignUserRoleDto);

      expect(mockGroupService.assignRole).toHaveBeenCalledWith(
        assignUserRoleDto,
      );
      expect(result).toBe(true);
    });

    it('should handle role assignment failure', async () => {
      const assignUserRoleDto: AssignUserRoleDto = {
        userId: 1,
        role: UserRole.ADMIN,
      };
      mockGroupService.assignRole.mockResolvedValue(false);

      const result = await controller.assignRole(assignUserRoleDto);

      expect(result).toBe(false);
    });
  });

  describe('removeRole', () => {
    it('should remove role from user', async () => {
      const removeUserRoleDto: RemoveUserRoleDto = {
        userId: 1,
        role: UserRole.COUNSELOR,
      };
      mockGroupService.removeRole.mockResolvedValue(true);

      const result = await controller.removeRole(removeUserRoleDto);

      expect(mockGroupService.removeRole).toHaveBeenCalledWith(
        removeUserRoleDto,
      );
      expect(result).toBe(true);
    });

    it('should handle role removal failure', async () => {
      const removeUserRoleDto: RemoveUserRoleDto = {
        userId: 1,
        role: UserRole.ADMIN,
      };
      mockGroupService.removeRole.mockResolvedValue(false);

      const result = await controller.removeRole(removeUserRoleDto);

      expect(result).toBe(false);
    });
  });

  describe('getAllUsers', () => {
    it('should return all users with default sorting', async () => {
      const mockUserList: UserListResponseDto = {
        data: [mockUser as any],
        count: 1,
      };
      mockUserService.getAllUsers.mockResolvedValue(mockUserList);

      const result = await controller.getAllUsers();

      expect(mockUserService.getAllUsers).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        sortBy: UserSortBy.CREATED_AT,
        order: SortOrder.DESC,
        tenantIds: undefined,
        roles: undefined,
        statuses: undefined,
        search: undefined,
        includePlatformAdmins: false,
      });
      expect(result).toEqual(mockUserList);
    });

    it('should return users with custom filters', async () => {
      const mockUserList: UserListResponseDto = {
        data: [mockUser as any],
        count: 1,
      };
      mockUserService.getAllUsers.mockResolvedValue(mockUserList);

      const result = await controller.getAllUsers(
        10,
        0,
        UserSortBy.NAME,
        SortOrder.ASC,
        '1,2',
        'ADMIN,USER',
        'active',
        'test',
      );

      expect(mockUserService.getAllUsers).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        sortBy: UserSortBy.NAME,
        order: SortOrder.ASC,
        tenantIds: '1,2',
        roles: 'ADMIN,USER',
        statuses: 'active',
        search: 'test',
        includePlatformAdmins: false,
      });
      expect(result).toEqual(mockUserList);
    });

    it('should return empty list when no users found', async () => {
      const emptyUserList: UserListResponseDto = {
        data: [],
        count: 0,
      };
      mockUserService.getAllUsers.mockResolvedValue(emptyUserList);

      const result = await controller.getAllUsers();

      expect(result).toEqual(emptyUserList);
      expect(result.count).toBe(0);
    });

    it('should handle pagination correctly', async () => {
      const mockUserList: UserListResponseDto = {
        data: [mockUser as any],
        count: 100,
      };
      mockUserService.getAllUsers.mockResolvedValue(mockUserList);

      await controller.getAllUsers(20, 40);

      expect(mockUserService.getAllUsers).toHaveBeenCalledWith({
        limit: 20,
        offset: 40,
        sortBy: UserSortBy.CREATED_AT,
        order: SortOrder.DESC,
        tenantIds: undefined,
        roles: undefined,
        statuses: undefined,
        search: undefined,
        includePlatformAdmins: false,
      });
    });

    // The opt-in arrives as a query string, so only the literal "true" counts.
    it('should forward the platform-admin opt-in only for "true"', async () => {
      mockUserService.getAllUsers.mockResolvedValue({ data: [], count: 0 });

      await controller.getAllUsers(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'true',
      );
      expect(mockUserService.getAllUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ includePlatformAdmins: true }),
      );

      await controller.getAllUsers(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'yes',
      );
      expect(mockUserService.getAllUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ includePlatformAdmins: false }),
      );
    });
  });

  describe('addUser', () => {
    it('should create a new user successfully', async () => {
      const addUserDto: Partial<AddUserDto> = {
        name: 'New User',
        email: 'newuser@example.com',
        phone: '+1234567890',
        tenantId: 'test-tenant',
        roles: [UserRole.ADMIN],
      };

      const mockResponse: Partial<AddUserResponseDto> = {
        id: 1,
        name: 'New User',
        email: 'newuser@example.com',
        username: 'newuser',
        tenantId: 'test-tenant',
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserService.addUser.mockResolvedValue(mockResponse);

      const result = await controller.addUser(addUserDto as AddUserDto);

      expect(mockUserService.addUser).toHaveBeenCalledWith(addUserDto);
      expect(result).toEqual(mockResponse);
    });

    it('should throw BadRequestException when user creation fails', async () => {
      const addUserDto: Partial<AddUserDto> = {
        name: 'New User',
        email: 'newuser@example.com',
        phone: '+1234567890',
        tenantId: 'test-tenant',
        roles: [UserRole.ADMIN],
      };

      mockUserService.addUser.mockRejectedValue(
        new BadRequestException('Email already exists'),
      );

      await expect(
        controller.addUser(addUserDto as AddUserDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.addUser(addUserDto as AddUserDto),
      ).rejects.toThrow('Email already exists');
    });

    it('should throw BadRequestException for unknown errors', async () => {
      const addUserDto: Partial<AddUserDto> = {
        name: 'New User',
        email: 'newuser@example.com',
        phone: '+1234567890',
        tenantId: 'test-tenant',
        roles: [UserRole.COUNSELOR],
      };

      mockUserService.addUser.mockRejectedValue(
        new BadRequestException('Could not create user'),
      );

      await expect(
        controller.addUser(addUserDto as AddUserDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.addUser(addUserDto as AddUserDto),
      ).rejects.toThrow('Could not create user');
    });
  });

  describe('bulkAddUsers', () => {
    it('should delegate to the service and return the batch summary', async () => {
      const bulkDto = {
        emails: ['a@example.com', 'b@example.com'],
        roles: [UserRole.CLIENT],
        tenantId: 'test-tenant',
      };
      const mockResponse = { created: 2, users: [] };
      mockUserService.bulkAddUsers.mockResolvedValue(mockResponse);

      const result = await controller.bulkAddUsers(bulkDto as any);

      expect(mockUserService.bulkAddUsers).toHaveBeenCalledWith(bulkDto);
      expect(result).toEqual(mockResponse);
    });

    it('should propagate a BadRequestException from the service', async () => {
      mockUserService.bulkAddUsers.mockRejectedValue(
        new BadRequestException('These emails are already registered'),
      );

      await expect(
        controller.bulkAddUsers({ emails: ['a@example.com'] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeProfile', () => {
    it('should complete the current user profile', async () => {
      const tokenUser = { id: 7, tenantId: 'test-tenant' } as any;
      const body = { name: 'Jane Doe' };
      mockUserService.completeProfile.mockResolvedValue({ success: true });

      const result = await controller.completeProfile(tokenUser, body as any);

      expect(mockUserService.completeProfile).toHaveBeenCalledWith(7, body);
      expect(result).toEqual({ success: true });
    });
  });

  describe('updateUser', () => {
    it('should update user details successfully', async () => {
      const updateUserDto: UpdateUserDto = {
        name: 'Updated User',
        email: 'updated@example.com',
      };

      const mockResponse: UserUpdateResponseDto = {
        success: true,
      };

      mockUserService.updateUser.mockResolvedValue(mockResponse);

      const result = await controller.updateUser(1, updateUserDto);

      expect(mockUserService.updateUser).toHaveBeenCalledWith(1, updateUserDto);
      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(true);
    });

    it('should handle partial user updates', async () => {
      const updateUserDto: UpdateUserDto = {
        name: 'Updated Name Only',
      };

      const mockResponse: UserUpdateResponseDto = {
        success: true,
      };

      mockUserService.updateUser.mockResolvedValue(mockResponse);

      const result = await controller.updateUser(1, updateUserDto);

      expect(mockUserService.updateUser).toHaveBeenCalledWith(1, updateUserDto);
      expect(result).toEqual(mockResponse);
    });

    it('should handle update failure', async () => {
      const updateUserDto: UpdateUserDto = {
        name: 'Updated User',
      };

      const mockResponse: UserUpdateResponseDto = {
        success: false,
      };

      mockUserService.updateUser.mockResolvedValue(mockResponse);

      const result = await controller.updateUser(999, updateUserDto);

      expect(result.success).toBe(false);
    });
  });

  describe('updateUserStatus', () => {
    it('should update user status successfully', async () => {
      const updateUserStatusDto: UpdateUserStatusDto = {
        status: UserStatus.ACTIVE,
      };

      const mockResponse: UserUpdateResponseDto = {
        success: true,
      };

      mockUserService.updateUserStatus.mockResolvedValue(mockResponse);

      const result = await controller.updateUserStatus(1, updateUserStatusDto);

      expect(mockUserService.updateUserStatus).toHaveBeenCalledWith(
        1,
        UserStatus.ACTIVE,
      );
      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(true);
    });

    it('should handle status update failure', async () => {
      const updateUserStatusDto: UpdateUserStatusDto = {
        status: UserStatus.ACTIVE,
      };

      const mockResponse: UserUpdateResponseDto = {
        success: false,
      };

      mockUserService.updateUserStatus.mockResolvedValue(mockResponse);

      const result = await controller.updateUserStatus(
        999,
        updateUserStatusDto,
      );

      expect(result.success).toBe(false);
    });
  });

  describe('getTermsAndAgreementStatus', () => {
    it('should return terms and agreement status', async () => {
      const mockResponse = { success: true };
      mockUserService.getTermsAndAgreementStatus.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getTermsAndAgreementStatus();

      expect(mockUserService.getTermsAndAgreementStatus).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('should return false when user has not approved terms', async () => {
      const mockResponse = { success: false };
      mockUserService.getTermsAndAgreementStatus.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getTermsAndAgreementStatus();

      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('approveTermsAndAgreement', () => {
    it('should approve terms and agreement successfully', async () => {
      const mockResponse = { success: true };
      mockUserService.approveTermsAndAgreement.mockResolvedValue(mockResponse);

      const result = await controller.approveTermsAndAgreement();

      expect(mockUserService.approveTermsAndAgreement).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(true);
    });

    it('should handle approval failure', async () => {
      mockUserService.approveTermsAndAgreement.mockRejectedValue(
        new BadRequestException('User not found'),
      );

      await expect(controller.approveTermsAndAgreement()).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.approveTermsAndAgreement()).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('User Preferences', () => {
    const mockPreferences = {
      id: 1,
      userId: 1,
      default_language_id: 1,
    };

    describe('updateUserPreferences', () => {
      const updateDto = new UpdateUserPreferencesDto();

      it('should update user preferences successfully', async () => {
        const expectedResponse = {
          success: true,
          data: {
            ...mockPreferences,
            ...updateDto,
          },
        };

        mockUserService.updateUserPreferences = jest
          .fn()
          .mockResolvedValue(expectedResponse);

        const result = await controller.updateUserPreferences(
          mockTokenUser,
          updateDto,
        );

        expect(mockUserService.updateUserPreferences).toHaveBeenCalledWith(
          mockTokenUser.id,
          mockTokenUser.tenantId,
          updateDto,
        );
        expect(result).toEqual(expectedResponse);
      });

      it('should throw error when service fails', async () => {
        const error = new Error('Update failed');
        mockUserService.updateUserPreferences = jest
          .fn()
          .mockRejectedValue(error);

        await expect(
          controller.updateUserPreferences(mockTokenUser, updateDto),
        ).rejects.toThrow(error);
      });
    });

    describe('getUserPreferences', () => {
      it('should return user preferences successfully', async () => {
        mockUserService.getUserPreferences = jest
          .fn()
          .mockResolvedValue(mockPreferences);

        const result = await controller.getUserPreferences(mockTokenUser);

        expect(mockUserService.getUserPreferences).toHaveBeenCalledWith(
          mockTokenUser.id,
        );
        expect(result).toEqual(mockPreferences);
      });

      it('should return null when user has no preferences', async () => {
        mockUserService.getUserPreferences = jest.fn().mockResolvedValue(null);

        const result = await controller.getUserPreferences(mockTokenUser);

        expect(result).toBeNull();
      });

      it('should throw error when service fails', async () => {
        const error = new Error('Failed to fetch preferences');
        mockUserService.getUserPreferences = jest.fn().mockRejectedValue(error);

        await expect(
          controller.getUserPreferences(mockTokenUser),
        ).rejects.toThrow(error);
      });
    });
  });

  // ==========================================================================
  // MULTI_TENANT_ADMIN — Tenant Mapping
  // ==========================================================================

  const mockTenant = {
    id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
    name: 'Org Alpha',
    logoUrl: 'https://example.com/logo.png',
  };

  describe('assignAdminTenants', () => {
    const dto: AssignAdminTenantsDto = {
      userId: 42,
      tenantIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
    };

    it('should assign tenants and return { success: true }', async () => {
      mockAdminTenantService.assignTenants.mockResolvedValue({ success: true });

      const result = await controller.assignAdminTenants(dto);

      expect(mockAdminTenantService.assignTenants).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockAdminTenantService.assignTenants.mockRejectedValue(
        new NotFoundException('User with ID 42 not found'),
      );

      await expect(controller.assignAdminTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.assignAdminTenants(dto)).rejects.toThrow(
        'User with ID 42 not found',
      );
    });

    it('should throw BadRequestException when user is not MULTI_TENANT_ADMIN', async () => {
      mockAdminTenantService.assignTenants.mockRejectedValue(
        new BadRequestException(
          'User 42 does not have the MULTI_TENANT_ADMIN role',
        ),
      );

      await expect(controller.assignAdminTenants(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when a tenant does not exist', async () => {
      mockAdminTenantService.assignTenants.mockRejectedValue(
        new NotFoundException(`Tenant with ID ${dto.tenantIds[0]} not found`),
      );

      await expect(controller.assignAdminTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle assignment of multiple tenants', async () => {
      const multiDto: AssignAdminTenantsDto = {
        userId: 42,
        tenantIds: [
          'c56a4180-65aa-42ec-a945-5fd21dec0538',
          'd56a4180-65aa-42ec-a945-5fd21dec0539',
        ],
      };
      mockAdminTenantService.assignTenants.mockResolvedValue({ success: true });

      const result = await controller.assignAdminTenants(multiDto);

      expect(mockAdminTenantService.assignTenants).toHaveBeenCalledWith(
        multiDto,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('removeAdminTenants', () => {
    const dto: RemoveAdminTenantsDto = {
      userId: 42,
      tenantIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
    };

    it('should remove tenants and return { success: true }', async () => {
      mockAdminTenantService.removeTenants.mockResolvedValue({ success: true });

      const result = await controller.removeAdminTenants(dto);

      expect(mockAdminTenantService.removeTenants).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException when no active mapping exists', async () => {
      mockAdminTenantService.removeTenants.mockRejectedValue(
        new NotFoundException(
          'No active tenant mappings found for user 42 with the given tenant IDs',
        ),
      );

      await expect(controller.removeAdminTenants(dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.removeAdminTenants(dto)).rejects.toThrow(
        'No active tenant mappings found',
      );
    });

    it('should handle removal of multiple tenants at once', async () => {
      const multiDto: RemoveAdminTenantsDto = {
        userId: 42,
        tenantIds: [
          'c56a4180-65aa-42ec-a945-5fd21dec0538',
          'd56a4180-65aa-42ec-a945-5fd21dec0539',
        ],
      };
      mockAdminTenantService.removeTenants.mockResolvedValue({ success: true });

      const result = await controller.removeAdminTenants(multiDto);

      expect(mockAdminTenantService.removeTenants).toHaveBeenCalledWith(
        multiDto,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('getAdminTenants', () => {
    it('should return tenants assigned to a user', async () => {
      const expectedResponse = { data: [mockTenant], count: 1 };
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getAdminTenants(42);

      expect(mockAdminTenantService.getTenantsForAdmin).toHaveBeenCalledWith(
        42,
      );
      expect(result).toEqual(expectedResponse);
      expect(result.count).toBe(1);
    });

    it('should return empty list when user has no assigned tenants', async () => {
      mockAdminTenantService.getTenantsForAdmin.mockResolvedValue({
        data: [],
        count: 0,
      });

      const result = await controller.getAdminTenants(42);

      expect(result).toEqual({ data: [], count: 0 });
      expect(result.count).toBe(0);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockAdminTenantService.getTenantsForAdmin.mockRejectedValue(
        new NotFoundException('User with ID 999 not found'),
      );

      await expect(controller.getAdminTenants(999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getAdminTenants(999)).rejects.toThrow(
        'User with ID 999 not found',
      );
    });
  });
});
