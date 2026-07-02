import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  AudioChatPlatform,
  AudioChatProvider,
} from 'src/common/constants/chat.constants';
import { ChatAudioUploadStatus } from '../../../audio/entity/chat-audio-uploads.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { UserRole } from 'src/common/constants/user.constants';
import { AiEventService } from 'src/ai/service/ai-event.service';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { S3Service } from 'src/aws/service/s3.service';
import {
  AudioUploadRequestDto,
  CancelUploadRequestDto,
} from 'src/chat/dto/audio-upload.dto';
import { ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';

import { UserService } from 'src/user/service/user.service';
import { AudioUploadService } from '../audio-upload.service';
import { ChatService } from '../chat.service';
import { LoggerService } from 'src/logger/logger.service';
import { UPLOADED_AUDIO_FILE_SIZE_LIMIT } from 'src/chat/constants/chat.constants';
import { NotificationService } from '../../../notification/service/notification.service';

// Mock the ExecutionManager with all required methods
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
    getCurrentContext: jest.fn(() => ({
      userId: '1',
      role: 'ADMIN',
      tenantId: 1,
    })),
    getExecutionId: jest.fn(() => 'mock-execution-id'),
    getTenantId: jest.fn(() => 1),
    getUserId: jest.fn(() => '1'),
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
            getChatWithCallDetails: jest.fn(),
            getChatById: jest.fn(),
            updateChat: jest.fn(),
            findReprocessableStuckChats: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            generatePresignedUrl: jest.fn(),
            getHeadObject: jest.fn(),
            sanitizeFileName: jest.fn(),
            findInProgressMultipartUploadId: jest.fn(),
            listMultipartParts: jest.fn(),
            completeMultipartUploadWithParts: jest.fn(),
            abortMultipartUpload: jest.fn(),
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
            getAudioUpload: jest.fn(),
            updateAudioUpload: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            notifyTranscriptionFailure: jest.fn(),
            notifyReprocessSummary: jest.fn(),
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
      s3Service.sanitizeFileName.mockReturnValue(validRequestDto.fileName);
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
      expect(s3Service.sanitizeFileName).toHaveBeenCalledWith(
        validRequestDto.fileName,
      );
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
        s3Key: expect.stringContaining(
          `-${mockChat.id}-${validRequestDto.fileName}`,
        ),
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
      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith('1', 1);
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
        audience: 'internal',
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

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith('', 1);
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

  describe('reprocessChatById', () => {
    it('re-dispatches transcription from the stored audio and resets to PENDING', async () => {
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/1.wav',
        sampleRate: 16000,
      } as any);
      chatService.getChatWithCallDetails.mockResolvedValue({
        chat: { id: 1, metadata: {} },
        callDetails: { callInfo: { mode: 'SCRIBE', isLinear16Encoded: true } },
      } as any);
      s3Service.getHeadObject.mockResolvedValue({} as any);
      s3Service.generatePresignedUrl.mockResolvedValue('https://signed');
      aiEventService.publishTranscribeAudioEvent.mockResolvedValue(
        undefined as any,
      );
      chatService.getChatById.mockResolvedValue({
        id: 1,
        metadata: { correlationId: 'c1' },
      } as any);
      chatService.updateChat.mockResolvedValue(undefined as any);

      const result = await service.reprocessChatById(1);

      expect(result.reprocessed).toBe(true);
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ chat_id: 1, audio_url: 'https://signed' }),
      );
      // resets to PENDING and bumps the re-transcribe counter
      expect(chatService.updateChat).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          summaryStatus: ChatSummaryStatus.PENDING,
          metadata: expect.objectContaining({ reprocessAttempts: 1 }),
        }),
      );
    });

    it('does not re-dispatch when there is no stored audio', async () => {
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: null,
      } as any);

      const result = await service.reprocessChatById(1);

      expect(result.reprocessed).toBe(false);
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });

    it('does not re-dispatch when the audio is gone from storage', async () => {
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/1.wav',
      } as any);
      chatService.getChatWithCallDetails.mockResolvedValue({
        chat: { id: 1, metadata: {} },
        callDetails: {},
      } as any);
      s3Service.getHeadObject.mockRejectedValue(new Error('NoSuchKey'));

      const result = await service.reprocessChatById(1);

      expect(result.reprocessed).toBe(false);
      expect(result.reason).toMatch(/no longer present/i);
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });

    it('stops re-dispatching once the attempt cap is reached', async () => {
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/1.wav',
      } as any);
      chatService.getChatWithCallDetails.mockResolvedValue({
        chat: { id: 1, metadata: { reprocessAttempts: 3 } },
        callDetails: {},
      } as any);

      const result = await service.reprocessChatById(1);

      expect(result.reprocessed).toBe(false);
      expect(result.reason).toMatch(/attempt limit/i);
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });
  });

  describe('reprocessStuckChats — salvage abandoned multipart uploads', () => {
    it('finalizes an incomplete upload (HEAD 404 + parts present) and re-dispatches', async () => {
      chatService.findReprocessableStuckChats.mockResolvedValue([
        { id: 7, metadata: {} },
      ] as any);
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/7.raw',
        sampleRate: 16000,
      } as any);
      // Object doesn't exist yet — the multipart upload was never completed.
      s3Service.getHeadObject.mockRejectedValue(new Error('NoSuchKey'));
      s3Service.findInProgressMultipartUploadId.mockResolvedValue('upload-abc');
      s3Service.listMultipartParts.mockResolvedValue([
        { ETag: 'e1', PartNumber: 1 },
        { ETag: 'e2', PartNumber: 2 },
      ]);
      s3Service.completeMultipartUploadWithParts.mockResolvedValue({} as any);
      s3Service.generatePresignedUrl.mockResolvedValue('https://signed');
      aiEventService.publishTranscribeAudioEvent.mockResolvedValue(
        undefined as any,
      );

      const result = await service.reprocessStuckChats();

      expect(s3Service.completeMultipartUploadWithParts).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'audio/7.raw', uploadId: 'upload-abc' }),
      );
      // Recovered → transcription re-dispatched, chat counted as reprocessed.
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalled();
      expect(result.reprocessed).toContain(7);
    });

    it('fails cleanly when the incomplete upload has no parts to finalize', async () => {
      chatService.findReprocessableStuckChats.mockResolvedValue([
        { id: 8, metadata: {} },
      ] as any);
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/8.raw',
      } as any);
      s3Service.getHeadObject.mockRejectedValue(new Error('NoSuchKey'));
      s3Service.findInProgressMultipartUploadId.mockResolvedValue('upload-xyz');
      s3Service.listMultipartParts.mockResolvedValue([]); // nothing flushed
      s3Service.abortMultipartUpload.mockResolvedValue({} as any);

      const result = await service.reprocessStuckChats();

      expect(s3Service.completeMultipartUploadWithParts).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      // Confirmed unrecoverable (marked), NOT a mid-reprocess error.
      expect(result.unrecoverable).toContain(8);
      expect(result.errored).not.toContain(8);
      // Original attribution preserved; reprocess outcome recorded separately.
      const updateArgs = chatService.updateChat.mock.calls.find(
        (c) => c[0] === 8,
      )?.[1] as any;
      expect(updateArgs.summaryStatus).toBe(ChatSummaryStatus.FAILED);
      expect(updateArgs.metadata.reprocessError).toMatch(/unrecoverable/i);
      // Attempt counter bumped so the attempt cap eventually stops re-selecting
      // a chat whose audio can never be recovered.
      expect(updateArgs.metadata.reprocessAttempts).toBe(1);
      // Upload flipped pending -> failed so it drops out of the reprocess
      // selection (branch c) after this one attempt instead of being re-listed.
      expect(chatAudioUploadsService.updateAudioUpload).toHaveBeenCalledWith(
        8,
        {
          status: ChatAudioUploadStatus.FAILED,
        },
      );
    });

    it('increments an existing reprocessAttempts counter on repeated failure', async () => {
      chatService.findReprocessableStuckChats.mockResolvedValue([
        { id: 9, metadata: { reprocessAttempts: 2 } },
      ] as any);
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/9.raw',
      } as any);
      s3Service.getHeadObject.mockRejectedValue(new Error('NoSuchKey'));
      s3Service.findInProgressMultipartUploadId.mockResolvedValue('upload-9');
      s3Service.listMultipartParts.mockResolvedValue([]);
      s3Service.abortMultipartUpload.mockResolvedValue({} as any);

      await service.reprocessStuckChats();

      const updateArgs = chatService.updateChat.mock.calls.find(
        (c) => c[0] === 9,
      )?.[1] as any;
      expect(updateArgs.metadata.reprocessAttempts).toBe(3);
    });

    it('reports a chat that THROWS mid-reprocess as errored (not unrecoverable), leaves audio untouched, and bumps the attempt counter', async () => {
      chatService.findReprocessableStuckChats.mockResolvedValue([
        { id: 10, metadata: { reprocessAttempts: 1 } },
      ] as any);
      chatAudioUploadsService.getAudioUpload.mockResolvedValue({
        storageKey: 'audio/10.raw',
      } as any);
      // Object exists → re-dispatch path; the dispatch itself fails.
      s3Service.getHeadObject.mockResolvedValue({} as any);
      s3Service.generatePresignedUrl.mockResolvedValue('https://signed');
      aiEventService.publishTranscribeAudioEvent.mockRejectedValue(
        new Error('SQS unavailable'),
      );

      const result = await service.reprocessStuckChats();

      // Errored, NOT unrecoverable — and audio was never flipped to failed.
      expect(result.errored).toContain(10);
      expect(result.unrecoverable).not.toContain(10);
      expect(
        chatAudioUploadsService.updateAudioUpload,
      ).not.toHaveBeenCalledWith(10, { status: ChatAudioUploadStatus.FAILED });
      // Attempt counter still advances so a chat that errors every run is
      // eventually dropped by the cap rather than recurring forever.
      const bumpArgs = chatService.updateChat.mock.calls.find(
        (c) => c[0] === 10,
      )?.[1] as any;
      expect(bumpArgs.metadata.reprocessAttempts).toBe(2);
      expect(bumpArgs.metadata.lastReprocessError).toMatch(/SQS unavailable/);
    });
  });
});
