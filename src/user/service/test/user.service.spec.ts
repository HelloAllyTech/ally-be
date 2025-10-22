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
    });
  });

  describe('getUsersByIds', () => {
    it('should return users by ids', async () => {
      const ids = [1, 2];
      const users = [mockUser];
      mockUserRepository.find.mockResolvedValue(users);
      const result = await service.getUsersByIds(ids);
      expect(result).toEqual(users);
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
      expect((result.clients[0].chat as any).chatId).toBe(mockChat.id);
    });
  });

  describe('getMinimalUserInfo', () => {
    it('should return null when user is null', async () => {
      const result = await service.getMinimalUserInfo(null);
      expect(result).toBeNull();
    });

    it('should return user info with correct role', async () => {
      mockGroupService.getUserRolesByUserId.mockResolvedValue([
        { id: 1, name: UserRole.CLIENT },
      ]);
      const result = await service.getMinimalUserInfo(mockUser);
      expect(result && result.role).toBe(UserRole.CLIENT);
    });
  });

  describe('createUser', () => {
    it('should create and save user', async () => {
      const userData = { phoneNumber: '+1234567890' };
      const createdUser = { ...mockUser, phone: userData.phoneNumber };
      mockUserRepository.create.mockReturnValue(createdUser);
      mockUserRepository.save.mockResolvedValue(createdUser);
      const result = await service.createUser(userData as any);
      expect(result).toEqual(createdUser);
    });
  });

  describe('getCounselorNames', () => {
    it('should return counselor names', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { id: '1', name: 'Counselor' },
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      const result = await service.getCounselorNames();
      expect(result.data[0].name).toBe('Counselor');
    });
  });

  describe('getUserByExternalId', () => {
    it('should return user by external id', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.getUserByExternalId('ext-123');
      expect(result).toEqual(mockUser);
    });
  });

  describe('getAllUsers', () => {
    it('should transform users correctly', async () => {
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
          },
        ],
        rolesMap: new Map([[1, ['CLIENT']]]),
        count: 1,
      };
      mockUsersRepository.getAllUsers.mockResolvedValue(mockResult);
      const result = await service.getAllUsers({});
      expect(result.data[0].name).toBe('Test User');
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });
      const result = await service.updateUser(1, { name: 'Updated' } as any);
      expect(result).toEqual({ success: true });
    });
  });

  describe('updateUserStatus', () => {
    it('should update user status successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        status: UserStatus.INACTIVE,
      });
      const result = await service.updateUserStatus(1, UserStatus.INACTIVE);
      expect(result).toEqual({ success: true });
    });
  });

  describe('addUser', () => {
    it('should create user and return addUserResponseDto', async () => {
      const userData = {
        email: 'new@example.com',
        phone: '+9876543210',
        roles: [UserRole.CLIENT],
        tenantId: 'test-tenant',
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
    });
  });
});
