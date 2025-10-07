import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ChatAudioUploadRepository } from '../chat-audio-upload.repository';
import { ChatAudioUploads } from '../../../common/entities/chat-audio-uploads.entity';

describe('ChatAudioUploadRepository', () => {
  let repository: ChatAudioUploadRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let mockRepository: jest.Mocked<Repository<ChatAudioUploads>>;

  beforeEach(async () => {
    mockRepository = {
      delete: jest.fn(),
    } as any;

    const mockEntityManager = {
      getRepository: jest.fn(),
    } as any;

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatAudioUploadRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ChatAudioUploadRepository>(
      ChatAudioUploadRepository,
    );
    dataSource = module.get(DataSource);
    entityManager = mockEntityManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(repository).toBeDefined();
    });

    it('should extend Repository', () => {
      expect(repository).toBeInstanceOf(Repository);
    });
  });

  describe('deleteChatAudioUploadsByChatId', () => {
    const chatId = 123;
    const tenantId = 'tenant-456';

    it('should delete audio uploads and return true when records are affected', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1, raw: {} });

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
      );

      expect(result).toBe(true);
      expect(dataSource.getRepository).toHaveBeenCalledWith(ChatAudioUploads);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId,
        tenantId,
      });
    });

    it('should return false when no records are affected', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0, raw: {} });

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
      );

      expect(result).toBe(false);
      expect(dataSource.getRepository).toHaveBeenCalledWith(ChatAudioUploads);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId,
        tenantId,
      });
    });

    it('should return true when affected is undefined', async () => {
      // When affected is undefined, the condition (affected !== 0) is true
      mockRepository.delete.mockResolvedValue({ raw: {} } as any);

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
      );

      expect(result).toBe(true);
      expect(dataSource.getRepository).toHaveBeenCalledWith(ChatAudioUploads);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId,
        tenantId,
      });
    });

    it('should return true when affected is null', async () => {
      // When affected is null, the condition (affected !== 0) is true
      mockRepository.delete.mockResolvedValue({
        affected: null,
        raw: {},
      } as any);

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
      );

      expect(result).toBe(true);
      expect(dataSource.getRepository).toHaveBeenCalledWith(ChatAudioUploads);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId,
        tenantId,
      });
    });

    it('should use entity manager repository when provided', async () => {
      const emRepository = {
        delete: jest.fn().mockResolvedValue({ affected: 2, raw: {} }),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
        entityManager,
      );

      expect(result).toBe(true);
      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ChatAudioUploads,
      );
      expect(emRepository.delete).toHaveBeenCalledWith({ chatId, tenantId });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should use entity manager repository and return false when no records affected', async () => {
      const emRepository = {
        delete: jest.fn().mockResolvedValue({ affected: 0, raw: {} }),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
        entityManager,
      );

      expect(result).toBe(false);
      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ChatAudioUploads,
      );
      expect(emRepository.delete).toHaveBeenCalledWith({ chatId, tenantId });
    });

    it('should handle multiple affected records', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 5, raw: {} });

      const result = await repository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId,
      );

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId,
        tenantId,
      });
    });

    it('should handle deletion with different chatId and tenantId', async () => {
      const differentChatId = 999;
      const differentTenantId = 'tenant-999';

      mockRepository.delete.mockResolvedValue({ affected: 1, raw: {} });

      const result = await repository.deleteChatAudioUploadsByChatId(
        differentChatId,
        differentTenantId,
      );

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith({
        chatId: differentChatId,
        tenantId: differentTenantId,
      });
    });
  });
});
