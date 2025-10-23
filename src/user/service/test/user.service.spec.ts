import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from '../user.service';
import { User } from 'src/common/entities/user.entity';
import { QueueService } from 'src/queue/service/queue.service';
import { RedisService } from 'src/redis/service/redis.service';
import { UserRole, UserStatus } from 'src/common/constants/user.constants';
import { ChatStatus } from 'src/common/entities/chat.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Group } from 'src/common/entities/group.entity';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { TenantService } from 'src/tenant/service/tenant.service';
import { UserRepository } from 'src/user/repository/user.repository';
import { GroupService } from 'src/authorization/service/group.service';
import { SimulationCreditsService } from 'src/learn/service/simulation-credits.service';
import { BadRequestException } from '@nestjs/common';
import { UserGroupService } from 'src/authorization/service/user-group.service';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
  },
}));

// Mock AuditLoggerService
jest.mock('src/audit/service/audit-logger.service', () => ({
  AuditLoggerService: {
    getInstance: jest.fn().mockReturnValue({
      log: jest.fn(),
    }),
  },
}));

describe('UserService', () => {
  let service: UserService;
  let mockUserRepository: any;
  let mockGroupRepository: any;
  let mockUserGroupRepository: any;
  let mockQueueService: any;
  let mockCache: any;
  let mockTenantService: any;
  let mockUsersRepository: any;
  let mockQueryBuilder: any;
  let mockGroupService: any;
  let mockUsersGroupService: any;
  let mockSimulationCreditsService: any;

  const mockUser: User = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    status: UserStatus.ACTIVE,
    username: 'testuser',
    tenantId: 'test-tenant',
    externalId: 'ext-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockChat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    roomId: 1,
    status: ChatStatus.PAUSED,
    startedAt: new Date(),
    endedAt: undefined,
    tenantId: 'test-tenant',
    summaryStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
      getCount: jest.fn(),
    };

    mockUserRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      exists: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
      query: jest.fn(),
    };

    mockGroupRepository = {
      find: jest.fn(),
    };

    mockUserGroupRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    mockQueueService = {
      getWaitingClients: jest.fn(),
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    };

    mockGroupService = {
      getUserRolesByUserId: jest.fn(),
    };

    mockTenantService = {
      findById: jest.fn(),
    };

    mockUsersRepository = {
      getAllUsers: jest.fn(),
      getUserCount: jest.fn(),
    };

    mockUsersGroupService = {
      findUserRoles: jest.fn(),
    };

    mockSimulationCreditsService = {
      updateSimulationCredits: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Group), useValue: mockGroupRepository },
        {
          provide: getRepositoryToken(UserGroup),
          useValue: mockUserGroupRepository,
        },
        { provide: QueueService, useValue: mockQueueService },
        { provide: RedisService, useValue: mockCache },
        { provide: TenantService, useValue: mockTenantService },
        { provide: UserRepository, useValue: mockUsersRepository },
        { provide: GroupService, useValue: mockGroupService },
        { provide: UserGroupService, useValue: mockUsersGroupService },
        {
          provide: SimulationCreditsService,
          useValue: mockSimulationCreditsService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('test-tenant');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return user when found', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.get(1);
      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, tenantId: 'test-tenant' },
      });
    });

    it('should return null when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      const result = await service.get(1);
      expect(result).toBeNull();
    });
  });

  describe('getUserByPhoneNumber', () => {
    it('should return cached user when found in cache', async () => {
      const cachedUser = JSON.stringify(mockUser);
      mockCache.get.mockResolvedValue(cachedUser);
      const result = await service.getUserByPhoneNumber('+1234567890');
      expect(result).toEqual(JSON.parse(cachedUser));
    });

    it('should return user from database and cache it when not in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.getUserByPhoneNumber('+1234567890');
      expect(result).toEqual(mockUser);
      expect(mockCache.set).toHaveBeenCalledWith(
        'user_+1234567890',
        JSON.stringify(mockUser),
      );
    });

    it('should return null when user not found in cache or database', async () => {
      mockCache.get.mockResolvedValue(null);
      mockUserRepository.findOne.mockResolvedValue(null);
      const result = await service.getUserByPhoneNumber('+1234567890');
      expect(result).toBeNull();
    });
  });

  describe('getUsersByPhoneNumbers', () => {
    it('should return users by phone numbers', async () => {
      const phoneNumbers = ['+1234567890', '+0987654321'];
      const users = [mockUser];
      mockUserRepository.find.mockResolvedValue(users);
      const result = await service.getUsersByPhoneNumbers(phoneNumbers);
      expect(result).toEqual(users);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: {
          phone: expect.any(Object),
          tenantId: 'test-tenant',
        },
      });
    });
  });

  describe('getUsersByIds', () => {
    it('should return users by ids', async () => {
      const ids = [1, 2];
      const users = [mockUser];
      mockUserRepository.find.mockResolvedValue(users);
      const result = await service.getUsersByIds(ids);
      expect(result).toEqual(users);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: {
          id: expect.any(Object),
          tenantId: 'test-tenant',
        },
      });
    });
  });

  describe('getWaitingList', () => {
    it('should return empty result when no waiting clients', async () => {
      mockQueueService.getWaitingClients.mockResolvedValue([]);
      const result = await service.getWaitingList();
      expect(result).toEqual({ total_waiting: 0, clients: [] });
    });

    it('should return formatted waiting list when clients exist', async () => {
      const waitingClients = [{ clientId: 1 }];
      const usersWithChats = [{ ...mockUser, chat: [mockChat] }];
      mockQueueService.getWaitingClients.mockResolvedValue(waitingClients);
      mockQueryBuilder.getMany.mockResolvedValue(usersWithChats);
      const result = await service.getWaitingList();
      expect(result.totalWaiting).toBe(1);
      expect((result.clients[0].chat as { chatId: number }).chatId).toBe(
        mockChat.id,
      );
    });
  });

  describe('getMinimalUserInfo', () => {
    it('should return null when user is null', async () => {
      const result = await service.getMinimalUserInfo(null);
      expect(result).toBeNull();
    });

    it('should return user info with ADMIN role', async () => {
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { id: 1, name: UserRole.ADMIN },
        { id: 2, name: UserRole.CLIENT },
      ]);
      const result = await service.getMinimalUserInfo(mockUser);
      expect(result && result.role).toBe(UserRole.ADMIN);
    });

    it('should return user info with COUNSELOR role when no ADMIN', async () => {
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { id: 1, name: UserRole.COUNSELOR },
        { id: 2, name: UserRole.CLIENT },
      ]);
      const result = await service.getMinimalUserInfo(mockUser);
      expect(result && result.role).toBe(UserRole.COUNSELOR);
    });

    it('should return first role when no ADMIN or COUNSELOR', async () => {
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { id: 1, name: UserRole.CLIENT },
      ]);
      const result = await service.getMinimalUserInfo(mockUser);
      expect(result && result.role).toBe(UserRole.CLIENT);
    });
  });

  describe('createUser', () => {
    it('should create and save user with all parameters', async () => {
      const userData = {
        phoneNumber: '+1234567890',
        name: 'New User',
        email: 'new@example.com',
        status: UserStatus.ACTIVE,
        username: 'newuser',
        tenantId: 'test-tenant',
      };
      const createdUser = {
        ...mockUser,
        ...userData,
        phone: userData.phoneNumber,
      };
      mockUserRepository.create.mockReturnValue(createdUser);
      mockUserRepository.save.mockResolvedValue(createdUser);
      const result = await service.createUser(userData);
      expect(result).toEqual(createdUser);
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        phone: userData.phoneNumber,
        name: userData.name,
        email: userData.email,
        status: userData.status,
        username: userData.username,
        tenantId: userData.tenantId,
      });
    });

    it('should create user with default values when optional params not provided', async () => {
      const userData = { phoneNumber: '+1234567890' };
      mockUserRepository.create.mockReturnValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);
      await service.createUser(userData);
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        phone: userData.phoneNumber,
        name: 'Anonymous user',
        email: `${userData.phoneNumber}@placeholder.com`,
        status: UserStatus.ACTIVE,
        username: `${userData.phoneNumber}_user`,
        tenantId: 'anonyumous_tenant',
      });
    });
  });

  describe('getCounselorNames', () => {
    it('should return counselor names with pagination', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { id: '1', name: 'Counselor 1' },
        { id: '2', name: 'Counselor 2' },
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(2);

      const result = await service.getCounselorNames(10, 0);

      expect(result.data).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should call offset when offset is greater than 0', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { id: '1', name: 'Counselor 1' },
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(1);

      await service.getCounselorNames(10, 10);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should filter counselors by search term', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { id: '1', name: 'John Counselor' },
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      await service.getCounselorNames(undefined, undefined, 'John');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.name ILIKE :search',
        { search: '%John%' },
      );
    });

    it('should trim search term before filtering', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);
      await service.getCounselorNames(undefined, undefined, '  John  ');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.name ILIKE :search',
        { search: '%John%' },
      );
    });
  });

  describe('getUserByExternalId', () => {
    it('should return user by external id', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.getUserByExternalId('ext-123');
      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { externalId: 'ext-123', tenantId: 'test-tenant' },
      });
    });
  });

  describe('getAllUsers', () => {
    it('should transform users with roles and credits correctly', async () => {
      const mockResult = {
        users: [
          {
            user_id: 1,
            user_name: 'Test User',
            user_email: 'test@example.com',
            user_username: 'testuser',
            user_externalId: 'ext-123',
            user_status: UserStatus.ACTIVE,
            user_role: UserRole.CLIENT,
            user_metadata: {},
            tenant_name: 'Test Tenant',
            user_tenant_id: 'test-tenant',
            user_createdAt: new Date(),
            user_updatedAt: new Date(),
            simulation_credit_limit: 100,
            simulation_consumed_credits: 25,
          },
        ],
        count: 1,
      };
      mockUsersRepository.getAllUsers.mockResolvedValue(mockResult);
      mockUsersGroupService.findUserRoles.mockResolvedValue([
        { userId: 1, roles: ['CLIENT', 'ADMIN'] },
      ]);

      const result = await service.getAllUsers({});

      expect(result.data[0].name).toBe('Test User');
      expect(result.data[0].roles).toEqual(['CLIENT', 'ADMIN']);
      expect(result.data[0].creditLimit).toBe(100);
      expect(result.data[0].consumedCredits).toBe(25);
      expect(result.count).toBe(1);
      expect(mockUsersGroupService.findUserRoles).toHaveBeenCalledWith([1]);
    });

    it('should return empty array when no users found', async () => {
      mockUsersRepository.getAllUsers.mockResolvedValue({
        users: [],
        count: 0,
      });
      const result = await service.getAllUsers({});
      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
      expect(mockUsersGroupService.findUserRoles).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });
      const result = await service.updateUser(1, { name: 'Updated' } as any);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateUser(1, { name: 'Updated' } as any),
      ).rejects.toThrow('User with ID 1 not found');
    });

    it('should throw BadRequestException when email already exists', async () => {
      const existingUser = { ...mockUser, id: 2 };
      mockUserRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(existingUser);
      await expect(
        service.updateUser(1, { email: 'existing@example.com' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when externalId already exists', async () => {
      const existingUserWithExternalId = {
        ...mockUser,
        id: 2,
        externalId: 'existing-ext',
      };

      mockUserRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(existingUserWithExternalId);

      await expect(
        service.updateUser(1, { externalId: 'existing-ext' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow updating email to same value', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.updateUser(1, {
        email: mockUser.email,
      } as any);

      expect(result).toEqual({ success: true });
      expect(mockUserRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('should allow updating externalId to same value', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.updateUser(1, {
        externalId: mockUser.externalId,
      } as any);

      expect(result).toEqual({ success: true });
      expect(mockUserRepository.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateUserStatus', () => {
    it('should update user status successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        status: UserStatus.SUSPENDED,
      });
      const result = await service.updateUserStatus(1, UserStatus.SUSPENDED);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateUserStatus(1, UserStatus.SUSPENDED),
      ).rejects.toThrow('User with ID 1 not found');
    });

    it('should throw BadRequestException when status is same', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.updateUserStatus(1, UserStatus.ACTIVE),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addUser', () => {
    it('should create user and assign roles successfully', async () => {
      const userData = {
        email: 'new@example.com',
        phone: '+9876543210',
        name: 'New User',
        password: 'password123',
        roles: [UserRole.CLIENT],
        tenantId: 'test-tenant',
        username: 'newuser',
      };
      const savedUser = { ...mockUser, id: 2, ...userData };
      mockUserRepository.findOne.mockResolvedValue(null);
      mockTenantService.findById.mockResolvedValue({ id: 'test-tenant' });
      mockUserRepository.create.mockReturnValue(savedUser);
      mockUserRepository.save.mockResolvedValue(savedUser);
      mockGroupRepository.find.mockResolvedValue([
        { id: 1, name: UserRole.CLIENT },
      ]);
      mockUserGroupRepository.create.mockReturnValue({ userId: 2, groupId: 1 });
      mockUserGroupRepository.save.mockResolvedValue([
        { userId: 2, groupId: 1 },
      ]);

      const result = await service.addUser(userData as any);

      expect(result.id).toBe(2);
      expect(result.email).toBe(userData.email);
      expect(mockUserGroupRepository.save).toHaveBeenCalled();
      expect(
        mockSimulationCreditsService.updateSimulationCredits,
      ).not.toHaveBeenCalled();
    });

    it('should create user with simulation credits when provided', async () => {
      const userData = {
        email: 'new@example.com',
        phone: '+9876543210',
        name: 'New User',
        password: 'password123',
        roles: [UserRole.CLIENT],
        tenantId: 'test-tenant',
        username: 'newuser',
        simulationCreditLimit: 100,
      };
      const savedUser = { ...mockUser, id: 2, ...userData };
      mockUserRepository.findOne.mockResolvedValue(null);
      mockTenantService.findById.mockResolvedValue({ id: 'test-tenant' });
      mockUserRepository.create.mockReturnValue(savedUser);
      mockUserRepository.save.mockResolvedValue(savedUser);
      mockGroupRepository.find.mockResolvedValue([
        { id: 1, name: UserRole.CLIENT },
      ]);
      mockUserGroupRepository.create.mockReturnValue({ userId: 2, groupId: 1 });
      mockUserGroupRepository.save.mockResolvedValue([
        { userId: 2, groupId: 1 },
      ]);
      mockSimulationCreditsService.updateSimulationCredits.mockResolvedValue(
        {},
      );

      const result = await service.addUser(userData as any);

      expect(result.id).toBe(2);
      expect(
        mockSimulationCreditsService.updateSimulationCredits,
      ).toHaveBeenCalledWith({
        userId: 2,
        creditLimit: 100,
      });
    });

    it('should throw BadRequestException when email already exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      await expect(
        service.addUser({ email: 'test@example.com' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when phone already exists', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        email: 'different@example.com',
      });
      await expect(
        service.addUser({
          phone: '+1234567890',
          email: 'new@example.com',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when tenant is not provided', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(
        service.addUser({ email: 'test@example.com' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when tenant is invalid', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockTenantService.findById.mockResolvedValue(null);
      await expect(
        service.addUser({
          tenantId: 'invalid-tenant',
          email: 'test@example.com',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when externalId already exists in tenant', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      mockTenantService.findById.mockResolvedValue({ id: 'test-tenant' });
      await expect(
        service.addUser({
          email: 'new@example.com',
          tenantId: 'test-tenant',
          externalId: 'existing-ext',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use email as username when username not provided', async () => {
      const userData = {
        email: 'new@example.com',
        phone: '+9876543210',
        name: 'New User',
        roles: [UserRole.CLIENT],
        tenantId: 'test-tenant',
      };
      const savedUser = { ...mockUser, id: 2, username: userData.email };
      mockUserRepository.findOne.mockResolvedValue(null);
      mockTenantService.findById.mockResolvedValue({ id: 'test-tenant' });
      mockUserRepository.create.mockReturnValue(savedUser);
      mockUserRepository.save.mockResolvedValue(savedUser);
      mockGroupRepository.find.mockResolvedValue([
        { id: 1, name: UserRole.CLIENT },
      ]);
      mockUserGroupRepository.create.mockReturnValue({ userId: 2, groupId: 1 });
      mockUserGroupRepository.save.mockResolvedValue([
        { userId: 2, groupId: 1 },
      ]);

      await service.addUser(userData as any);

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: userData.email,
        }),
      );
    });
  });

  describe('isValidUser', () => {
    it('should return true when user exists', async () => {
      mockUserRepository.exists.mockResolvedValue(true);
      const result = await service.isValidUser(1);
      expect(result).toBe(true);
      expect(mockUserRepository.exists).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should return false when user does not exist', async () => {
      mockUserRepository.exists.mockResolvedValue(false);
      const result = await service.isValidUser(999);
      expect(result).toBe(false);
      expect(mockUserRepository.exists).toHaveBeenCalledWith({
        where: { id: 999 },
      });
    });
  });
});
