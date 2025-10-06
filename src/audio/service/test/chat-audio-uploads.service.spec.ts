import { Test, TestingModule } from '@nestjs/testing';
import { Repository, EntityManager } from 'typeorm';
import { ChatAudioUploadsService } from '../chat-audio-uploads.service';
import {
  ChatAudioUploads,
  ChatAudioUploadStatus,
} from '../../../common/entities/chat-audio-uploads.entity';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { ChatAudioUploadRepository } from '../../repository/chat-audio-upload.repository';
import { S3Service } from '../../../aws/service/s3.service';
import { AppConfigService } from '../../../config/config.service';

// Mock the static class
jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
    getCurrentContext: jest.fn(),
    setAuthContext: jest.fn(),
  },
}));

describe('ChatAudioUploadsService', () => {
  let service: ChatAudioUploadsService;
  let repository: jest.Mocked<Repository<ChatAudioUploads>>;
  let entityManager: jest.Mocked<EntityManager>;
  let s3Service: jest.Mocked<S3Service>;

  const mockTenantId = 'tenant-123';
  const mockAudioUpload = {
    id: 'upload-123',
    chatId: 456,
    storageKey: 'test-key',
    status: ChatAudioUploadStatus.PENDING,
    sampleRate: 8000,
    format: 'raw',
    tenantId: mockTenantId,
  } as ChatAudioUploads;

  beforeEach(async () => {
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);

    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    };

    const mockEntityManager = {
      getRepository: jest.fn(),
    };

    const mockS3Service = {
      deleteObject: jest.fn(),
    };

    const mockConfigService = {
      s3: {
        audioBucket: 'test-bucket',
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatAudioUploadsService,
        {
          provide: ChatAudioUploadRepository,
          useValue: mockRepository,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ChatAudioUploadsService>(ChatAudioUploadsService);
    repository = module.get(ChatAudioUploadRepository);
    s3Service = module.get(S3Service);
    entityManager = mockEntityManager as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAudioUpload', () => {
    it('should handle error during creation', async () => {
      const data = { chatId: 456, storageKey: 'test-key' };
      const error = new Error('Database error');

      repository.create.mockReturnValue(mockAudioUpload);
      repository.save.mockRejectedValue(error);

      await expect(service.createAudioUpload(data)).rejects.toThrow(
        'Database error',
      );

      expect(repository.create).toHaveBeenCalledWith({
        ...data,
        status: ChatAudioUploadStatus.PENDING,
        tenantId: mockTenantId,
      });
      expect(repository.save).toHaveBeenCalledWith(mockAudioUpload);
    });

    it('should create audio upload successfully', async () => {
      const data = { chatId: 456, storageKey: 'test-key' };

      repository.create.mockReturnValue(mockAudioUpload);
      repository.save.mockResolvedValue(mockAudioUpload);

      const result = await service.createAudioUpload(data);

      expect(result).toEqual(mockAudioUpload);
      expect(repository.create).toHaveBeenCalledWith({
        ...data,
        status: ChatAudioUploadStatus.PENDING,
        tenantId: mockTenantId,
      });
      expect(repository.save).toHaveBeenCalledWith(mockAudioUpload);
    });

    it('should create audio upload with entity manager', async () => {
      const data = { chatId: 456, storageKey: 'test-key' };
      const mockRepo = { create: jest.fn(), save: jest.fn() };

      entityManager.getRepository.mockReturnValue(mockRepo as any);
      mockRepo.create.mockReturnValue(mockAudioUpload);
      mockRepo.save.mockResolvedValue(mockAudioUpload);

      const result = await service.createAudioUpload(data, entityManager);

      expect(result).toEqual(mockAudioUpload);
      expect(entityManager.getRepository).toHaveBeenCalledWith(
        ChatAudioUploads,
      );
      expect(mockRepo.create).toHaveBeenCalledWith({
        ...data,
        status: ChatAudioUploadStatus.PENDING,
        tenantId: mockTenantId,
      });
    });
  });

  describe('updateAudioUpload', () => {
    it('should handle error during update', async () => {
      const chatId = 456;
      const data = { status: ChatAudioUploadStatus.SUCCESS };
      const error = new Error('Update error');

      repository.update.mockRejectedValue(error);

      await expect(service.updateAudioUpload(chatId, data)).rejects.toThrow(
        'Update error',
      );

      expect(repository.update).toHaveBeenCalledWith(
        { chatId },
        {
          status: ChatAudioUploadStatus.SUCCESS,
          sampleRate: undefined,
          storageKey: undefined,
          format: undefined,
        },
      );
    });

    it('should handle audio upload not found after update', async () => {
      const chatId = 456;
      const data = { status: ChatAudioUploadStatus.SUCCESS };

      repository.update.mockResolvedValue({ affected: 1 } as any);
      repository.findOne.mockResolvedValue(null);

      await expect(service.updateAudioUpload(chatId, data)).rejects.toThrow(
        `Audio upload not found for chatId: ${chatId}`,
      );

      expect(repository.update).toHaveBeenCalledWith(
        { chatId },
        {
          status: ChatAudioUploadStatus.SUCCESS,
          sampleRate: undefined,
          storageKey: undefined,
          format: undefined,
        },
      );
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });

    it('should update audio upload successfully', async () => {
      const chatId = 456;
      const data = { status: ChatAudioUploadStatus.SUCCESS };

      repository.update.mockResolvedValue({ affected: 1 } as any);
      repository.findOne.mockResolvedValue(mockAudioUpload);

      const result = await service.updateAudioUpload(chatId, data);

      expect(result).toEqual(mockAudioUpload);
      expect(repository.update).toHaveBeenCalledWith(
        { chatId },
        {
          status: ChatAudioUploadStatus.SUCCESS,
          sampleRate: undefined,
          storageKey: undefined,
          format: undefined,
        },
      );
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });
  });

  describe('getAudioUpload', () => {
    it('should return null when audio upload not found', async () => {
      const chatId = 456;

      repository.findOne.mockResolvedValue(null);

      const result = await service.getAudioUpload(chatId);

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });

    it('should return audio upload when found', async () => {
      const chatId = 456;

      repository.findOne.mockResolvedValue(mockAudioUpload);

      const result = await service.getAudioUpload(chatId);

      expect(result).toEqual(mockAudioUpload);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });
  });

  describe('deleteUploadedAudioFile', () => {
    it('should return false when no audio upload found', async () => {
      const chatId = 456;

      repository.findOne.mockResolvedValue(null);

      const result = await service.deleteUploadedAudioFile(chatId);

      expect(result).toBe(false);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });

    it('should return false when audio upload has no storage key', async () => {
      const chatId = 456;
      const audioUploadWithoutKey = { ...mockAudioUpload, storageKey: null };

      repository.findOne.mockResolvedValue(audioUploadWithoutKey as any);

      const result = await service.deleteUploadedAudioFile(chatId);

      expect(result).toBe(false);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
    });

    it('should successfully delete audio file', async () => {
      const chatId = 456;

      repository.findOne.mockResolvedValue(mockAudioUpload);
      s3Service.deleteObject.mockResolvedValue({} as any);

      const result = await service.deleteUploadedAudioFile(chatId);

      expect(result).toBe(true);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
      expect(s3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'test-key',
      });
    });

    it('should return false when S3 delete fails', async () => {
      const chatId = 456;
      const error = new Error('S3 delete failed');

      repository.findOne.mockResolvedValue(mockAudioUpload);
      s3Service.deleteObject.mockRejectedValue(error);

      const result = await service.deleteUploadedAudioFile(chatId);

      expect(result).toBe(false);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
      expect(s3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'test-key',
      });
    });

    it('should handle S3 delete when file does not exist', async () => {
      const chatId = 456;
      const notFoundError = new Error(
        'NoSuchKey: The specified key does not exist',
      );

      repository.findOne.mockResolvedValue(mockAudioUpload);
      s3Service.deleteObject.mockRejectedValue(notFoundError);

      const result = await service.deleteUploadedAudioFile(chatId);

      expect(result).toBe(false);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { chatId } });
      expect(s3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'test-key',
      });
    });
  });
});
