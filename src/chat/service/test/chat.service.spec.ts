import { Test, TestingModule } from '@nestjs/testing';
import { Repository, DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

import { ChatService } from '../chat.service';
import { MessageService } from '../message.service';
import { CallDetailsService } from '../call-details.service';
import { CallLogService } from '../call-log.service';
import { AiChatIntegrationService } from '../ai-chat-integration.service';
import { ChatFeedbackService } from '../chat-feedback.service';
import { ChatRepository } from '../../repository/chat.repository';
import { MessageRepository } from '../../repository/message.repository';
import { CallDetailsRepository } from '../../repository/call-details.repository';
import { SummaryFeedbackRepository } from '../../repository/summary-feedback.repository';
import { QueueService } from '../../../queue/service/queue.service';
import { UserService } from '../../../user/service/user.service';
import { AiService } from '../../../ai/service/ai.service';
import { RedisService } from '../../../redis/service/redis.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { SettingsService } from '../../../settings/service/settings.service';
import { ChatSummaryAttemptService } from '../chat-summary-attempt.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../../audio/service/stream-file-processor.service';
import { CryptoService } from '../../../common/service/crypto.service';
import { AppConfigService } from '../../../config/config.service';
import { ChatAudioUploadsService } from '../../../audio/service/chat-audio-uploads.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { GroupService } from '../../../authorization/service/group.service';
import { ScribeSessionReviewSharedService } from '../../../scribe-session-review/service/review-shared.service';
import { NotificationService } from '../../../notification/service/notification.service';

import { Message } from '../../entity/message.entity';
import { CallDetails } from '../../entity/call.details.entity';
import { User } from '../../../user/entity/user.entity';
import { Chat, ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';
import { MessageType } from '../../entity/message.entity';
import { UserStatus } from '../../../user/constants/user-status.constants';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepository: ChatRepository;
  let callDetailsRepository: Repository<CallDetails>;
  let userService: UserService;
  let messageService: MessageService;
  let cache: RedisService;
  let permissionValidator: PermissionValidator;

  const mockChat: Chat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    status: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    startedAt: new Date(),
    endedAt: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
    archivedAt: undefined,
  };

  const mockUser: User = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    status: UserStatus.ACTIVE,
    profileCompleted: true,
    username: 'testuser',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
    externalId: undefined,
    termsAndAgreementApproved: false,
  };

  const mockMessage: Message = {
    id: 1,
    chatId: 1,
    senderId: 1,
    content: 'Test message',
    type: MessageType.TEXT,
    context: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    parentMessageId: undefined,
    startSeconds: undefined,
    endSeconds: undefined,
  };

  const mockCallDetails: CallDetails = {
    id: 1,
    chatId: 1,
    startTime: new Date(),
    endTime: undefined,
    callDuration: 0,
    callInfo: {
      provider: AudioChatProvider.WEBRTC,
    },
    summary: undefined,
    noOfNudges: 0,
    noOfStages: 0,
    transcript: '',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: MessageRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
            deleteMessageByChatId: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              leftJoinAndMapOne: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              offset: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
              getOne: jest.fn(),
              getMany: jest.fn(),
              getCount: jest.fn(),
            })),
          },
        },
        {
          provide: MessageService,
          useValue: {
            saveMessage: jest.fn(),
            save: jest.fn(),
            getMessageObject: jest.fn(),
            getMessageByChatId: jest.fn().mockResolvedValue({
              messages: [],
              count: 0,
            }),
            formatMessage: jest.fn((message) => ({
              messageId: message.id,
              chatId: message.chatId,
              senderId: message.senderId,
              messageType: message.type,
              content: message.content,
              context: message.context,
              createdAt: message.createdAt?.toISOString(),
              feedback: message.feedback,
              startSeconds: message.startSeconds,
              endSeconds: message.endSeconds,
            })),
            getMessages: jest.fn().mockResolvedValue({
              data: [],
              count: 0,
            }),
            persistAndBroadcastMessage: jest.fn(),
            getChatHistoryForAIService: jest.fn().mockResolvedValue([]),
            replaceDictationTranscript: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CallDetailsService,
          useValue: {
            handleChatEnded: jest.fn(),
            updateSummaryAndTags: jest.fn(),
            updateCallMetadata: jest.fn(),
            updateMessageStatistics: jest.fn(),
            generateSummary: jest.fn().mockResolvedValue({
              sessionSummary: 'Test summary',
              tags: ['tag1'],
            }),
            updateCallDetails: jest.fn(),
            updateCallInfo: jest.fn(),
            incrementWordCountByLanguage: jest.fn(),
            decryptCallDetails: jest.fn((callDetails) => callDetails),
            pauseOrResumeChat: jest.fn(),
            isChatPaused: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: CallLogService,
          useValue: {
            getCallLogs: jest.fn().mockResolvedValue({
              data: [],
              count: 0,
            }),
            getAdminCallLogs: jest.fn().mockResolvedValue({
              data: [],
              count: 0,
            }),
            getCounselorNames: jest.fn().mockResolvedValue({
              data: [],
              count: 0,
            }),
            getAllTags: jest.fn().mockResolvedValue({
              data: [],
              count: 0,
            }),
          },
        },
        {
          provide: AiChatIntegrationService,
          useValue: {
            enhance: jest.fn(),
            getNudge: jest.fn(),
            tagPositivityRatings: jest.fn().mockResolvedValue(['tag1']),
            generateSummaryForMessage: jest.fn(),
            triggerNudge: jest.fn(),
            handleNudge: jest.fn(),
          },
        },
        {
          provide: ChatFeedbackService,
          useValue: {
            addNoteToSession: jest
              .fn()
              .mockResolvedValue({ notes: 'Test note' }),
            addFeedbackToChat: jest.fn().mockResolvedValue({
              message: 'Feedback added successfully',
              feedback: { id: 1, rating: 5 },
            }),
          },
        },
        {
          provide: ChatRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            updateChat: jest.fn(),
            findChatWithDetails: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              leftJoinAndMapOne: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              offset: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
              getOne: jest.fn(),
              getMany: jest.fn(),
              getCount: jest.fn(),
            })),
          },
        },
        {
          provide: CallDetailsRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            deleteCallDetailsByChatId: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              offset: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
              getCount: jest.fn().mockResolvedValue(0),
            })),
          },
        },
        {
          provide: SummaryFeedbackRepository,
          useValue: {
            createSummaryFeedback: jest.fn(),
          },
        },
        {
          provide: QueueService,
          useValue: {
            enqueue: jest.fn(),
            getQueueByChatId: jest.fn(),
            updateQueueStatus: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
            getMinimalUserInfo: jest.fn(),
            getCounselorNames: jest.fn(),
          },
        },
        {
          provide: AiService,
          useValue: {
            generateSummaryAndTags: jest.fn(),
            enhance: jest.fn(),
            getNudge: jest.fn(),
            generateTagPositivityRatings: jest.fn(),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn((content) => Promise.resolve(content)), // Return original content for testing
            decrypt: jest.fn((content) => Promise.resolve(content)), // Return original content for testing
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            hincrBy: jest.fn(),
            hgetAll: jest.fn(),
          },
        },
        {
          provide: MessageBrokerService,
          useValue: {
            publish: jest.fn(),
            subscribe: jest.fn(),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getNudgeStatus: jest.fn(),
            getScribeNoteCreationEnabled: jest.fn(),
          },
        },
        {
          provide: BroadcastMessageService,
          useValue: {
            broadcastChatEndedEvent: jest.fn(),
          },
        },
        {
          provide: StreamFileProcessorService,
          useValue: {
            endCallStream: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            phiData: {
              phiDataEncryptionKey: 'test-encryption-key',
            },
          },
        },
        {
          provide: ChatAudioUploadsService,
          useValue: {
            deleteChatAudioUploadsByChatId: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
        {
          provide: GroupService,
          useValue: {
            getUserRolesByUserId: jest
              .fn()
              .mockResolvedValue([{ name: 'COUNSELOR' }, { name: 'CLIENT' }]),
          },
        },
        {
          provide: ScribeSessionReviewSharedService,
          useValue: {
            deleteReviewByScribeSessionId: jest.fn(),
            getReviewByScribeSessionId: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            notifyTranscriptionFailure: jest.fn(),
            notifyReprocessSummary: jest.fn(),
          },
        },
        {
          provide: ChatSummaryAttemptService,
          useValue: { recordAttempt: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatRepository = module.get<ChatRepository>(ChatRepository);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    userService = module.get<UserService>(UserService);
    messageService = module.get<MessageService>(MessageService);
    cache = module.get<RedisService>(RedisService);
    permissionValidator = module.get<PermissionValidator>(PermissionValidator);

    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createNote', () => {
    it('throws when scribe note creation is disabled for the tenant', async () => {
      (
        service as any
      ).settingsService.getScribeNoteCreationEnabled.mockResolvedValue(false);

      await expect(service.createNote(1)).rejects.toThrow(
        'Scribe note creation is not enabled for this organization',
      );
    });

    it('creates a dictation note when scribe note creation is enabled', async () => {
      (
        service as any
      ).settingsService.getScribeNoteCreationEnabled.mockResolvedValue(true);
      jest
        .spyOn(service, 'createChatForAnonymousClient')
        .mockResolvedValue({ id: 42, startedAt: new Date() } as any);
      jest.spyOn(service, 'updateChat').mockResolvedValue({} as any);

      const result = await service.createNote(1);

      expect(service.createChatForAnonymousClient).toHaveBeenCalled();
      expect(result.chatId).toBe(42);
    });
  });

  describe('setNoteTranscript', () => {
    it('stores the transcript and rebuilds call-details stats', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);

      const result = await service.setNoteTranscript(1, 2, '  hello there  ');

      // Trimmed transcript is handed to the message layer to store as a message.
      expect(messageService.replaceDictationTranscript).toHaveBeenCalledWith(
        mockChat,
        'hello there',
      );
      // The flat call_details.transcript is rebuilt from the messages.
      expect(
        (service as any).callDetailsService.updateMessageStatistics,
      ).toHaveBeenCalledWith(mockChat);
      expect(result).toEqual({ success: true });
    });

    it('throws 404 when the chat is not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.setNoteTranscript(999, 2, 'hi')).rejects.toThrow(
        'Chat not found',
      );
      expect(messageService.replaceDictationTranscript).not.toHaveBeenCalled();
    });

    it('throws 400 when the transcript is blank', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);

      await expect(service.setNoteTranscript(1, 2, '   ')).rejects.toThrow(
        'Transcript is empty',
      );
      expect(messageService.replaceDictationTranscript).not.toHaveBeenCalled();
    });
  });

  describe('getChat', () => {
    it('should return a chat when found', async () => {
      const mockChatWithMatchingCounselor = {
        ...mockChat,
        counselorId: 1,
        details: {},
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);
      jest
        .spyOn(chatRepository, 'findChatWithDetails')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const result = await service.getChat(1);

      expect(result).toEqual(mockChatWithMatchingCounselor);
      expect(chatRepository.findChatWithDetails).toHaveBeenCalledWith(
        1,
        'test-tenant',
      );
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getChat(1)).rejects.toThrow(
        'Chat not found for chatId: 1',
      );
    });

    it('should throw ForbiddenException when counselor tries to access chat not assigned to them', async () => {
      const mockChatWithDifferentCounselor = {
        ...mockChat,
        counselorId: 999,
      };

      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithDifferentCounselor as any);

      await expect(service.getChat(1)).rejects.toThrow(
        'You are not allowed to access this chat',
      );
    });

    it('should throw ForbiddenException when admin tries to access chat from different tenant', async () => {
      const mockChatWithDifferentTenant = {
        ...mockChat,
        tenantId: 'different-tenant',
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithDifferentTenant as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      await expect(service.getChat(1)).rejects.toThrow(
        'You are not allowed to access this chat',
      );
    });

    it('should allow counselor to access their own chat', async () => {
      const mockChatWithMatchingCounselor = {
        ...mockChat,
        counselorId: 1,
        details: {},
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);
      jest
        .spyOn(chatRepository, 'findChatWithDetails')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const result = await service.getChat(1);

      expect(result).toEqual(mockChatWithMatchingCounselor);
    });

    it('should allow admin to access chat from same tenant', async () => {
      const mockChatWithSameTenant = {
        ...mockChat,
        tenantId: 'test-tenant',
        details: {},
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithSameTenant as any);
      jest
        .spyOn(chatRepository, 'findChatWithDetails')
        .mockResolvedValue(mockChatWithSameTenant as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);

      const result = await service.getChat(1);

      expect(result).toEqual(mockChatWithSameTenant);
    });

    it('should throw ForbiddenException when userId is undefined', async () => {
      const mockChatWithCounselor = {
        ...mockChat,
        counselorId: 1,
      };

      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithCounselor as any);

      await expect(service.getChat(1)).rejects.toThrow(
        'You are not allowed to access this chat',
      );
    });
  });

  describe('getChatById', () => {
    it('should return cached chat when available', async () => {
      const serializedChat = JSON.parse(JSON.stringify(mockChat));
      jest
        .spyOn(cache, 'get')
        .mockResolvedValue(JSON.stringify(serializedChat));

      const result = await service.getChatById(1);

      expect(result).toEqual(serializedChat);
      expect(cache.get).toHaveBeenCalledWith('chat:1');
    });

    it('should fetch from database and cache when not cached', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      const result = await service.getChatById(1);

      expect(result).toEqual(mockChat);
      expect(chatRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, tenantId: 'test-tenant' },
      });
      expect(cache.set).toHaveBeenCalledWith(
        'chat:1',
        JSON.stringify(mockChat),
      );
    });

    it('should return null when chat not found', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      const result = await service.getChatById(1);

      expect(result).toBeNull();
    });
  });

  describe('endChat', () => {
    it('should end a chat successfully', async () => {
      const endedChat = {
        ...mockChat,
        status: ChatStatus.ENDED,
        endedAt: new Date(),
      };

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat);
      jest.spyOn(chatRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'del').mockResolvedValue(undefined);
      jest
        .spyOn(service, 'getChatById')
        .mockResolvedValueOnce(mockChat)
        .mockResolvedValueOnce(endedChat as any);

      const result = await service.endChat(1);

      expect(result).toEqual(endedChat);
      expect(chatRepository.update).toHaveBeenCalledWith(1, {
        status: ChatStatus.ENDED,
        endedAt: expect.any(Date),
        metadata: expect.objectContaining({ streamEndReason: 'completed' }),
      });
      expect(cache.del).toHaveBeenCalledWith('chat:1');
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(service, 'getChatById').mockResolvedValue(null);

      await expect(service.endChat(1)).rejects.toThrow(HttpException);
      await expect(service.endChat(1)).rejects.toThrow('Chat not found');
    });

    it('should throw HttpException when chat is not active', async () => {
      const inactiveChat = { ...mockChat, status: ChatStatus.ENDED };
      jest.spyOn(service, 'getChatById').mockResolvedValue(inactiveChat as any);

      await expect(service.endChat(1)).rejects.toThrow(HttpException);
      await expect(service.endChat(1)).rejects.toThrow('Chat is not active');
    });
  });

  describe('isChatEnded', () => {
    it('should return true when chat is ended', async () => {
      const endedChat = { ...mockChat, status: ChatStatus.ENDED };
      jest.spyOn(service, 'getChatById').mockResolvedValue(endedChat as any);

      const result = await service.isChatEnded(1);

      expect(result).toBe(true);
    });

    it('should return false when chat is not ended', async () => {
      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat as any);

      const result = await service.isChatEnded(1);

      expect(result).toBe(false);
    });
  });

  describe('createChatWithClientAndCounselor', () => {
    it('should create chat with client and counselor', async () => {
      const mockNewChat = { ...mockChat, id: 2, counselorId: 2 };

      jest.spyOn(chatRepository, 'create').mockReturnValue(mockNewChat as any);
      jest.spyOn(chatRepository, 'save').mockResolvedValue(mockNewChat as any);
      jest
        .spyOn(callDetailsRepository, 'save')
        .mockResolvedValue(mockCallDetails as any);

      const result = await service.createChatWithClientAndCounselor({
        clientId: 1,
        counselorId: 2,
        provider: AudioChatProvider.WEBRTC,
        platform: AudioChatPlatform.WEB,
        externalId: 'ext-123',
        status: ChatStatus.ACTIVE,
        startedAt: new Date(),
      });

      expect(result).toEqual(mockNewChat);
    });
  });

  describe('createChatForAnonymousClient', () => {
    it('should create chat for anonymous client', async () => {
      const mockNewChat = { ...mockChat, id: 2, clientId: -1 };
      jest
        .spyOn(service, 'createChatWithClientAndCounselor')
        .mockResolvedValue(mockNewChat as any);

      const result = await service.createChatForAnonymousClient({
        counselorId: 2,
        provider: AudioChatProvider.WEBRTC,
        platform: AudioChatPlatform.WEB,
        externalId: 'ext-123',
        status: ChatStatus.ACTIVE,
        startedAt: new Date(),
      });

      expect(result).toEqual(mockNewChat);
      expect(service.createChatWithClientAndCounselor).toHaveBeenCalledWith(
        {
          clientId: -1,
          counselorId: 2,
          provider: AudioChatProvider.WEBRTC,
          platform: AudioChatPlatform.WEB,
          externalId: 'ext-123',
          status: ChatStatus.ACTIVE,
          startedAt: expect.any(Date),
        },
        undefined,
      );
    });
  });

  describe('getChatsByUserIds', () => {
    it('should return chats for user IDs', async () => {
      const mockChats = [mockChat];
      jest.spyOn(chatRepository, 'find').mockResolvedValue(mockChats as any);

      const result = await service.getChatsByUserIds([1, 2], {
        status: [ChatStatus.ACTIVE],
        sort: 'desc',
        orderBy: 'createdAt',
      });

      expect(result).toEqual(mockChats);
      expect(chatRepository.find).toHaveBeenCalledWith({
        where: {
          clientId: expect.any(Object), // TypeORM In() operator
          status: expect.any(Object), // TypeORM In() operator
          tenantId: 'test-tenant',
        },
        order: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('getChatByIdForServiceCall', () => {
    it('should return chat by ID for service call', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);

      const result = await service.getChatByIdForServiceCall(1);

      expect(result).toEqual(mockChat);
      expect(chatRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getChatByIdForServiceCall(1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.getChatByIdForServiceCall(1)).rejects.toThrow(
        'Chat not found',
      );
    });
  });

  describe('getChatsByCouncilorId', () => {
    it('should return chat by counselor ID', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);

      const result = await service.getChatsByCouncilorId(2, {
        status: ChatStatus.ACTIVE,
      });

      expect(result).toEqual(mockChat);
      expect(chatRepository.findOne).toHaveBeenCalledWith({
        where: {
          counselorId: 2,
          status: ChatStatus.ACTIVE,
          tenantId: 'test-tenant',
        },
        order: {
          createdAt: 'DESC',
        },
      });
    });
  });

  describe('getCounselorChat', () => {
    it('should return counselor chat', async () => {
      const mockCounselorChat = { ...mockChat, counselorId: 2 };
      const mockNewCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest
        .spyOn(service, 'getChatsByCouncilorId')
        .mockResolvedValue(mockCounselorChat as any);
      jest.spyOn(service, 'getChatResponse').mockResolvedValue({} as any);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockNewCallDetails as any);

      const result = await service.getCounselorChat(2);

      expect(result).toEqual({
        ...{},
        provider: AudioChatProvider.WEBRTC,
        platform: undefined,
      });
    });

    it('should return empty array when no active chat', async () => {
      jest.spyOn(service, 'getChatsByCouncilorId').mockResolvedValue(null);

      const result = await service.getCounselorChat(2);

      expect(result).toEqual([]);
    });
  });

  describe('getChatResponse', () => {
    it('should return chat response', async () => {
      const mockClient = { ...mockUser, id: 1 };
      const mockCounselor = { ...mockUser, id: 2 };
      const mockMessages = [mockMessage];

      jest
        .spyOn(userService, 'get')
        .mockResolvedValueOnce(mockClient as any)
        .mockResolvedValueOnce(mockCounselor as any);
      jest
        .spyOn(messageService, 'getMessageByChatId')
        .mockResolvedValue({ messages: mockMessages, count: 1 });
      jest
        .spyOn(userService, 'getMinimalUserInfo')
        .mockResolvedValue({} as any);

      const result = await service.getChatResponse(mockChat);

      expect(result).toEqual({
        counselor: {},
        client: {},
        messages: mockMessages,
        chatId: 1,
        clientId: 1,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
        startedAt: expect.any(Date),
        endedAt: undefined,
      });
    });
  });

  describe('getMyChats', () => {
    it('should return user chats', async () => {
      const mockChats = [mockChat];
      const mockNewCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest
        .spyOn(service, 'getChatsByUserIds')
        .mockResolvedValue(mockChats as any);
      jest.spyOn(service, 'getChatResponse').mockResolvedValue({} as any);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockNewCallDetails as any);

      const result = await service.getMyChats(1);

      expect(result).toEqual({
        ...{},
        provider: AudioChatProvider.WEBRTC,
        platform: undefined,
      });
    });

    it('should return empty array when no chats', async () => {
      jest.spyOn(service, 'getChatsByUserIds').mockResolvedValue([]);

      const result = await service.getMyChats(1);

      expect(result).toEqual([]);
    });
  });

  describe('getChatWithCallDetails', () => {
    it('should return chat with call details', async () => {
      const mockNewCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat as any);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockNewCallDetails as any);

      const result = await service.getChatWithCallDetails(1);

      expect(result).toEqual({
        chat: mockChat,
        callDetails: mockCallDetails,
      });
    });
  });

  describe('getChatByExternalId', () => {
    it('should return chat by external ID', async () => {
      const mockChatWithExternalId = { ...mockChat, externalId: 'ext-123' };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithExternalId as any);

      const result = await service.getChatByExternalId('ext-123');

      expect(result).toEqual(mockChatWithExternalId);
      expect(chatRepository.findOne).toHaveBeenCalledWith({
        where: { externalId: 'ext-123', tenantId: 'test-tenant' },
      });
    });

    it('should return null when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      const result = await service.getChatByExternalId('ext-123');

      expect(result).toBeNull();
    });
  });

  describe('updateChat', () => {
    it('should update chat', async () => {
      const updateInput = { summaryStatus: ChatSummaryStatus.SUCCESS };

      jest.spyOn(chatRepository, 'updateChat').mockResolvedValue({} as any);

      await service.updateChat(1, updateInput);

      expect(chatRepository.updateChat).toHaveBeenCalledWith(1, updateInput);
    });
  });

  describe('markStalePendingChatsAsFailed', () => {
    it('marks a timed-out chat WITH a transcript as FAILED + retryable', async () => {
      jest
        .spyOn(chatRepository, 'find')
        .mockResolvedValue([{ id: 7, metadata: {} } as any]);
      const messageRepo = (service as any)
        .messageRepository as jest.Mocked<MessageRepository>;
      messageRepo.count.mockResolvedValue(3); // transcript present
      const update = jest
        .spyOn(chatRepository, 'update')
        .mockResolvedValue({ affected: 1 } as any);

      await service.markStalePendingChatsAsFailed();

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7 }),
        expect.objectContaining({
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: expect.objectContaining({
            summaryRetryable: true,
            stage: 'summary-timeout',
          }),
        }),
      );
    });

    it('marks a timed-out chat WITHOUT a transcript as plain FAILED (not retryable)', async () => {
      jest
        .spyOn(chatRepository, 'find')
        .mockResolvedValue([{ id: 8, metadata: {} } as any]);
      const messageRepo = (service as any)
        .messageRepository as jest.Mocked<MessageRepository>;
      messageRepo.count.mockResolvedValue(0); // no transcript
      const update = jest
        .spyOn(chatRepository, 'update')
        .mockResolvedValue({ affected: 1 } as any);

      await service.markStalePendingChatsAsFailed();

      const meta = (update.mock.calls[0][1] as any).metadata;
      expect(meta.summaryRetryable).toBeUndefined();
      expect(meta.stage).toBe('summary-timeout');
      expect((update.mock.calls[0][1] as any).summaryStatus).toBe(
        ChatSummaryStatus.FAILED,
      );
    });
  });
});
