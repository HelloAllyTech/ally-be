import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from '../user.controller';
import { UserService } from '../user.service';
import { GroupService } from 'src/authorization/service/group.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { UserRole } from 'src/common/constants/user.constants';
import { AssignUserRoleDto, RemoveUserRoleDto } from '../dto/group.dto';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';

describe('UserController', () => {
  let controller: UserController;
  let mockUserService: any;
  let mockGroupService: any;

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'testuser',
    role: UserRole.CLIENT,
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
  });
});
