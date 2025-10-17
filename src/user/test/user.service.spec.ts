import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from '../user.service';
import { User } from 'src/common/entities/user.entity';
import { QueueService } from 'src/queue/service/queue.service';
import { RedisService } from 'src/redis/service/redis.service';
import { UserRole, UserStatus } from 'src/common/constants/user.constants';
import { ChatStatus } from 'src/common/entities/chat.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
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
  let mockQueueService: any;
  let mockCache: any;
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
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
      query: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: QueueService, useValue: mockQueueService },
        { provide: RedisService, useValue: mockCache },
        { provide: GroupService, useValue: mockGroupService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('test-tenant');
  });

  describe('get', () => {
    it('should return user when found', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.get(1);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, tenantId: 'test-tenant' },
      });
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

      expect(mockCache.get).toHaveBeenCalledWith('user_+1234567890');
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(JSON.parse(cachedUser));
    });

    it('should return user from database and cache it when not in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.getUserByPhoneNumber('+1234567890');

      expect(mockCache.get).toHaveBeenCalledWith('user_+1234567890');
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { phone: '+1234567890' },
      });
      expect(mockCache.set).toHaveBeenCalledWith(
        'user_+1234567890',
        JSON.stringify(mockUser),
      );
      expect(result).toEqual(mockUser);
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

      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: {
          phone: expect.any(Object), // In(phoneNumbers)
          tenantId: 'test-tenant',
        },
      });
      expect(result).toEqual(users);
    });
  });

  describe('getUsersByIds', () => {
    it('should return users by ids', async () => {
      const ids = [1, 2];
      const users = [mockUser];
      mockUserRepository.find.mockResolvedValue(users);

      const result = await service.getUsersByIds(ids);

      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: {
          id: expect.any(Object),
          tenantId: 'test-tenant',
        },
      });
      expect(result).toEqual(users);
    });
  });

  describe('getWaitingList', () => {
    it('should return empty result when no waiting clients', async () => {
      mockQueueService.getWaitingClients.mockResolvedValue([]);

      const result = await service.getWaitingList();

      expect(result).toEqual({
        total_waiting: 0,
        clients: [],
      });
    });

    it('should return formatted waiting list when clients exist', async () => {
      const waitingClients = [{ clientId: 1 }, { clientId: 2 }];
      const usersWithChats = [
        {
          ...mockUser,
          chat: [mockChat],
        },
      ];
      mockQueueService.getWaitingClients.mockResolvedValue(waitingClients);
      mockQueryBuilder.getMany.mockResolvedValue(usersWithChats);

      const result = await service.getWaitingList();

      expect(result).toEqual({
        totalWaiting: 2,
        clients: [
          {
            id: 1,
            name: 'Test User',
            email: 'test@example.com',
            chat: {
              chatId: 1,
              roomId: 1,
              clientId: 1,
              counselorId: 2,
              status: ChatStatus.PAUSED,
              startedAt: mockChat.startedAt,
              endedAt: undefined,
            },
          },
        ],
      });
    });
  });

  describe('getMinimalUserInfo', () => {
    it('should return null when user is null', async () => {
      const result = await service.getMinimalUserInfo(null);

      expect(result).toBeNull();
    });

    it('should return formatted user info with CLIENT role', async () => {
      const mockRoles = [{ id: 1, name: UserRole.CLIENT }];
      mockGroupService.getUserRolesByUserId.mockResolvedValue(mockRoles);

      const result = await service.getMinimalUserInfo(mockUser);

      expect(mockGroupService.getUserRolesByUserId).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        id: 1,
        userId: 1,
        name: 'Test User',
        email: 'test@example.com',
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
        phone: '+1234567890',
      });
    });

    it('should return formatted user info with ADMIN role when user has ADMIN', async () => {
      const mockRoles = [
        { id: 1, name: UserRole.CLIENT },
        { id: 2, name: UserRole.ADMIN },
      ];
      mockGroupService.getUserRolesByUserId.mockResolvedValue(mockRoles);

      const result = await service.getMinimalUserInfo(mockUser);

      expect(result?.role).toEqual(UserRole.ADMIN);
    });

    it('should return formatted user info with COUNSELOR role when user has COUNSELOR but not ADMIN', async () => {
      const mockRoles = [
        { id: 1, name: UserRole.CLIENT },
        { id: 2, name: UserRole.COUNSELOR },
      ];
      mockGroupService.getUserRolesByUserId.mockResolvedValue(mockRoles);

      const result = await service.getMinimalUserInfo(mockUser);

      expect(result?.role).toEqual(UserRole.COUNSELOR);
    });
  });

  describe('createUser', () => {
    it('should create and save user with provided data', async () => {
      const userData = {
        phoneNumber: '+1234567890',
        name: 'Test User',
        email: 'test@example.com',
        status: UserStatus.ACTIVE,
        username: 'testuser',
        tenantId: 'test-tenant',
      };
      const createdUser = { ...mockUser, ...userData };
      mockUserRepository.create.mockReturnValue(createdUser);
      mockUserRepository.save.mockResolvedValue(createdUser);

      const result = await service.createUser(userData);

      expect(mockUserRepository.create).toHaveBeenCalledWith({
        phone: '+1234567890',
        name: 'Test User',
        email: 'test@example.com',
        status: UserStatus.ACTIVE,
        username: 'testuser',
        tenantId: 'test-tenant',
      });
      expect(mockUserRepository.save).toHaveBeenCalledWith(createdUser);
      expect(result).toEqual(createdUser);
    });

    it('should create user with default values when optional fields not provided', async () => {
      const userData = {
        phoneNumber: '+1234567890',
      };
      const createdUser = { ...mockUser, ...userData };
      mockUserRepository.create.mockReturnValue(createdUser);
      mockUserRepository.save.mockResolvedValue(createdUser);

      const result = await service.createUser(userData);

      expect(mockUserRepository.create).toHaveBeenCalledWith({
        phone: '+1234567890',
        name: 'Anonymous user',
        email: '+1234567890@placeholder.com',
        status: UserStatus.ACTIVE,
        username: '+1234567890_user',
        tenantId: 'anonyumous_tenant',
      });
      expect(result).toEqual(createdUser);
    });
  });

  describe('getCounselorNames', () => {
    it('should return counselor names with all optional parameters', async () => {
      const rawCounselors = [
        { id: '1', name: 'Counselor 1' },
        { id: '2', name: 'Counselor 2' },
      ];
      mockQueryBuilder.getRawMany.mockResolvedValue(rawCounselors);
      mockQueryBuilder.getCount.mockResolvedValue(2);

      const result = await service.getCounselorNames(10, 0, 'test');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.name ILIKE :search',
        { search: '%test%' },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [
          { id: 1, name: 'Counselor 1' },
          { id: 2, name: 'Counselor 2' },
        ],
        count: 2,
      });
    });

    it('should return counselor names without optional parameters', async () => {
      const rawCounselors = [{ id: '1', name: 'Counselor 1' }];
      mockQueryBuilder.getRawMany.mockResolvedValue(rawCounselors);
      mockQueryBuilder.getCount.mockResolvedValue(1);

      const result = await service.getCounselorNames();

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'user.name ILIKE :search',
        expect.any(Object),
      );
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [{ id: 1, name: 'Counselor 1' }],
        count: 1,
      });
    });

    it('should return counselor names with offset parameter', async () => {
      const rawCounselors = [{ id: '2', name: 'Counselor 2' }];
      mockQueryBuilder.getRawMany.mockResolvedValue(rawCounselors);
      mockQueryBuilder.getCount.mockResolvedValue(1);

      const result = await service.getCounselorNames(undefined, 5);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'user.name ILIKE :search',
        expect.any(Object),
      );
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        data: [{ id: 2, name: 'Counselor 2' }],
        count: 1,
      });
    });
  });

  describe('getUserByExternalId', () => {
    it('should return user by external id', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getUserByExternalId('ext-123');

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { externalId: 'ext-123', tenantId: 'test-tenant' },
      });
      expect(result).toEqual(mockUser);
    });
  });
});
