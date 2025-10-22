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
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRepository } from 'src/user/repository/user.repository';

describe('GroupService - Happy Path Tests', () => {
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
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: UserRepository,
          useValue: {
            getAllUsers: jest.fn(),
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
    });
  });

  describe('getUserGroups', () => {
    it('should return cached groups if available', async () => {
      redisService.get.mockResolvedValue(JSON.stringify([1, 2, 3]));

      const result = await service.getUserGroupIds(1);

      expect(result).toEqual([1, 2, 3]);
      expect(redisService.get).toHaveBeenCalledWith('user:groups:1');
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
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeRole', () => {
    it('should successfully remove a role from user', async () => {
      const mockUserGroup = { id: 1, groupId: 1, userId: 1 };

      groupRepo.findOne.mockResolvedValue({ id: 1, name: 'ADMIN' } as Group);
      userGroupRepo.findOne.mockResolvedValue(mockUserGroup as any);
      userGroupRepo.count.mockResolvedValue(2); // User has 2 roles
      userGroupRepo.remove.mockResolvedValue(mockUserGroup as any);

      const result = await service.removeRole({
        role: UserRole.ADMIN,
        userId: 1,
      });

      expect(result).toBe(true);
      expect(userGroupRepo.remove).toHaveBeenCalledWith(mockUserGroup);
      expect(redisService.del).toHaveBeenCalledTimes(2);
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
    });
  });

  describe('changeUserRoles', () => {
    it('should successfully add new roles to user', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [
        { id: 1, name: 'ADMIN' },
        { id: 2, name: 'COUNSELOR' },
      ] as Group[];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue([]); // User has no current roles

      const result = await service.changeUserRoles({
        userId: 1,
        groupIds: [1, 2],
      });

      expect(result).toEqual({
        success: true,
        message: 'User roles updated successfully',
      });
      expect(userGroupRepo.create).toHaveBeenCalledTimes(2);
    });

    it('should successfully remove old roles and add new ones', async () => {
      const mockUser = { id: 1, name: 'Test User' } as User;
      const mockGroups = [
        { id: 2, name: 'COUNSELOR' },
        { id: 3, name: 'CLIENT' },
      ] as Group[];
      const mockCurrentUserGroups = [
        { id: 10, userId: 1, groupId: 1 }, // Old role to remove
      ];

      userRepository.findOne.mockResolvedValue(mockUser);
      groupRepo.getAll.mockResolvedValue(mockGroups);
      userGroupRepo.findMany.mockResolvedValue(mockCurrentUserGroups as any);

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
        groupIds: [1], // Same as current
      });

      expect(result).toEqual({
        success: true,
        message: 'User roles updated successfully',
      });
      expect(userGroupRepo.remove).not.toHaveBeenCalled();
      expect(userGroupRepo.create).not.toHaveBeenCalled();
    });
  });
});
