import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../queue.service';
import { QueueStatus } from 'src/common/constants/chat.constants';
import { ChatService } from 'src/chat/service/chat.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { QueueRepository } from 'src/queue/repository/queue.repository';

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

  const mockQueueEntry = {
    entryId: 1,
    clientId: 123,
    chatId: 456,
    priority: 5,
    waitStartTime: new Date('2024-01-01T10:00:00Z'),
    status: QueueStatus.WAITING,
    tenantId: 'test-tenant',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

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
    mockQueueRepository = {
      enqueue: jest.fn(),
      getStats: jest.fn(),
      getWaitingClients: jest.fn(),
      getQueueByChatId: jest.fn(),
      updateQueueStatus: jest.fn(),
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
          provide: QueueRepository,
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
      mockQueueRepository.enqueue.mockResolvedValue(mockQueueEntry);

      const result = await service.enqueue(enqueueData);

      expect(mockQueueRepository.enqueue).toHaveBeenCalledWith(
        {
          clientId: 123,
          chatId: 456,
          priority: 5,
          waitStartTime: expect.any(Date),
          tenantId: 'test-tenant',
        },
        undefined,
      );
      expect(result).toEqual(mockQueueEntry);
    });

    it('should enqueue with entity manager', async () => {
      const enqueueData = { userId: 123, chatId: 456, priority: 5 };
      mockQueueRepository.enqueue.mockResolvedValue(mockQueueEntry);

      const result = await service.enqueue(enqueueData, mockEntityManager);

      expect(mockQueueRepository.enqueue).toHaveBeenCalledWith(
        {
          clientId: 123,
          chatId: 456,
          priority: 5,
          waitStartTime: expect.any(Date),
          tenantId: 'test-tenant',
        },
        mockEntityManager,
      );
      expect(result).toEqual(mockQueueEntry);
    });
  });

  describe('getStats', () => {
    it('should get stats without status filter', async () => {
      mockQueueRepository.getStats.mockResolvedValue(mockQueueStats);

      const result = await service.getStats();

      expect(mockQueueRepository.getStats).toHaveBeenCalledWith(
        undefined,
        'test-tenant',
        undefined,
      );
      expect(result).toEqual(mockQueueStats);
    });

    it('should get stats with status filter', async () => {
      mockQueueRepository.getStats.mockResolvedValue([mockQueueStats[0]]);

      const result = await service.getStats(QueueStatus.WAITING);

      expect(mockQueueRepository.getStats).toHaveBeenCalledWith(
        QueueStatus.WAITING,
        'test-tenant',
        undefined,
      );
      expect(result).toEqual([mockQueueStats[0]]);
    });

    it('should get stats with entity manager', async () => {
      mockQueueRepository.getStats.mockResolvedValue(mockQueueStats);

      const result = await service.getStats(undefined, mockEntityManager);

      expect(mockQueueRepository.getStats).toHaveBeenCalledWith(
        undefined,
        'test-tenant',
        mockEntityManager,
      );
      expect(result).toEqual(mockQueueStats);
    });
  });

  describe('getWaitingClients', () => {
    it('should return waiting clients', async () => {
      const waitingClients = [mockQueueEntry];
      mockQueueRepository.getWaitingClients.mockResolvedValue(waitingClients);

      const result = await service.getWaitingClients();

      expect(mockQueueRepository.getWaitingClients).toHaveBeenCalledWith(
        'test-tenant',
      );
      expect(result).toEqual(waitingClients);
    });
  });

  describe('getQueueByChatId', () => {
    it('should get queue by chat id with default repository', async () => {
      mockQueueRepository.getQueueByChatId.mockResolvedValue(mockQueueEntry);

      const result = await service.getQueueByChatId(456);

      expect(mockQueueRepository.getQueueByChatId).toHaveBeenCalledWith(
        456,
        'test-tenant',
        undefined,
      );
      expect(result).toEqual(mockQueueEntry);
    });

    it('should get queue by chat id with entity manager', async () => {
      mockQueueRepository.getQueueByChatId.mockResolvedValue(mockQueueEntry);

      const result = await service.getQueueByChatId(456, mockEntityManager);

      expect(mockQueueRepository.getQueueByChatId).toHaveBeenCalledWith(
        456,
        'test-tenant',
        mockEntityManager,
      );
      expect(result).toEqual(mockQueueEntry);
    });
  });

  describe('updateQueueStatus', () => {
    it('should update queue status with default repository', async () => {
      mockQueueRepository.updateQueueStatus.mockResolvedValue(true);

      const result = await service.updateQueueStatus(1, QueueStatus.MATCHED);

      expect(mockQueueRepository.updateQueueStatus).toHaveBeenCalledWith(
        1,
        QueueStatus.MATCHED,
        'test-tenant',
        undefined,
      );
      expect(result).toBe(true);
    });

    it('should update queue status with entity manager', async () => {
      mockQueueRepository.updateQueueStatus.mockResolvedValue(true);

      const result = await service.updateQueueStatus(
        1,
        QueueStatus.MATCHED,
        mockEntityManager,
      );

      expect(mockQueueRepository.updateQueueStatus).toHaveBeenCalledWith(
        1,
        QueueStatus.MATCHED,
        'test-tenant',
        mockEntityManager,
      );
      expect(result).toBe(true);
    });
  });
});
