import { Test, TestingModule } from '@nestjs/testing';
import { ChatRepository } from '../chat.repository';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Chat } from '../../../common/entities/chat.entity';
import { UpdateChatInput } from '../../type/chat.type';
import { ChatSummaryStatus } from '../../../common/entities/chat.entity';

describe('ChatRepository', () => {
  let repository: ChatRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let chatRepo: jest.Mocked<Repository<Chat>>;
  let mockQueryBuilder: any;

  const mockUpdateChatInput: UpdateChatInput = {
    summaryStatus: ChatSummaryStatus.SUCCESS,
    metadata: { key: 'value' },
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };

    const mockCreateQueryBuilder = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue(mockQueryBuilder),
    });

    chatRepo = {
      createQueryBuilder: mockCreateQueryBuilder,
    } as any;

    entityManager = {
      getRepository: jest.fn().mockReturnValue(chatRepo),
    } as any;

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(entityManager),
      getRepository: jest.fn().mockReturnValue(chatRepo),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<ChatRepository>(ChatRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    // it('should initialize with DataSource', () => {
    //   expect(repository).toBeDefined();
    //   expect(dataSource.createEntityManager).toHaveBeenCalled();
    // });
  });

  describe('updateChat', () => {
    // it('should return false when no updates are provided', async () => {
    //   const emptyInput: UpdateChatInput = {};
    //   mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

    //   const result = await repository.updateChat(1, emptyInput);

    //   expect(result).toBe(false);
    //   expect(chatRepo.createQueryBuilder).toHaveBeenCalledWith('chat');
    //   expect(mockQueryBuilder.set).not.toHaveBeenCalled();
    //   expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :chatId', {
    //     chatId: 1,
    //   });
    // });

    it('should return false when update affects 0 rows', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(false);
      expect(mockQueryBuilder.set).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :chatId', {
        chatId: 1,
      });
    });

    it('should return true when update affects rows', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(true);
      expect(mockQueryBuilder.set).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :chatId', {
        chatId: 1,
      });
    });

    it('should set metadata as function that returns correct SQL', async () => {
      const inputWithMetadata: UpdateChatInput = {
        metadata: { key: 'value' },
      };
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await repository.updateChat(1, inputWithMetadata);

      // Get the setObj that was passed to set()
      const setCall = mockQueryBuilder.set.mock.calls[0][0];
      const metadataFunction = setCall.metadata;

      // Execute the function to verify it returns the correct SQL
      const result = metadataFunction();
      expect(result).toBe('"metadata" || \'[{"key":"value"}]\'::jsonb');
    });

    it('should use EntityManager when provided', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await repository.updateChat(1, mockUpdateChatInput, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(Chat);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should use DataSource when EntityManager not provided', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(dataSource.getRepository).toHaveBeenCalledWith(Chat);
      expect(entityManager.getRepository).not.toHaveBeenCalled();
    });

    it('should handle both summaryStatus and metadata updates', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        summaryStatus: ChatSummaryStatus.SUCCESS,
        metadata: expect.any(Function),
      });
    });
  });
});
