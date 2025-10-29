import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { UserGroupRepository } from 'src/authorization/repository/user-group.repository';
import { GroupService } from '../group.service';
import { Group } from 'src/common/entities/group.entity';
import { LoggerService } from 'src/logger/logger.service';
import { UserRole } from 'src/common/constants/user.constants';
import { DataSource } from 'typeorm';
import { User } from 'src/common/entities/user.entity';
import { UserRepository } from 'src/user/repository/user.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('GroupService', () => {
  let service: GroupService;
  let redisService: jest.Mocked<RedisService>;
  let groupRepo: jest.Mocked<GroupRepository>;
  let userGroupRepo: jest.Mocked<UserGroupRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    } as any);

    const mockDataSource = {
      transaction: jest.fn((callback) => callback()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: GroupRepository,
          useValue: {
            findOne: jest.fn(),
            findUserRoleByUserId: jest.fn(),
            getAll: jest.fn(),
          },
        },
        {
          provide: UserGroupRepository,
          useValue: {
            findOne: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            count: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: UserRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
    redisService = module.get(RedisService);
    groupRepo = module.get(GroupRepository);
    userGroupRepo = module.get(UserGroupRepository);
    userRepository = module.get(UserRepository);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllRoles', () => {
    it('should return all available roles', async () => {
      const mockRoles = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
        { id: 3, name: 'CLIENT' },
      ] as Group[];

      groupRepo.getAll.mockResolvedValue(mockRoles);

      const result = await service.getAllRoles();

      expect(result).toEqual(mockRoles);
      expect(result).toHaveLength(3);
      expect(groupRepo.getAll).toHaveBeenCalled();
    });

    it('should return empty array when no roles exist', async () => {
      groupRepo.getAll.mockResolvedValue([]);

      const result = await service.getAllRoles();

      expect(result).toEqual([]);
      expect(groupRepo.getAll).toHaveBeenCalled();
    });
  });

  describe('getGroupNames', () => {
    it('should return group names for given group IDs', async () => {
      const groupIds = [1, 2];
      const mockGroups = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
      ] as Group[];

      groupRepo.getAll.mockResolvedValue(mockGroups);

      const result = await service.getGroupNames(groupIds);

      expect(result).toEqual(['ADMIN', 'COUNSELOR']);
      expect(groupRepo.getAll).toHaveBeenCalledWith({
        where: { id: expect.anything() },
      });
    });

    it('should return empty array when no groups found', async () => {
      const groupIds = [999];
      groupRepo.getAll.mockResolvedValue([]);

      const result = await service.getGroupNames(groupIds);

      expect(result).toEqual([]);
    });
  });

  describe('getUserGroupIds', () => {
    it('should return cached group IDs if available', async () => {
      redisService.get.mockResolvedValue(JSON.stringify([1, 2, 3]));

      const result = await service.getUserGroupIds(1);

      expect(result).toEqual([1, 2, 3]);
      expect(redisService.get).toHaveBeenCalledWith('user:groups:1');
      expect(groupRepo.findUserRoleByUserId).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache if not in cache', async () => {
      redisService.get.mockResolvedValue(null);
      groupRepo.findUserRoleByUserId.mockResolvedValue([
        { id: 10, name: 'ADMIN' },
        { id: 20, name: 'COUNSELOR' },
      ] as Group[]);

      const result = await service.getUserGroupIds(2);

      expect(result).toEqual([10, 20]);
      expect(redisService.set).toHaveBeenCalledWith(
        'user:groups:2',
        JSON.stringify([10, 20]),
      );
      expect(groupRepo.findUserRoleByUserId).toHaveBeenCalledWith(2);
    });
  });

  describe('getUserGroupNames', () => {
    it('should return cached group names if cache contains group IDs', async () => {
      const mockGroups = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
      ] as Group[];

      redisService.get.mockResolvedValue(JSON.stringify([1, 2]));
      groupRepo.getAll.mockResolvedValue(mockGroups);

      const result = await service.getUserGroupNames(1);

      expect(result).toEqual(['ADMIN', 'COUNSELOR']);
      expect(redisService.get).toHaveBeenCalledWith('user:groups:1');
    });

    it('should fetch from DB if not in cache', async () => {
      redisService.get.mockResolvedValue(null);
      groupRepo.findUserRoleByUserId.mockResolvedValue([
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'CLIENT' },
      ] as Group[]);

      const result = await service.getUserGroupNames(1);

      expect(result).toEqual(['ADMIN', 'CLIENT']);
      expect(groupRepo.findUserRoleByUserId).toHaveBeenCalledWith(1);
    });
  });

  describe('assignRole', () => {
    it('should successfully assign a role to user', async () => {
      groupRepo.findOne.mockResolvedValue({ id: 2, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue(null);
      userGroupRepo.create.mockResolvedValue({
        id: 1,
        groupId: 2,
        userId: 1,
      } as any);

      const result = await service.assignRole({
        role: UserRole.ADMIN,
        userId: 1,
      });

      expect(result).toBe(true);
      expect(userGroupRepo.create).toHaveBeenCalledWith({
        groupId: 2,
        userId: 1,
      });
      expect(redisService.del).toHaveBeenCalledWith('user:groups:1');
      expect(redisService.del).toHaveBeenCalledWith('user:roles:1');
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when role not found', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.assignRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow('Role not found');
    });

    it('should throw BadRequestException when user already has the role', async () => {
      groupRepo.findOne.mockResolvedValue({ id: 2, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue({
        id: 1,
        groupId: 2,
        userId: 1,
      } as any);

      await expect(
        service.assignRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assignRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow('User is already assigned to this role');
    });
  });

  describe('removeRole', () => {
    it('should successfully remove a role from user', async () => {
      const mockUserGroup = { id: 1, groupId: 1, userId: 1 };

      groupRepo.findOne.mockResolvedValue({ id: 1, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue(mockUserGroup as any);
      userGroupRepo.count.mockResolvedValue(2);
      userGroupRepo.remove.mockResolvedValue(undefined);

      const result = await service.removeRole({
        role: UserRole.ADMIN,
        userId: 1,
      });

      expect(result).toBe(true);
      expect(userGroupRepo.remove).toHaveBeenCalledWith(mockUserGroup);
      expect(redisService.del).toHaveBeenCalledWith('user:groups:1');
      expect(redisService.del).toHaveBeenCalledWith('user:roles:1');
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when role not found', async () => {
      groupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow('Role not found');
    });

    it('should throw NotFoundException when user does not have the role', async () => {
      groupRepo.findOne.mockResolvedValue({ id: 1, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow('User role not found');
    });

    it('should throw BadRequestException when user has only one role', async () => {
      const mockUserGroup = { id: 1, groupId: 1, userId: 1 };

      groupRepo.findOne.mockResolvedValue({ id: 1, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue(mockUserGroup as any);
      userGroupRepo.count.mockResolvedValue(1);

      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.removeRole({
          role: UserRole.ADMIN,
          userId: 1,
        }),
      ).rejects.toThrow('User must have at least one role');
    });
  });

  describe('getUserRolesByUserId', () => {
    it('should return user roles from database', async () => {
      const mockRoles = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
      ] as Group[];

      groupRepo.findUserRoleByUserId.mockResolvedValue(mockRoles);

      const result = await service.getUserRolesByUserId(1);

      expect(result).toEqual(mockRoles);
      expect(result).toHaveLength(2);
      expect(groupRepo.findUserRoleByUserId).toHaveBeenCalledWith(1);
    });

    it('should return empty array when user has no roles', async () => {
      groupRepo.findUserRoleByUserId.mockResolvedValue([]);

      const result = await service.getUserRolesByUserId(999);

      expect(result).toEqual([]);
    });
  });

  describe('changeUserRoles', () => {
    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changeUserRoles({
          userId: 999,
          groupIds: [1, 2],
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.changeUserRoles({
          userId: 999,
          groupIds: [1, 2],
        }),
      ).rejects.toThrow('User with ID 999 not found');
    });

    it('should throw NotFoundException when one or more roles not found', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue([{ id: 1, name: 'ADMIN' }] as Group[]);

      await expect(
        service.changeUserRoles({
          userId: 1,
          groupIds: [1, 2, 3],
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.changeUserRoles({
          userId: 1,
          groupIds: [1, 2, 3],
        }),
      ).rejects.toThrow('One or more roles not found');
    });

    it('should successfully add new roles to user', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
      ] as Group[];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue([]);
      userGroupRepo.create.mockResolvedValue({} as any);

      const result = await service.changeUserRoles({
        userId: 1,
        groupIds: [1, 2],
      });

      expect(result).toEqual({
        success: true,
        message: 'User roles updated successfully',
      });
      expect(userGroupRepo.create).toHaveBeenCalledTimes(2);
      expect(redisService.del).toHaveBeenCalledWith('user:groups:1');
      expect(redisService.del).toHaveBeenCalledWith('user:roles:1');
    });

    it('should successfully remove old roles and add new ones', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [
        { id: 2, name: 'COUNSELOR' },
        { id: 3, name: 'CLIENT' },
      ] as Group[];
      const mockCurrentUserGroups = [{ id: 10, userId: 1, groupId: 1 }];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue(mockCurrentUserGroups as any);
      userGroupRepo.remove.mockResolvedValue(undefined);
      userGroupRepo.create.mockResolvedValue({} as any);

      const result = await service.changeUserRoles({
        userId: 1,
        groupIds: [2, 3],
      });

      expect(result).toEqual({
        success: true,
        message: 'User roles updated successfully',
      });
      expect(userGroupRepo.remove).toHaveBeenCalledTimes(1);
      expect(userGroupRepo.create).toHaveBeenCalledTimes(2);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should handle scenario with no changes needed', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [{ id: 1, name: 'ADMIN' }] as Group[];
      const mockCurrentUserGroups = [{ id: 10, userId: 1, groupId: 1 }];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue(mockCurrentUserGroups as any);

      const result = await service.changeUserRoles({
        userId: 1,
        groupIds: [1],
      });

      expect(result).toEqual({
        success: true,
        message: 'User roles updated successfully',
      });
      expect(userGroupRepo.remove).not.toHaveBeenCalled();
      expect(userGroupRepo.create).not.toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith('user:groups:1');
      expect(redisService.del).toHaveBeenCalledWith('user:roles:1');
    });

    it('should throw BadRequestException when transaction fails', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [{ id: 1, name: 'ADMIN' }] as Group[];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue([]);
      userGroupRepo.create.mockRejectedValue(new Error('DB Error'));

      await expect(
        service.changeUserRoles({
          userId: 1,
          groupIds: [1],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
