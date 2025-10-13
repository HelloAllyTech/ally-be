import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { UserGroupRepository } from 'src/authorization/repository/user-group.repository';
import { GroupService } from '../group.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Group } from 'src/common/entities/group.entity';
import { LoggerService } from 'src/logger/logger.service';
import { UserRole } from 'src/common/constants/user.constants';

describe('GroupService', () => {
  let service: GroupService;
  let redisService: jest.Mocked<RedisService>;
  let groupRepo: jest.Mocked<GroupRepository>;
  let userGroupRepo: jest.Mocked<UserGroupRepository>;

  beforeEach(async () => {
    // Mock the LoggerService to suppress logs during tests
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        {
          provide: RedisService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: GroupRepository,
          useValue: { findOne: jest.fn(), findUserRoleByUserId: jest.fn() },
        },
        {
          provide: UserGroupRepository,
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            count: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
    redisService = module.get(RedisService);
    groupRepo = module.get(GroupRepository);
    userGroupRepo = module.get(UserGroupRepository);
  });

  describe('getUserGroups', () => {
    it('should return cached groups if available', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify([1, 2]));
      const result = await service.getUserGroups(1);
      expect(result).toEqual([1, 2]);
      expect(groupRepo.findUserRoleByUserId).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache if not cached', async () => {
      redisService.get.mockResolvedValueOnce(null);
      groupRepo.findUserRoleByUserId.mockResolvedValueOnce([
        { id: 10 },
      ] as Group[]);
      const result = await service.getUserGroups(2);
      expect(result).toEqual([10]);
      expect(redisService.set).toHaveBeenCalledWith(
        'user:groups:2',
        JSON.stringify([10]),
      );
    });
  });

  describe('assignRole', () => {
    it('should throw NotFoundException if group not found', async () => {
      groupRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.assignRole({ role: UserRole.ADMIN, userId: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user already has role', async () => {
      groupRepo.findOne.mockResolvedValueOnce({ id: 1 } as Group);
      userGroupRepo.findOne.mockResolvedValueOnce({
        groupId: 1,
        userId: 1,
      } as any);
      await expect(
        service.assignRole({ role: UserRole.ADMIN, userId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should assign a new role successfully', async () => {
      groupRepo.findOne.mockResolvedValueOnce({ id: 2 } as Group);
      userGroupRepo.findOne.mockResolvedValueOnce(null);
      userGroupRepo.create.mockResolvedValueOnce({
        groupId: 2,
        userId: 1,
      } as any);
      const result = await service.assignRole({
        role: UserRole.ADMIN,
        userId: 1,
      });
      expect(result).toBe(true);
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeRole', () => {
    it('should throw NotFoundException if role not found for user', async () => {
      groupRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.removeRole({ role: UserRole.ADMIN, userId: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if user role not found', async () => {
      groupRepo.findOne.mockResolvedValueOnce({ id: 1 } as Group);
      userGroupRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.removeRole({ role: UserRole.ADMIN, userId: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user has only one role', async () => {
      groupRepo.findOne.mockResolvedValueOnce({ id: 1 } as Group);
      userGroupRepo.findOne.mockResolvedValueOnce({
        groupId: 1,
        userId: 1,
      } as any);
      userGroupRepo.count.mockResolvedValueOnce(1);
      await expect(
        service.removeRole({ role: UserRole.ADMIN, userId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should remove role successfully', async () => {
      groupRepo.findOne.mockResolvedValueOnce({ id: 1 } as Group);
      userGroupRepo.findOne.mockResolvedValueOnce({
        groupId: 1,
        userId: 1,
      } as any);
      userGroupRepo.count.mockResolvedValueOnce(2);
      const result = await service.removeRole({
        role: UserRole.ADMIN,
        userId: 1,
      });
      expect(result).toBe(true);
      expect(userGroupRepo.remove).toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUserRolesByUserId', () => {
    it('should return roles from repository', async () => {
      const roles = [{ id: 1, name: 'ADMIN' }];
      groupRepo.findUserRoleByUserId.mockResolvedValueOnce(roles as Group[]);
      const result = await service.getUserRolesByUserId(1);
      expect(result).toEqual(roles);
    });
  });
});
