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
import { BadRequestException } from '@nestjs/common';
import {
  UserListResponseDto,
  UserUpdateResponseDto,
} from '../../dto/user-response.dto';
import { AddUserResponseDto } from '../../dto/user-add-response.dto';

describe('UserController', () => {
  let controller: UserController;
  let mockUserService: any;
  let mockGroupService: any;

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
      updateUser: jest.fn(),
      updateUserStatus: jest.fn(),
    };

    mockGroupService = {
      assignRole: jest.fn(),
      removeRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: GroupService, useValue: mockGroupService },
        { provide: Reflector, useValue: { get: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: { checkPermission: jest.fn() },
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
      });
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
});
