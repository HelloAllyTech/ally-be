import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SuperDuperAdminService } from '../super-duper-admin.service';
import { UserRepository } from '../../repository/user.repository';
import { GroupService } from 'src/authorization/service/group.service';
import { UserRole } from 'src/common/constants/user.constants';

describe('SuperDuperAdminService', () => {
  let service: SuperDuperAdminService;
  let mockUserRepository: any;
  let mockGroupService: any;

  const ACTING_USER_ID = 99;

  const mockTarget = {
    id: 1,
    name: 'Target User',
    email: 'target@example.com',
  };

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn(),
      getUsersWithRole: jest.fn(),
      getActiveUsersWithoutRoles: jest.fn(),
    };

    mockGroupService = {
      getUserGroupNames: jest.fn(),
      assignRole: jest.fn(),
      removeRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuperDuperAdminService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: GroupService, useValue: mockGroupService },
      ],
    }).compile();

    service = module.get<SuperDuperAdminService>(SuperDuperAdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listSuperDuperAdmins', () => {
    it('returns users holding the SUPER_DUPER_ADMIN role', async () => {
      const users = [mockTarget];
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users,
        count: 1,
      });

      const result = await service.listSuperDuperAdmins('tar');

      expect(mockUserRepository.getUsersWithRole).toHaveBeenCalledWith(
        UserRole.SUPER_DUPER_ADMIN,
        'tar',
      );
      expect(result).toEqual({ data: users, count: 1 });
    });
  });

  describe('listEligibleUsers', () => {
    it('returns super admins that are not already super duper admins', async () => {
      const superAdminOnly = { id: 2, email: 'sa@example.com' };
      const alsoSda = { id: 3, email: 'both@example.com' };
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users: [superAdminOnly, alsoSda],
        count: 2,
      });
      mockGroupService.getUserGroupNames.mockImplementation(
        async (userId: number) =>
          userId === alsoSda.id
            ? [UserRole.SUPER_ADMIN, UserRole.SUPER_DUPER_ADMIN]
            : [UserRole.SUPER_ADMIN],
      );

      const result = await service.listEligibleUsers();

      expect(mockUserRepository.getUsersWithRole).toHaveBeenCalledWith(
        UserRole.SUPER_ADMIN,
        undefined,
      );
      expect(result).toEqual({ data: [superAdminOnly], count: 1 });
    });
  });

  describe('promote', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.promote({ userId: 1 }, ACTING_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the user is already a super duper admin', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_DUPER_ADMIN,
      ]);

      await expect(
        service.promote({ userId: 1 }, ACTING_USER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(mockGroupService.assignRole).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the user is not a super admin', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);

      await expect(
        service.promote({ userId: 1 }, ACTING_USER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(mockGroupService.assignRole).not.toHaveBeenCalled();
    });

    it('swaps SUPER_ADMIN for SUPER_DUPER_ADMIN (assign before remove)', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_ADMIN,
      ]);
      const callOrder: string[] = [];
      mockGroupService.assignRole.mockImplementation(async () => {
        callOrder.push('assign');
        return true;
      });
      mockGroupService.removeRole.mockImplementation(async () => {
        callOrder.push('remove');
        return true;
      });

      const result = await service.promote({ userId: 1 }, ACTING_USER_ID);

      expect(result).toEqual({ success: true });
      expect(mockGroupService.assignRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_DUPER_ADMIN,
        userId: 1,
      });
      expect(mockGroupService.removeRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_ADMIN,
        userId: 1,
      });
      expect(callOrder).toEqual(['assign', 'remove']);
    });
  });

  describe('demote', () => {
    it('throws ForbiddenException on self-demotion', async () => {
      await expect(
        service.demote(ACTING_USER_ID, ACTING_USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.demote(1, ACTING_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the user is not a super duper admin', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_ADMIN,
      ]);

      await expect(service.demote(1, ACTING_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when demoting the last super duper admin', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_DUPER_ADMIN,
      ]);
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users: [mockTarget],
        count: 1,
      });

      await expect(service.demote(1, ACTING_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockGroupService.removeRole).not.toHaveBeenCalled();
    });

    it('restores SUPER_ADMIN then removes SUPER_DUPER_ADMIN', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_DUPER_ADMIN,
      ]);
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users: [mockTarget, { id: 2 }],
        count: 2,
      });
      const callOrder: string[] = [];
      mockGroupService.assignRole.mockImplementation(async () => {
        callOrder.push('assign');
        return true;
      });
      mockGroupService.removeRole.mockImplementation(async () => {
        callOrder.push('remove');
        return true;
      });

      const result = await service.demote(1, ACTING_USER_ID);

      expect(result).toEqual({ success: true });
      expect(mockGroupService.assignRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_ADMIN,
        userId: 1,
      });
      expect(mockGroupService.removeRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_DUPER_ADMIN,
        userId: 1,
      });
      expect(callOrder).toEqual(['assign', 'remove']);
    });

    it('does not re-assign SUPER_ADMIN when the user already holds it', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_ADMIN,
        UserRole.SUPER_DUPER_ADMIN,
      ]);
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users: [mockTarget, { id: 2 }],
        count: 2,
      });
      mockGroupService.removeRole.mockResolvedValue(true);

      await service.demote(1, ACTING_USER_ID);

      expect(mockGroupService.assignRole).not.toHaveBeenCalled();
      expect(mockGroupService.removeRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_DUPER_ADMIN,
        userId: 1,
      });
    });
  });

  describe('listSuperAdmins', () => {
    it('returns users holding the SUPER_ADMIN role', async () => {
      const users = [mockTarget];
      mockUserRepository.getUsersWithRole.mockResolvedValue({
        users,
        count: 1,
      });

      const result = await service.listSuperAdmins('tar');

      expect(mockUserRepository.getUsersWithRole).toHaveBeenCalledWith(
        UserRole.SUPER_ADMIN,
        'tar',
      );
      expect(result).toEqual({ data: users, count: 1 });
    });
  });

  describe('listSuperAdminCandidates', () => {
    it('returns active users outside the super-admin tier', async () => {
      const users = [{ id: 5, email: 'candidate@example.com' }];
      mockUserRepository.getActiveUsersWithoutRoles.mockResolvedValue({
        users,
        count: 1,
      });

      const result = await service.listSuperAdminCandidates('cand');

      expect(
        mockUserRepository.getActiveUsersWithoutRoles,
      ).toHaveBeenCalledWith(
        [UserRole.SUPER_ADMIN, UserRole.SUPER_DUPER_ADMIN],
        'cand',
      );
      expect(result).toEqual({ data: users, count: 1 });
    });
  });

  describe('promoteToSuperAdmin', () => {
    it('assigns SUPER_ADMIN additively (other roles kept)', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);
      mockGroupService.assignRole.mockResolvedValue(true);

      await service.promoteToSuperAdmin({ userId: 1 }, ACTING_USER_ID);

      expect(mockGroupService.assignRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_ADMIN,
        userId: 1,
      });
      expect(mockGroupService.removeRole).not.toHaveBeenCalled();
    });

    it('404s when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(
        service.promoteToSuperAdmin({ userId: 1 }, ACTING_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([[UserRole.SUPER_ADMIN], [UserRole.SUPER_DUPER_ADMIN]])(
      'rejects users already in the tier (%s)',
      async (role) => {
        mockUserRepository.findOne.mockResolvedValue(mockTarget);
        mockGroupService.getUserGroupNames.mockResolvedValue([role]);

        await expect(
          service.promoteToSuperAdmin({ userId: 1 }, ACTING_USER_ID),
        ).rejects.toThrow(BadRequestException);
        expect(mockGroupService.assignRole).not.toHaveBeenCalled();
      },
    );
  });

  describe('removeSuperAdmin', () => {
    it('removes the SUPER_ADMIN role', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_ADMIN,
        UserRole.ADMIN,
      ]);
      mockGroupService.removeRole.mockResolvedValue(true);

      await service.removeSuperAdmin(1, ACTING_USER_ID);

      expect(mockGroupService.removeRole).toHaveBeenCalledWith({
        role: UserRole.SUPER_ADMIN,
        userId: 1,
      });
    });

    it('rejects self-removal', async () => {
      await expect(
        service.removeSuperAdmin(ACTING_USER_ID, ACTING_USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects removing a super duper admin (must demote first)', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([
        UserRole.SUPER_DUPER_ADMIN,
      ]);

      await expect(service.removeSuperAdmin(1, ACTING_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockGroupService.removeRole).not.toHaveBeenCalled();
    });

    it('rejects users who are not super admins', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockTarget);
      mockGroupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);

      await expect(service.removeSuperAdmin(1, ACTING_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
