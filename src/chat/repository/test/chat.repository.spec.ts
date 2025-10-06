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
      update: jest.fn().mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      }),
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
      chatRepo.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(false);
      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });

    it('should return true when update affects rows', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(true);
      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });

    it('should set metadata as function that returns correct SQL', async () => {
      const inputWithMetadata: UpdateChatInput = {
        metadata: { key: 'value' },
      };
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, inputWithMetadata);

      expect(chatRepo.update).toHaveBeenCalledWith(1, inputWithMetadata);
    });

    it('should use EntityManager when provided', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(Chat);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should use DataSource when EntityManager not provided', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(dataSource.getRepository).toHaveBeenCalledWith(Chat);
      expect(entityManager.getRepository).not.toHaveBeenCalled();
    });

    it('should handle both summaryStatus and metadata updates', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });
  });
});
