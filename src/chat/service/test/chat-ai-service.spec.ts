import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ValidationException } from 'src/exception/custom.exception';
import { ChatAiService } from '../chat-ai-service';
import { ChatService } from '../chat.service';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { CallDetails } from 'src/common/entities/call.details.entity';
import { Message } from 'src/common/entities/message.entity';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from 'src/common/entities/chat.entity';
import { MessageType } from 'src/common/entities/message.entity';
import { UserRole } from 'src/common/constants/user.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { FlattenedSummaryNotePayload } from 'src/common/entities/type/call.details.type';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
    getTenantId: jest.fn(),
    getRole: jest.fn(),
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
    getCurrentContext: jest.fn(),
    runWithContext: jest.fn((fn) => fn()),
  },
}));

describe('ChatAiService', () => {
  let service: ChatAiService;
  let mockCallDetailsRepository: {
    update: jest.Mock;
  };
  let mockMessageRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let mockChatService: {
    updateMessageStatistics: jest.Mock;
  };
  let mockS3Service: {
    deleteObject: jest.Mock;
  };
  let mockConfig: {
    isDevelopment: boolean;
    s3: { audioBucket: string };
  };
  let mockChatAudioUploadsService: {
    getAudioUpload: jest.Mock;
    updateAudioUpload: jest.Mock;
  };

  const mockChat: Chat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    roomId: 1,
    status: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    startedAt: new Date(),
    endedAt: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
  };

  const mockSummary: FlattenedSummaryNotePayload = {
    call_id: 'test-call-1',
    call_duration: 3600,
    call_date: '2023-01-01',
    call_time: '10:00:00',
    client_id: '1',
    counsellor: 'Jane Smith',
    call_type: 'audio',
    age: 25,
    gender: 'female',
    profession: 'student',
    relationship_status: 'single',
    languages: [{ language: 'en', percentage: 100 }],
    location: 'New York',
    code_of_concern: 'anxiety',
    session_summary: 'Test summary',
    counseling_process_flow: 'intake',
    key_concerns: 'anxiety and stress',
    subjective_observations: 'Client appeared anxious',
    objective_observations: 'Client was fidgeting',
    assessment: 'Mild anxiety',
    dominant_feelings: 'anxiety, worry',
    issues_worked_on: 'stress management',
    key_therapeutic_techniques: 'CBT, mindfulness',
    referrals_provided: null,
    homework: 'Practice breathing exercises',
    plan_for_next_call: 'Continue CBT techniques',
    listening_share: 0.7,
    reflective_questions_asked: 5,
    open_ended_questions_asked: 3,
    emotional_lift: 'positive',
    call_quality: 5,
    tags: [{ tag: 'urgent', positivity_rating: 0.2 }],
  };

  const mockMessageRequests: MessageRequest[] = [
    {
      role: UserRole.CLIENT,
      content: 'Hello, I need help',
      start_time: 0,
      end_time: 5,
    },
    {
      role: UserRole.COUNSELOR,
      content: 'How can I help you today?',
      start_time: 5,
      end_time: 10,
    },
  ];

  const mockAudioUpload = {
    id: 1,
    chatId: 1,
    storageKey: 'audio/test-chat-1.wav',
    sampleRate: 44100,
    format: 'wav',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Create mock functions
    mockCallDetailsRepository = {
      update: jest.fn(),
    };

    mockMessageRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    mockChatService = {
      updateMessageStatistics: jest.fn(),
    };

    mockS3Service = {
      deleteObject: jest.fn(),
    };

    mockConfig = {
      isDevelopment: false,
      s3: {
        audioBucket: 'test-audio-bucket',
      },
    };

    mockChatAudioUploadsService = {
      getAudioUpload: jest.fn(),
      updateAudioUpload: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ChatAiService,
        {
          provide: getRepositoryToken(CallDetails),
          useValue: mockCallDetailsRepository,
        },
        {
          provide: getRepositoryToken(Message),
          useValue: mockMessageRepository,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
        {
          provide: ChatAudioUploadsService,
          useValue: mockChatAudioUploadsService,
        },
      ],
    }).compile();

    service = module.get<ChatAiService>(ChatAiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addSummary', () => {
    it('should add summary successfully', async () => {
      mockCallDetailsRepository.update.mockResolvedValue({});

      const result = await service.addSummary(1, mockSummary);

      expect(result).toBe(true);
      expect(mockCallDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        {
          summary: expect.objectContaining({
            callId: 'test-call-1',
            callDuration: 3600,
            callDate: '2023-01-01',
            callTime: '10:00:00',
            callType: 'audio',
            clientId: '1',
            counsellor: 'Jane Smith',
            sessionSummary: 'Test summary',
            callQuality: 5,
            tags: [{ tag: 'urgent', positivity_rating: 0.2 }],
          }),
        },
      );
    });

    it('should throw ValidationException on database error', async () => {
      const dbError = new Error('Database connection failed');
      mockCallDetailsRepository.update.mockRejectedValue(dbError);

      await expect(service.addSummary(1, mockSummary)).rejects.toThrow(
        ValidationException,
      );
      await expect(service.addSummary(1, mockSummary)).rejects.toThrow(
        'Error adding summary',
      );
    });

    it('should handle empty summary data', async () => {
      const emptySummary = {} as FlattenedSummaryNotePayload;
      mockCallDetailsRepository.update.mockResolvedValue({});

      const result = await service.addSummary(1, emptySummary);

      expect(result).toBe(true);
      expect(mockCallDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        { summary: {} },
      );
    });
  });

  describe('addTranscript', () => {
    it('should add transcript successfully in production', async () => {
      const mockMessages = [
        {
          id: 1,
          chatId: 1,
          senderId: 1,
          content: 'Hello, I need help',
          type: MessageType.TEXT,
          startSeconds: 0,
          endSeconds: 5,
          tenantId: 'test-tenant',
        },
        {
          id: 2,
          chatId: 1,
          senderId: 2,
          content: 'How can I help you today?',
          type: MessageType.TEXT,
          startSeconds: 5,
          endSeconds: 10,
          tenantId: 'test-tenant',
        },
      ];

      mockMessageRepository.create.mockReturnValue(mockMessages[0]);
      mockMessageRepository.create
        .mockReturnValueOnce(mockMessages[0])
        .mockReturnValueOnce(mockMessages[1]);
      mockMessageRepository.save.mockResolvedValue(mockMessages);
      mockChatService.updateMessageStatistics.mockResolvedValue(undefined);
      mockChatAudioUploadsService.getAudioUpload.mockResolvedValue(
        mockAudioUpload,
      );
      mockS3Service.deleteObject.mockResolvedValue({});
      mockChatAudioUploadsService.updateAudioUpload.mockResolvedValue({});

      const result = await service.addTranscript(mockChat, mockMessageRequests);

      expect(result).toBe(true);
      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '2',
        UserRole.COUNSELOR,
        'test-tenant',
      );
      expect(mockMessageRepository.create).toHaveBeenCalledTimes(2);
      expect(mockMessageRepository.save).toHaveBeenCalledWith(mockMessages);
      expect(mockChatService.updateMessageStatistics).toHaveBeenCalledWith(
        mockChat,
      );
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-audio-bucket',
        key: 'audio/test-chat-1.wav',
      });
      expect(
        mockChatAudioUploadsService.updateAudioUpload,
      ).toHaveBeenCalledWith(1, {
        storageKey: null,
        sampleRate: null,
        format: null,
      });
    });

    it('should add transcript successfully in development without S3 cleanup', async () => {
      mockConfig.isDevelopment = true;
      mockMessageRepository.create.mockReturnValue({});
      mockMessageRepository.save.mockResolvedValue([]);
      mockChatService.updateMessageStatistics.mockResolvedValue(undefined);
      mockChatAudioUploadsService.getAudioUpload.mockResolvedValue(
        mockAudioUpload,
      );

      const result = await service.addTranscript(mockChat, mockMessageRequests);

      expect(result).toBe(true);
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
      expect(
        mockChatAudioUploadsService.updateAudioUpload,
      ).not.toHaveBeenCalled();
    });

    it('should add transcript when no audio upload exists', async () => {
      mockMessageRepository.create.mockReturnValue({});
      mockMessageRepository.save.mockResolvedValue([]);
      mockChatService.updateMessageStatistics.mockResolvedValue(undefined);
      mockChatAudioUploadsService.getAudioUpload.mockResolvedValue(null);

      const result = await service.addTranscript(mockChat, mockMessageRequests);

      expect(result).toBe(true);
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should add transcript when audio upload has no storage key', async () => {
      const audioUploadWithoutKey = { ...mockAudioUpload, storageKey: null };
      mockMessageRepository.create.mockReturnValue({});
      mockMessageRepository.save.mockResolvedValue([]);
      mockChatService.updateMessageStatistics.mockResolvedValue(undefined);
      mockChatAudioUploadsService.getAudioUpload.mockResolvedValue(
        audioUploadWithoutKey,
      );

      const result = await service.addTranscript(mockChat, mockMessageRequests);

      expect(result).toBe(true);
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should throw ValidationException ', async () => {
      const dbError = new Error('Database connection failed');
      mockMessageRepository.create.mockReturnValue({});
      mockMessageRepository.save.mockRejectedValue(dbError);

      await expect(
        service.addTranscript(mockChat, mockMessageRequests),
      ).rejects.toThrow(ValidationException);
      await expect(
        service.addTranscript(mockChat, mockMessageRequests),
      ).rejects.toThrow('Error adding transcript');
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context correctly', () => {
      const context = {
        userId: 1,
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      };

      service.setAuthContext(context);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '1',
        UserRole.CLIENT,
        'test-tenant',
      );
    });

    it('should set auth context for counselor', () => {
      const context = {
        userId: 2,
        role: UserRole.COUNSELOR,
        tenantId: 'test-tenant',
      };

      service.setAuthContext(context);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '2',
        UserRole.COUNSELOR,
        'test-tenant',
      );
    });
  });
});
