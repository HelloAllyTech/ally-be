import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../queue.service';
import { QueueEntry } from 'src/queue/entity/queue-entry.entity';
import { QueueStatus } from 'src/common/constants/chat.constants';
import { ChatService } from 'src/chat/service/chat.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
  },
}));

describe('QueueService', () => {
  let service: QueueService;
  let mockQueueRepository: any;
  let mockChatService: any;
  let mockEntityManager: any;
  let mockQueryBuilder: any;

  const mockQueueEntry: QueueEntry = {
    entryId: 1,
    clientId: 123,
    chatId: 456,
    priority: 5,
    waitStartTime: new Date('2024-01-01T10:00:00Z'),
    status: QueueStatus.WAITING,
    tenantId: 'test-tenant',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  } as QueueEntry;

  const mockQueueStats = [
    {
      entryId: 1,
      clientId: 123,
      chatId: 456,
      priority: 5,
      waitStartTime: new Date('2024-01-01T10:00:00Z'),
      status: QueueStatus.WAITING,
    },
    {
      entryId: 2,
      clientId: 124,
      chatId: 457,
      priority: 3,
      waitStartTime: new Date('2024-01-01T11:00:00Z'),
      status: QueueStatus.MATCHED,
    },
  ];

  beforeEach(async () => {
    mockQueryBuilder = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    mockQueueRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    };

    mockEntityManager = {
      getRepository: jest.fn(() => mockQueueRepository),
    };

    mockChatService = {
      // Mock ChatService methods if needed
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: 'QueueEntryRepository', // getRepositoryToken(QueueEntry)
          useValue: mockQueueRepository,
        },
        { provide: ChatService, useValue: mockChatService },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('test-tenant');
  });

  describe('enqueue', () => {
    it('should enqueue with default repository', async () => {
      const enqueueData = { userId: 123, chatId: 456, priority: 5 };
      mockQueueRepository.create.mockReturnValue(mockQueueEntry);
      mockQueueRepository.save.mockResolvedValue(mockQueueEntry);

      const result = await service.enqueue(enqueueData);

      expect(mockQueueRepository.create).toHaveBeenCalledWith({
        clientId: 123,
        chatId: 456,
        priority: 5,
        waitStartTime: expect.any(Date),
        tenantId: 'test-tenant',
      });
      expect(mockQueueRepository.save).toHaveBeenCalledWith(mockQueueEntry);
      expect(result).toEqual(mockQueueEntry);
    });

    it('should enqueue with entity manager', async () => {
      const enqueueData = { userId: 123, chatId: 456, priority: 5 };
      mockQueueRepository.create.mockReturnValue(mockQueueEntry);
      mockQueueRepository.save.mockResolvedValue(mockQueueEntry);

      const result = await service.enqueue(enqueueData, mockEntityManager);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
      expect(mockQueueRepository.create).toHaveBeenCalledWith({
        clientId: 123,
        chatId: 456,
        priority: 5,
        waitStartTime: expect.any(Date),
        tenantId: 'test-tenant',
      });
      expect(mockQueueRepository.save).toHaveBeenCalledWith(mockQueueEntry);
      expect(result).toEqual(mockQueueEntry);
    });
  });

  describe('getStats', () => {
    it('should get stats without status filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue(mockQueueStats);

      const result = await service.getStats();

      expect(mockQueueRepository.createQueryBuilder).toHaveBeenCalledWith(
        'queue',
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'queue.priority',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'queue.waitStartTime',
        'ASC',
      );
      expect(mockQueryBuilder.where).not.toHaveBeenCalled();
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'queue.tenantId = :tenantId',
        {
          tenantId: 'test-tenant',
        },
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(mockQueueStats);
    });

    it('should get stats with status filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([mockQueueStats[0]]);

      const result = await service.getStats(QueueStatus.WAITING);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'queue.status = :status',
        {
          status: QueueStatus.WAITING,
        },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'queue.tenantId = :tenantId',
        {
          tenantId: 'test-tenant',
        },
      );
      expect(result).toEqual([mockQueueStats[0]]);
    });

    it('should get stats with entity manager', async () => {
      mockQueryBuilder.getMany.mockResolvedValue(mockQueueStats);

      const result = await service.getStats(undefined, mockEntityManager);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
      expect(mockQueueRepository.createQueryBuilder).toHaveBeenCalledWith(
        'queue',
      );
      expect(result).toEqual(mockQueueStats);
    });
  });

  describe('getWaitingClients', () => {
    it('should return waiting clients', async () => {
      const waitingClients = [mockQueueEntry];
      mockQueueRepository.find.mockResolvedValue(waitingClients);

      const result = await service.getWaitingClients();

      expect(mockQueueRepository.find).toHaveBeenCalledWith({
        where: {
          status: QueueStatus.WAITING,
          tenantId: 'test-tenant',
        },
      });
      expect(result).toEqual(waitingClients);
    });
  });

  describe('getQueueByChatId', () => {
    it('should get queue by chat id with default repository', async () => {
      mockQueueRepository.findOne.mockResolvedValue(mockQueueEntry);

      const result = await service.getQueueByChatId(456);

      expect(mockQueueRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 456, tenantId: 'test-tenant' },
      });
      expect(result).toEqual(mockQueueEntry);
    });

    it('should get queue by chat id with entity manager', async () => {
      mockQueueRepository.findOne.mockResolvedValue(mockQueueEntry);

      const result = await service.getQueueByChatId(456, mockEntityManager);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
      expect(mockQueueRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 456, tenantId: 'test-tenant' },
      });
      expect(result).toEqual(mockQueueEntry);
    });
  });

  describe('updateQueueStatus', () => {
    it('should update queue status with default repository', async () => {
      const updateResult = { affected: 1 };
      mockQueueRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateQueueStatus(1, QueueStatus.MATCHED);

      expect(mockQueueRepository.update).toHaveBeenCalledWith(
        { entryId: 1, tenantId: 'test-tenant' },
        { status: QueueStatus.MATCHED },
      );
      expect(result).toEqual(updateResult);
    });

    it('should update queue status with entity manager', async () => {
      const updateResult = { affected: 1 };
      mockQueueRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateQueueStatus(
        1,
        QueueStatus.MATCHED,
        mockEntityManager,
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
      expect(mockQueueRepository.update).toHaveBeenCalledWith(
        { entryId: 1, tenantId: 'test-tenant' },
        { status: QueueStatus.MATCHED },
      );
      expect(result).toEqual(updateResult);
    });
  });
});
