import { Test, TestingModule } from '@nestjs/testing';
import { MessageRepository } from '../message.repository';
import { DataSource } from 'typeorm';
import { MessageType } from '../../entity/message.entity';

describe('MessageRepository', () => {
  let repository: MessageRepository;
  let mockQueryBuilder: any;

  const mockTenantId = 'test-tenant';

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      getRepository: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<MessageRepository>(MessageRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessagesByChatIdQuery', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should get messages with default sorting', async () => {
      const mockMessages = [{ id: 1, content: 'Test' }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockMessages, 1]);

      const result = await repository.getMessagesByChatIdQuery(1, mockTenantId);

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('message');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.chatId = :chatId',
        { chatId: 1 },
      );
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'message.feedback',
        expect.anything(),
        'feedback',
        'feedback.messageId = message.id',
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(result).toEqual({ messages: mockMessages, count: 1 });
    });

    it('should apply type filter', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getMessagesByChatIdQuery(1, mockTenantId, {
        type: MessageType.NUDGE,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.type = :type',
        { type: MessageType.NUDGE },
      );
    });

    it('should apply pagination', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getMessagesByChatIdQuery(1, mockTenantId, {
        limit: 10,
        offset: 5,
      });

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should apply custom sorting', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getMessagesByChatIdQuery(1, mockTenantId, {
        sortBy: 'id',
        order: 'ASC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.id',
        'ASC',
      );
    });

    it('should use default sort column for invalid sortBy', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getMessagesByChatIdQuery(1, mockTenantId, {
        sortBy: 'invalid_column',
        order: 'ASC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'ASC',
      );
    });

    it('should use entity manager when provided', async () => {
      const mockEntityManagerQueryBuilder = {
        ...mockQueryBuilder,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest
            .fn()
            .mockReturnValue(mockEntityManagerQueryBuilder),
        }),
      };

      await repository.getMessagesByChatIdQuery(
        1,
        mockTenantId,
        {},
        mockEntityManager as any,
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalled();
    });
  });

  describe('getChatHistoryQuery', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should get chat history with default sorting', async () => {
      const mockMessages = [{ id: 1, content: 'Test' }];
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getChatHistoryQuery(1, mockTenantId);

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('message');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'message.sender',
        expect.anything(),
        'sender',
        'sender.id = message.senderId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.chatId = :chatId',
        { chatId: 1 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.type = :type',
        { type: MessageType.TEXT },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(result).toEqual(mockMessages);
    });

    it('should apply pagination', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await repository.getChatHistoryQuery(1, mockTenantId, {
        limit: 10,
        offset: 5,
      });

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should apply custom sorting when sortBy is provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await repository.getChatHistoryQuery(1, mockTenantId, {
        sortBy: 'id',
        order: 'ASC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.id',
        'ASC',
      );
    });

    it('should not apply pagination when not provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await repository.getChatHistoryQuery(1, mockTenantId);

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should use default sort column for invalid sortBy', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await repository.getChatHistoryQuery(1, mockTenantId, {
        sortBy: 'invalid_column',
        order: 'DESC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
    });
  });

  describe('getValidatedSortColumn (private)', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should return createdAt for undefined sortBy', async () => {
      await repository.getMessagesByChatIdQuery(1, mockTenantId, {});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
    });

    it('should accept valid sort columns', async () => {
      await repository.getMessagesByChatIdQuery(1, mockTenantId, {
        sortBy: 'id',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.id',
        'DESC',
      );
    });
  });

  describe('deleteMessageByChatId', () => {
    it('should delete messages and return true when affected', async () => {
      const mockDataSource = {
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      };
      (repository as any).dataSource = mockDataSource;

      const result = await repository.deleteMessageByChatId(1, mockTenantId);

      expect(mockDataSource.getRepository).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when no rows affected', async () => {
      const mockDataSource = {
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
      };
      (repository as any).dataSource = mockDataSource;

      const result = await repository.deleteMessageByChatId(1, mockTenantId);

      expect(result).toBe(false);
    });

    it('should use entity manager when provided', async () => {
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      };

      const result = await repository.deleteMessageByChatId(
        1,
        mockTenantId,
        mockEntityManager as any,
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
