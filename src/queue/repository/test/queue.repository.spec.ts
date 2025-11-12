import { Test, TestingModule } from '@nestjs/testing';
import { QueueRepository } from '../queue.repository';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { QueueEntry } from '../../entity/queue-entry.entity';
import { QueueStatus } from '../../../common/constants/chat.constants';

describe('QueueRepository', () => {
  let repository: QueueRepository;
  let entityManager: EntityManager;

  const mockQueueEntry: QueueEntry = {
    entryId: 1,
    clientId: 123,
    chatId: 456,
    priority: 1,
    waitStartTime: new Date(),
    status: QueueStatus.WAITING,
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDataSource = {
    createEntityManager: jest.fn(),
    getRepository: jest.fn(),
  };

  const mockEntityManager = {
    getRepository: jest.fn(),
  };

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<QueueRepository>(QueueRepository);
    entityManager = mockEntityManager as unknown as EntityManager;

    mockDataSource.createEntityManager.mockReturnValue({});
    mockDataSource.getRepository.mockReturnValue(mockRepository);
    mockEntityManager.getRepository.mockReturnValue(mockRepository);

    // Setup spies on inherited methods
    jest.spyOn(repository, 'create').mockImplementation(mockRepository.create);
    jest.spyOn(repository, 'save').mockImplementation(mockRepository.save);
    jest.spyOn(repository, 'find').mockImplementation(mockRepository.find);
    jest
      .spyOn(repository, 'findOne')
      .mockImplementation(mockRepository.findOne);
    jest.spyOn(repository, 'update').mockImplementation(mockRepository.update);
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockImplementation(mockRepository.createQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueue', () => {
    it('should create and save a new queue entry', async () => {
      const queueData = {
        clientId: 123,
        chatId: 456,
        priority: 1,
        waitStartTime: new Date(),
        tenantId: 'test-tenant',
      };

      mockRepository.create.mockReturnValue(mockQueueEntry);
      mockRepository.save.mockResolvedValue(mockQueueEntry);

      const result = await repository.enqueue(queueData);

      expect(result).toEqual(mockQueueEntry);
      expect(repository.create).toHaveBeenCalledWith(queueData);
      expect(repository.save).toHaveBeenCalledWith(mockQueueEntry);
    });

    it('should use entityManager when provided', async () => {
      const queueData = {
        clientId: 123,
        chatId: 456,
        priority: 1,
        waitStartTime: new Date(),
        tenantId: 'test-tenant',
      };

      mockRepository.create.mockReturnValue(mockQueueEntry);
      mockRepository.save.mockResolvedValue(mockQueueEntry);

      const result = await repository.enqueue(queueData, entityManager);

      expect(result).toEqual(mockQueueEntry);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
    });
  });

  describe('getStats', () => {
    it('should get queue stats without status filter', async () => {
      const mockQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockQueueEntry]),
      } as unknown as SelectQueryBuilder<QueueEntry>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getStats(undefined, 'test-tenant');

      expect(result).toEqual([mockQueueEntry]);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'queue.priority',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'queue.waitStartTime',
        'ASC',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'queue.tenantId = :tenantId',
        { tenantId: 'test-tenant' },
      );
      expect(mockQueryBuilder.where).not.toHaveBeenCalled();
    });

    it('should get queue stats with status filter', async () => {
      const mockQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockQueueEntry]),
      } as unknown as SelectQueryBuilder<QueueEntry>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getStats(
        QueueStatus.WAITING,
        'test-tenant',
      );

      expect(result).toEqual([mockQueueEntry]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'queue.status = :status',
        { status: QueueStatus.WAITING },
      );
    });

    it('should use entityManager when provided', async () => {
      const mockQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockQueueEntry]),
      } as unknown as SelectQueryBuilder<QueueEntry>;

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getStats(
        undefined,
        'test-tenant',
        entityManager,
      );

      expect(result).toEqual([mockQueueEntry]);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
    });
  });

  describe('getWaitingClients', () => {
    it('should get waiting clients', async () => {
      mockRepository.find.mockResolvedValue([mockQueueEntry]);

      const result = await repository.getWaitingClients('test-tenant');

      expect(result).toEqual([mockQueueEntry]);
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          status: QueueStatus.WAITING,
          tenantId: 'test-tenant',
        },
      });
    });

    it('should use entityManager when provided', async () => {
      mockRepository.find.mockResolvedValue([mockQueueEntry]);

      const result = await repository.getWaitingClients(
        'test-tenant',
        entityManager,
      );

      expect(result).toEqual([mockQueueEntry]);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
    });
  });

  describe('getQueueByChatId', () => {
    it('should get queue entry by chatId', async () => {
      mockRepository.findOne.mockResolvedValue(mockQueueEntry);

      const result = await repository.getQueueByChatId(456, 'test-tenant');

      expect(result).toEqual(mockQueueEntry);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { chatId: 456, tenantId: 'test-tenant' },
      });
    });

    it('should return null if not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.getQueueByChatId(999, 'test-tenant');

      expect(result).toBeNull();
    });

    it('should use entityManager when provided', async () => {
      mockRepository.findOne.mockResolvedValue(mockQueueEntry);

      const result = await repository.getQueueByChatId(
        456,
        'test-tenant',
        entityManager,
      );

      expect(result).toEqual(mockQueueEntry);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
    });
  });

  describe('updateQueueStatus', () => {
    it('should update queue status and return true', async () => {
      mockRepository.update.mockResolvedValue({ affected: 1 });

      const result = await repository.updateQueueStatus(
        1,
        QueueStatus.MATCHED,
        'test-tenant',
      );

      expect(result).toBe(true);
      expect(repository.update).toHaveBeenCalledWith(
        { entryId: 1, tenantId: 'test-tenant' },
        { status: QueueStatus.MATCHED },
      );
    });

    it('should return false if no rows affected', async () => {
      mockRepository.update.mockResolvedValue({ affected: 0 });

      const result = await repository.updateQueueStatus(
        999,
        QueueStatus.MATCHED,
        'test-tenant',
      );

      expect(result).toBe(false);
    });

    it('should use entityManager when provided', async () => {
      mockRepository.update.mockResolvedValue({ affected: 1 });

      const result = await repository.updateQueueStatus(
        1,
        QueueStatus.MATCHED,
        'test-tenant',
        entityManager,
      );

      expect(result).toBe(true);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(QueueEntry);
    });
  });
});
