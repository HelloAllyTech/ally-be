import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  AudioChatPlatform,
  AudioChatProvider,
} from 'src/common/constants/chat.constants';
import { ChatAudioUploadStatus } from 'src/common/entities/chat-audio-uploads.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { UserRole } from 'src/common/constants/user.constants';
import { AiEventService } from 'src/ai/service/ai-event.service';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { S3Service } from 'src/aws/service/s3.service';
import {
  AudioUploadRequestDto,
  CancelUploadRequestDto,
} from 'src/chat/dto/audio-upload.dto';
import { ChatStatus, ChatSummaryStatus } from 'src/common/entities/chat.entity';

import { UserService } from 'src/user/user.service';
import { AudioUploadService } from '../audio-upload.service';
import { ChatService } from '../chat.service';
import { LoggerService } from 'src/logger/logger.service';
import { UPLOADED_AUDIO_FILE_SIZE_LIMIT } from 'src/chat/constants/chat.constants';

// Mock the ExecutionManager with all required methods
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
    getCurrentContext: jest.fn(() => ({
      userId: '1',
      role: 'ADMIN',
      tenantId: 1,
    })),
  },
}));

describe('AudioUploadService', () => {
  let service: AudioUploadService;
  let chatService: jest.Mocked<ChatService>;
  let s3Service: jest.Mocked<S3Service>;
  let aiEventService: jest.Mocked<AiEventService>;
  let chatAudioUploadsService: jest.Mocked<ChatAudioUploadsService>;
  let userService: jest.Mocked<UserService>;

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    // Mock LoggerService.getInstance
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioUploadService,
        {
          provide: ChatService,
          useValue: {
            createChatForAnonymousClient: jest.fn(),
            getChatByIdForServiceCall: jest.fn(),
            updateChat: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            generatePresignedUrl: jest.fn(),
            getHeadObject: jest.fn(),
          },
        },
        {
          provide: AiEventService,
          useValue: {
            publishTranscribeAudioEvent: jest.fn(),
          },
        },
        {
          provide: ChatAudioUploadsService,
          useValue: {
            createAudioUpload: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AudioUploadService>(AudioUploadService);
    chatService = module.get(ChatService);
    s3Service = module.get(S3Service);
    aiEventService = module.get(AiEventService);
    chatAudioUploadsService = module.get(ChatAudioUploadsService);
    userService = module.get(UserService);

    // Set environment variable
    process.env.AUDIO_STORAGE_S3_BUCKET = 'test-bucket';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createChatWithUploadUrl', () => {
    const validRequestDto: AudioUploadRequestDto = {
      fileName: 'test-audio.mp3',
      contentType: 'audio/mpeg',
      counselorId: 1,
      startedAt: new Date(),
      duration: 300,
      fileSize: 1024 * 1024 * 5,
      platform: AudioChatPlatform.WEB,
    };

    const mockCounselor = {
      id: 1,
      name: 'Test Counselor',
      role: UserRole.ADMIN,
    };

    const mockChat = {
      id: 123,
      counselorId: 1,
      status: ChatStatus.STARTED,
      provider: AudioChatProvider.AUDIO_UPLOAD,
      createdBy: 1,
      tenantId: 1,
    };

    it('should create chat and return presigned URL successfully', async () => {
      const mockPresignedUrl = 'https://s3.amazonaws.com/presigned-url';

      userService.get.mockResolvedValue(mockCounselor as any);
      chatService.createChatForAnonymousClient.mockResolvedValue(
        mockChat as any,
      );
      s3Service.generatePresignedUrl.mockResolvedValue(mockPresignedUrl);

      const result = await service.createChatWithUploadUrl(validRequestDto);

      expect(userService.get).toHaveBeenCalledWith(validRequestDto.counselorId);
      expect(chatService.createChatForAnonymousClient).toHaveBeenCalledWith({
        counselorId: validRequestDto.counselorId,
        provider: AudioChatProvider.AUDIO_UPLOAD,
        status: ChatStatus.STARTED,
        startedAt: validRequestDto.startedAt,
        endedAt: expect.any(Date),
        platform: validRequestDto.platform,
      });
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: expect.stringContaining(
          `-${mockChat.id}-${validRequestDto.fileName}`,
        ),
        operation: 'put',
        expiresIn: 3600,
        contentType: validRequestDto.contentType,
        metadata: {
          chatid: mockChat.id.toString(),
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      });
      expect(result).toEqual({
        presignedUrl: mockPresignedUrl,
        chatId: mockChat.id,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Getting presigned URL for file: ${validRequestDto.fileName}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Presigned URL generated for chat ${mockChat.id}`,
      );
    });

    it('should throw BadRequestException for invalid file type', async () => {
      const invalidDto = {
        ...validRequestDto,
        contentType: 'application/pdf',
      };

      await expect(service.createChatWithUploadUrl(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createChatWithUploadUrl(invalidDto)).rejects.toThrow(
        'Invalid file type',
      );
      expect(userService.get).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when file size exceeds limit', async () => {
      const invalidDto = {
        ...validRequestDto,
        fileSize: UPLOADED_AUDIO_FILE_SIZE_LIMIT + 1,
      };

      await expect(service.createChatWithUploadUrl(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createChatWithUploadUrl(invalidDto)).rejects.toThrow(
        'File size exceeds the limit',
      );
      expect(userService.get).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when counselor not found', async () => {
      userService.get.mockResolvedValue(null as any);

      await expect(
        service.createChatWithUploadUrl(validRequestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createChatWithUploadUrl(validRequestDto),
      ).rejects.toThrow('Counselor not found');
      expect(userService.get).toHaveBeenCalledWith(validRequestDto.counselorId);
    });

    it('should throw InternalServerErrorException when chat creation fails', async () => {
      userService.get.mockResolvedValue(mockCounselor as any);
      chatService.createChatForAnonymousClient.mockResolvedValue(null as any);

      await expect(
        service.createChatWithUploadUrl(validRequestDto),
      ).rejects.toThrow(InternalServerErrorException);
      await expect(
        service.createChatWithUploadUrl(validRequestDto),
      ).rejects.toThrow('Failed to create chat');
    });
  });

  describe('processAudioUpload', () => {
    const s3Key = 'audio-upload/test-file.mp3';
    const mockMetadata = {
      chatid: '123',
      provider: AudioChatProvider.AUDIO_UPLOAD,
    };
    const mockChat = {
      id: 123,
      status: ChatStatus.STARTED,
      createdBy: 1,
      tenantId: 1,
    };

    it('should process audio upload successfully', async () => {
      const mockHeadObject = {
        Metadata: mockMetadata,
      };
      const mockAudioUrl = 'https://s3.amazonaws.com/audio-url';

      s3Service.getHeadObject.mockResolvedValue(mockHeadObject as any);
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      s3Service.generatePresignedUrl.mockResolvedValue(mockAudioUrl);
      chatService.updateChat.mockResolvedValue(undefined as any);
      chatAudioUploadsService.createAudioUpload.mockResolvedValue(
        undefined as any,
      );
      aiEventService.publishTranscribeAudioEvent.mockResolvedValue(
        undefined as any,
      );

      await service.processAudioUpload(s3Key);

      expect(s3Service.getHeadObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: s3Key,
      });
      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(123);
      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '1',
        1,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChat.id, {
        status: ChatStatus.ENDED,
      });
      expect(chatAudioUploadsService.createAudioUpload).toHaveBeenCalledWith({
        chatId: mockChat.id,
        storageKey: s3Key,
        status: ChatAudioUploadStatus.SUCCESS,
      });
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: s3Key,
        operation: 'get',
        expiresIn: 3600,
      });
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalledWith({
        message_type: 'transcribe_and_summarize_request',
        chat_id: mockChat.id,
        timestamp: expect.any(Number),
        audio_url: mockAudioUrl,
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Processing audio upload');
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Audio upload processed for chat ${mockChat.id}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Uploaded audio send to AI service for chat ${mockChat.id}`,
      );
    });

    it('should return early when getHeadObject fails', async () => {
      const error = new Error('S3 error');
      s3Service.getHeadObject.mockRejectedValue(error);

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to get head object: ${error.message}`,
      );
      expect(chatService.getChatByIdForServiceCall).not.toHaveBeenCalled();
    });

    it('should return early when metadata is invalid - missing chatId', async () => {
      const invalidMetadata = {
        Metadata: {
          provider: AudioChatProvider.AUDIO_UPLOAD,
        },
      };

      s3Service.getHeadObject.mockResolvedValue(invalidMetadata as any);

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid file metadata:'),
      );
      expect(chatService.getChatByIdForServiceCall).not.toHaveBeenCalled();
    });

    it('should return early when metadata is invalid - missing provider', async () => {
      const invalidMetadata = {
        Metadata: {
          chatid: '123',
        },
      };

      s3Service.getHeadObject.mockResolvedValue(invalidMetadata as any);

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid file metadata:'),
      );
      expect(chatService.getChatByIdForServiceCall).not.toHaveBeenCalled();
    });

    it('should return early when provider is incorrect', async () => {
      const invalidMetadata = {
        Metadata: {
          chatid: '123',
          provider: 'INVALID_PROVIDER',
        },
      };

      s3Service.getHeadObject.mockResolvedValue(invalidMetadata as any);

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid file metadata:'),
      );
      expect(chatService.getChatByIdForServiceCall).not.toHaveBeenCalled();
    });

    it('should return early when chat not found', async () => {
      const mockHeadObject = {
        Metadata: mockMetadata,
      };

      // Create a mock chat object with null createdBy to simulate the scenario
      // where chat exists but createdBy is null
      const mockChatWithNullCreatedBy = {
        id: 123,
        status: ChatStatus.ENDED, // Use ENDED status to trigger early return
        createdBy: null,
        tenantId: 1,
      };

      s3Service.getHeadObject.mockResolvedValue(mockHeadObject as any);
      chatService.getChatByIdForServiceCall.mockResolvedValue(
        mockChatWithNullCreatedBy as any,
      );

      await service.processAudioUpload(s3Key);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(123);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Chat not found or not in started status'),
      );
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should return early when chat status is not STARTED', async () => {
      const mockHeadObject = {
        Metadata: mockMetadata,
      };
      const chatWithWrongStatus = {
        ...mockChat,
        status: ChatStatus.ENDED,
      };

      s3Service.getHeadObject.mockResolvedValue(mockHeadObject as any);
      chatService.getChatByIdForServiceCall.mockResolvedValue(
        chatWithWrongStatus as any,
      );

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Chat not found or not in started status: 123 and status: ${ChatStatus.ENDED}`,
      );
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error during audio upload processing and update chat with failure', async () => {
      const mockHeadObject = {
        Metadata: mockMetadata,
      };
      const error = new Error('Processing error');

      s3Service.getHeadObject.mockResolvedValue(mockHeadObject as any);
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      chatService.updateChat.mockResolvedValueOnce(undefined as any);
      chatAudioUploadsService.createAudioUpload.mockRejectedValue(error);

      await service.processAudioUpload(s3Key);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process audio upload for chat ${mockChat.id} with error ${JSON.stringify(
          error,
        )}`,
      );
      expect(chatService.updateChat).toHaveBeenCalledTimes(2);
      expect(chatService.updateChat).toHaveBeenNthCalledWith(2, mockChat.id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          error: error.message,
        },
      });
    });

    it('should set auth context with empty string when createdBy is undefined', async () => {
      const mockHeadObject = {
        Metadata: mockMetadata,
      };
      const mockChatWithoutCreatedBy = {
        id: 123,
        status: ChatStatus.STARTED,
        tenantId: 1,
      };
      const mockAudioUrl = 'https://s3.amazonaws.com/audio-url';

      s3Service.getHeadObject.mockResolvedValue(mockHeadObject as any);
      chatService.getChatByIdForServiceCall.mockResolvedValue(
        mockChatWithoutCreatedBy as any,
      );
      s3Service.generatePresignedUrl.mockResolvedValue(mockAudioUrl);
      chatService.updateChat.mockResolvedValue(undefined as any);
      chatAudioUploadsService.createAudioUpload.mockResolvedValue(
        undefined as any,
      );
      aiEventService.publishTranscribeAudioEvent.mockResolvedValue(
        undefined as any,
      );

      await service.processAudioUpload(s3Key);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '',
        1,
      );
    });
  });

  describe('cancelUpload', () => {
    it('should update chat status to cancelled', async () => {
      const cancelDto: CancelUploadRequestDto = {
        chatId: 123,
      };

      chatService.updateChat.mockResolvedValue(undefined as any);

      await service.cancelUpload(cancelDto);

      expect(chatService.updateChat).toHaveBeenCalledWith(cancelDto.chatId, {
        status: ChatStatus.CANCELLED,
        summaryStatus: ChatSummaryStatus.NO_AUDIO,
      });
    });

    it('should handle multiple cancel requests', async () => {
      const cancelDto1: CancelUploadRequestDto = { chatId: 123 };
      const cancelDto2: CancelUploadRequestDto = { chatId: 456 };

      chatService.updateChat.mockResolvedValue(undefined as any);

      await service.cancelUpload(cancelDto1);
      await service.cancelUpload(cancelDto2);

      expect(chatService.updateChat).toHaveBeenCalledTimes(2);
      expect(chatService.updateChat).toHaveBeenNthCalledWith(1, 123, {
        status: ChatStatus.CANCELLED,
        summaryStatus: ChatSummaryStatus.NO_AUDIO,
      });
      expect(chatService.updateChat).toHaveBeenNthCalledWith(2, 456, {
        status: ChatStatus.CANCELLED,
        summaryStatus: ChatSummaryStatus.NO_AUDIO,
      });
    });
  });
});
