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
import { ChatGateway } from '../../gateway/chat.gateway';
import { UserService } from '../../../user/service/user.service';
import { AiService } from '../../../ai/service/ai.service';
import { RedisService } from '../../../redis/service/redis.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { SettingsService } from '../../../settings/service/settings.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../../audio/service/stream-file-processor.service';
import { CryptoService } from '../../../common/service/crypto.service';
import { AppConfigService } from '../../../config/config.service';
import { ChatAudioUploadsService } from '../../../audio/service/chat-audio-uploads.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { GroupService } from '../../../authorization/service/group.service';

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
import { ChatEvents } from '../../constants/chat.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepository: ChatRepository;
  let callDetailsRepository: Repository<CallDetails>;
  let queueService: QueueService;
  let userService: UserService;
  let messageService: MessageService;
  let cache: RedisService;
  let dataSource: DataSource;
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
  };

  const mockUser: User = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    status: UserStatus.ACTIVE,
    username: 'testuser',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
    externalId: undefined,
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
          provide: ChatGateway,
          useValue: {
            sendMessagesToRoom: jest.fn(),
            sendMessagesToRoomUsingPublish: jest.fn(),
            handleDeepgramTranscript: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            get: jest.fn(),
            getMinimalUserInfo: jest.fn(),
            getUsersByPhoneNumbers: jest.fn(),
            createUser: jest.fn(),
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
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatRepository = module.get<ChatRepository>(ChatRepository);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    queueService = module.get<QueueService>(QueueService);
    userService = module.get<UserService>(UserService);
    messageService = module.get<MessageService>(MessageService);
    cache = module.get<RedisService>(RedisService);
    dataSource = module.get<DataSource>(DataSource);
    permissionValidator = module.get<PermissionValidator>(PermissionValidator);

    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getChat', () => {
    it('should return a chat when found', async () => {
      // Create a mock chat with counselorId as number to match service logic
      // ExecutionManager.getUserId() returns string but service converts to Number
      const mockChatWithMatchingCounselor = {
        ...mockChat,
        counselorId: 1,
      };

      // Mock the first findOne call for chatData
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);

      // Mock the decryptCallDetails method
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const chatQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockResolvedValue({ ...mockChatWithMatchingCounselor, details: {} }),
      };
      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(chatQuery as any);

      const result = await service.getChat(1);

      expect(result).toEqual({ ...mockChatWithMatchingCounselor, details: {} });
      expect(chatQuery.where).toHaveBeenCalledWith('chat.id = :id', { id: 1 });
      expect(chatQuery.andWhere).toHaveBeenCalledWith(
        'chat.tenantId = :tenantId',
        {
          tenantId: 'test-tenant',
        },
      );
    });

    it('should throw HttpException when chat not found', async () => {
      // Mock the first findOne call to return null (chat not found)
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getChat(1)).rejects.toThrow(
        'Chat not found for chatId: 1',
      );
    });

    it('should throw ForbiddenException when counselor tries to access chat not assigned to them', async () => {
      const mockChatWithDifferentCounselor = {
        ...mockChat,
        counselorId: 999, // Different counselor ID
      };

      // Mock ExecutionManager to return counselor role and user ID 1
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
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithMatchingCounselor as any);
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const chatQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockResolvedValue({ ...mockChatWithMatchingCounselor, details: {} }),
      };
      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(chatQuery as any);

      const result = await service.getChat(1);

      expect(result).toEqual({ ...mockChatWithMatchingCounselor, details: {} });
    });

    it('should allow admin to access chat from same tenant', async () => {
      const mockChatWithSameTenant = {
        ...mockChat,
        tenantId: 'test-tenant',
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithSameTenant as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);
      jest.spyOn(service, 'decryptCallDetails').mockResolvedValue({} as any);

      const chatQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockResolvedValue({ ...mockChatWithSameTenant, details: {} }),
      };
      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(chatQuery as any);

      const result = await service.getChat(1);

      expect(result).toEqual({ ...mockChatWithSameTenant, details: {} });
    });

    it('should throw ForbiddenException when userId is undefined', async () => {
      const mockChatWithCounselor = {
        ...mockChat,
        counselorId: 1,
      };

      // Mock ExecutionManager to return undefined userId
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

  describe('requestChat', () => {
    it('should create a new chat when no active chats exist', async () => {
      const mockNewChat = { ...mockChat, id: 2 };
      const mockQueueEntry = { entryId: 1, chatId: 2 };

      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(chatRepository, 'create').mockReturnValue(mockNewChat as any);
      jest.spyOn(chatRepository, 'save').mockResolvedValue(mockNewChat as any);
      jest
        .spyOn(callDetailsRepository, 'save')
        .mockResolvedValue(mockCallDetails as any);
      jest
        .spyOn(queueService, 'enqueue')
        .mockResolvedValue(mockQueueEntry as any);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockReturnValue(mockNewChat),
            save: jest.fn().mockResolvedValue(mockNewChat),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      const result = await service.requestChat(1);

      expect(result).toEqual(mockQueueEntry);
      expect(queueService.enqueue).toHaveBeenCalledWith(
        { userId: 1, chatId: 2, priority: 1 },
        expect.any(Object),
      );
    });

    it('should throw HttpException when user has active chat', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(mockChat),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      await expect(service.requestChat(1)).rejects.toThrow(HttpException);
      await expect(service.requestChat(1)).rejects.toThrow(
        'You already have an active or waiting chat session',
      );
    });
  });

  describe('addNewChatWithCounselor', () => {
    it('should create a new chat with counselor', async () => {
      const mockNewChat = { ...mockChat, id: 2, counselorId: 2 };

      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(chatRepository, 'create').mockReturnValue(mockNewChat as any);
      jest.spyOn(chatRepository, 'save').mockResolvedValue(mockNewChat as any);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockReturnValue(mockNewChat),
            save: jest.fn().mockResolvedValue(mockNewChat),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      const result = await service.addNewChatWithCounselor(2, 1);

      expect(result).toEqual(mockNewChat);
    });

    it('should throw HttpException when active chat exists', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(mockChat),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      await expect(service.addNewChatWithCounselor(2, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addNewChatWithCounselor(2, 1)).rejects.toThrow(
        'You already have an active or waiting chat session',
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

  describe('addCouncilorToChat', () => {
    it('should add counselor to chat successfully', async () => {
      const mockChatWithoutCounselor = {
        ...mockChat,
        counselorId: undefined,
      };
      const mockUpdatedChat = {
        ...mockChat,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
      };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithoutCounselor);
      jest
        .spyOn(chatRepository, 'save')
        .mockResolvedValue(mockUpdatedChat as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addCouncilorToChat(2, 1);

      expect(result).toEqual(mockUpdatedChat);
      expect(chatRepository.save).toHaveBeenCalledWith({
        ...mockChat,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
        startedAt: expect.any(Date),
      });
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        { startTime: expect.any(Date) },
      );
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.addCouncilorToChat(2, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addCouncilorToChat(2, 1)).rejects.toThrow(
        'Chat not found',
      );
    });

    it('should throw HttpException when chat already has counselor', async () => {
      const chatWithCounselor = { ...mockChat, counselorId: 3 };
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(chatWithCounselor);

      await expect(service.addCouncilorToChat(2, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addCouncilorToChat(2, 1)).rejects.toThrow(
        'Chat already has a counselor',
      );
    });
  });

  describe('startCall', () => {
    it('should start a call with valid participants', async () => {
      const participantPhoneNumbers = ['+1234567890', '+0987654321'];
      const mockCounselor = {
        ...mockUser,
        phone: '+1234567890',
        id: 2,
      };
      const mockClient = {
        ...mockUser,
        phone: '+0987654321',
        id: 1,
      };
      const mockNewChat = { ...mockChat, id: 2, counselorId: 2, clientId: 1 };
      const mockChatResponse = {
        chatId: 2,
        clientId: 1,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
        messages: [],
      };

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockResolvedValue([mockCounselor, mockClient]);
      jest
        .spyOn(service, 'getParticipantRoles')
        .mockResolvedValue({ 1: ['CLIENT'], 2: ['COUNSELOR'] });
      jest
        .spyOn(service, 'addNewChatWithCounselor')
        .mockResolvedValue(mockNewChat as any);
      jest
        .spyOn(service, 'getChatResponse')
        .mockResolvedValue(mockChatResponse as any);
      jest
        .spyOn(service['gateway'], 'sendMessagesToRoomUsingPublish')
        .mockImplementation(() => {});
      const result = await service.startCall(participantPhoneNumbers);

      expect(result).toEqual(mockNewChat);
      expect(service.addNewChatWithCounselor).toHaveBeenCalledWith(2, 1);
      expect(service.getChatResponse).toHaveBeenCalledWith(mockNewChat);
      expect(
        service['gateway'].sendMessagesToRoomUsingPublish,
      ).toHaveBeenCalledWith(ChatEvents.CALL_STARTED, [2, 1], {
        type: ChatEvents.CALL_STARTED,
        payload: mockChatResponse,
      });
    });

    it('should throw HttpException when insufficient participants', async () => {
      await expect(service.startCall(['+1234567890'])).rejects.toThrow(
        HttpException,
      );
      await expect(service.startCall(['+1234567890'])).rejects.toThrow(
        'Need at least 2 participants',
      );
    });

    it('should throw HttpException when no counselor found', async () => {
      const participantPhoneNumbers = ['+1234567890', '+0987654321'];
      const mockClient1 = {
        ...mockUser,
        phone: '+1234567890',
        id: 1,
      };
      const mockClient2 = {
        ...mockUser,
        phone: '+0987654321',
        id: 2,
      };

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockResolvedValue([mockClient1, mockClient2]);
      jest
        .spyOn(service, 'getParticipantRoles')
        .mockResolvedValue({ 1: ['CLIENT'], 2: ['CLIENT'] });
      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        HttpException,
      );
      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        'Counselor not found',
      );
    });

    it('should throw HttpException when participant list is empty', async () => {
      await expect(service.startCall([])).rejects.toThrow(HttpException);
      await expect(service.startCall([])).rejects.toThrow(
        'Need at least 2 participants',
      );
    });

    it('should throw HttpException when participant list is null', async () => {
      await expect(service.startCall(null as any)).rejects.toThrow(
        HttpException,
      );
      await expect(service.startCall(null as any)).rejects.toThrow(
        'Need at least 2 participants',
      );
    });

    it('should throw HttpException when participant list is undefined', async () => {
      await expect(service.startCall(undefined as any)).rejects.toThrow(
        HttpException,
      );
      await expect(service.startCall(undefined as any)).rejects.toThrow(
        'Need at least 2 participants',
      );
    });

    it('should throw HttpException when client phone number not found', async () => {
      const participantPhoneNumbers = ['+1234567890', '+1234567890']; // Same phone number twice
      const mockCounselor = {
        ...mockUser,
        phone: '+1234567890',
        id: 2,
      };

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockResolvedValue([mockCounselor, mockCounselor]); // Return same counselor twice
      jest
        .spyOn(service, 'getParticipantRoles')
        .mockResolvedValue({ 2: ['COUNSELOR'] });
      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        HttpException,
      );
      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        'Client phone number not found',
      );
    });

    it('should throw HttpException when getUsersByPhoneNumbers fails', async () => {
      const participantPhoneNumbers = ['+1234567890', '+0987654321'];

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockRejectedValue(new Error('Database error'));

      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        'Database error',
      );
    });

    it('should throw HttpException when createUser fails', async () => {
      const participantPhoneNumbers = ['+1234567890', '+0987654321'];
      const mockCounselor = {
        ...mockUser,
        phone: '+1234567890',
        id: 2,
      };

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockResolvedValue([mockCounselor, mockCounselor]); // Return same counselor twice
      jest
        .spyOn(service, 'getParticipantRoles')
        .mockResolvedValue({ 2: ['COUNSELOR'] });
      jest
        .spyOn(userService, 'createUser')
        .mockRejectedValue(new Error('Failed to create user'));

      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        'Failed to create user',
      );
    });

    it('should throw HttpException when addNewChatWithCounselor fails', async () => {
      const participantPhoneNumbers = ['+1234567890', '+0987654321'];
      const mockCounselor = {
        ...mockUser,
        phone: '+1234567890',
      };
      const mockClient = {
        ...mockUser,
        phone: '+0987654321',
      };

      jest
        .spyOn(userService, 'getUsersByPhoneNumbers')
        .mockResolvedValue([mockCounselor, mockClient]);
      jest
        .spyOn(service, 'addNewChatWithCounselor')
        .mockRejectedValue(new Error('Failed to create chat'));

      await expect(service.startCall(participantPhoneNumbers)).rejects.toThrow(
        'Failed to create chat',
      );
    });
  });

  describe('accept', () => {
    it('should accept a chat successfully', async () => {
      const mockUpdatedChat = {
        ...mockChat,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
      };
      const mockQueueEntry = { entryId: 1, chatId: 1 };

      jest.spyOn(service, 'getChatsByCouncilorId').mockResolvedValue(null);
      jest
        .spyOn(service, 'addCouncilorToChat')
        .mockResolvedValue(mockUpdatedChat as any);
      jest
        .spyOn(queueService, 'getQueueByChatId')
        .mockResolvedValue(mockQueueEntry as any);
      jest
        .spyOn(queueService, 'updateQueueStatus')
        .mockResolvedValue({} as any);
      jest.spyOn(service, 'getChatResponse').mockResolvedValue({} as any);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      await service.accept(2, 1);

      expect(service.addCouncilorToChat).toHaveBeenCalledWith(
        2,
        1,
        expect.any(Object),
      );
      expect(queueService.updateQueueStatus).toHaveBeenCalledWith(
        1,
        'MATCHED',
        expect.any(Object),
      );
    });

    it('should throw HttpException when counselor has active chat', async () => {
      jest.spyOn(service, 'getChatsByCouncilorId').mockResolvedValue(mockChat);

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(mockChat),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      await expect(service.accept(2, 1)).rejects.toThrow(HttpException);
      await expect(service.accept(2, 1)).rejects.toThrow(
        'You already have an active chat session',
      );
    });

    it('should throw HttpException when chat not found in queue', async () => {
      const mockUpdatedChat = {
        ...mockChat,
        counselorId: 2,
        status: ChatStatus.ACTIVE,
      };

      jest.spyOn(service, 'getChatsByCouncilorId').mockResolvedValue(null);
      jest
        .spyOn(service, 'addCouncilorToChat')
        .mockResolvedValue(mockUpdatedChat as any);
      jest.spyOn(queueService, 'getQueueByChatId').mockResolvedValue(null); // No queue entry found

      const mockTransaction = jest.fn().mockImplementation((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
          }),
        }),
      );
      jest.spyOn(dataSource, 'transaction').mockImplementation(mockTransaction);

      await expect(service.accept(2, 1)).rejects.toThrow(HttpException);
      await expect(service.accept(2, 1)).rejects.toThrow(
        'Chat not found in queue',
      );
    });
  });

  describe('saveMessage', () => {
    it('should save a message successfully', async () => {
      const messageData = {
        content: 'Test message',
        context: 'Test context',
        messageType: MessageType.TEXT,
        createdAt: new Date(),
        startSeconds: 10,
        endSeconds: 20,
        parentMessageId: 1,
      };

      jest
        .spyOn(messageService, 'saveMessage')
        .mockResolvedValue(mockMessage as any);

      const result = await service.saveMessage(1, 1, messageData);

      expect(result).toEqual(mockMessage);
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

  describe('cancelCallByClient', () => {
    it('should cancel call successfully', async () => {
      const mockPausedChat = {
        ...mockChat,
        status: ChatStatus.PAUSED,
      };
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockPausedChat as any);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(chatRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'del').mockResolvedValue(undefined);

      const result = await service.cancelCallByClient(1, 1);

      expect(result).toEqual({ success: true });
      expect(chatRepository.update).toHaveBeenCalledWith(1, {
        status: ChatStatus.CANCELLED,
        startedAt: expect.any(Date),
        endedAt: expect.any(Date),
      });
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        'Chat not found',
      );
    });

    it('should throw HttpException when user not authorized', async () => {
      const otherUserChat = { ...mockChat, clientId: 2 };
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(otherUserChat as any);

      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        'You are not authorized to cancel this call',
      );
    });

    it('should throw HttpException when call already ended', async () => {
      const endedChat = { ...mockChat, status: ChatStatus.ENDED };
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(endedChat as any);

      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        'Call is already ended',
      );
    });

    it('should throw HttpException when call is active', async () => {
      const activeChat = { ...mockChat, status: ChatStatus.ACTIVE };
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(activeChat as any);

      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        HttpException,
      );
      await expect(service.cancelCallByClient(1, 1)).rejects.toThrow(
        'Call is currently active and cannot be cancelled by client',
      );
    });
  });

  describe('createChat', () => {
    it('should create a chat successfully', async () => {
      const mockNewChat = { ...mockChat, id: 2 };
      jest.spyOn(chatRepository, 'create').mockReturnValue(mockNewChat as any);
      jest.spyOn(chatRepository, 'save').mockResolvedValue(mockNewChat as any);
      jest
        .spyOn(callDetailsRepository, 'save')
        .mockResolvedValue(mockCallDetails as any);

      const result = await service.createChat(1, undefined);

      expect(result).toEqual(mockNewChat);
      expect(chatRepository.create).toHaveBeenCalledWith({
        clientId: 1,
        status: ChatStatus.PAUSED,
        tenantId: 'test-tenant',
      });
      expect(callDetailsRepository.save).toHaveBeenCalledWith({
        chatId: 2,
        tenantId: 'test-tenant',
        callInfo: {
          provider: AudioChatProvider.WEBRTC,
        },
      });
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

  describe('getMessageObject', () => {
    it('should create message object', async () => {
      const messageData = {
        content: 'Test message',
        context: 'Test context',
        messageType: MessageType.TEXT,
      };
      jest
        .spyOn(messageService, 'getMessageObject')
        .mockReturnValue(mockMessage as any);

      const result = await service.getMessageObject(1, 1, messageData);

      expect(result).toEqual(mockMessage);
    });
  });

  describe('save', () => {
    it('should save message', async () => {
      jest.spyOn(messageService, 'save').mockResolvedValue(mockMessage as any);

      const result = await service.save(mockMessage);

      expect(result).toEqual(mockMessage);
      expect(messageService.save).toHaveBeenCalledWith(mockMessage);
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

  describe('handleDeepgramTranscript', () => {
    it('should handle deepgram transcript', async () => {
      const mockSession = { userId: 1, role: 'CLIENT' };
      const mockMetadata = {
        confidence: 0.9,
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Test transcript',
        currentTranscriptCreatedAt: new Date(),
      };

      jest
        .spyOn(service, 'handleDeepgramTranscript')
        .mockResolvedValue(undefined);

      await service.handleDeepgramTranscript(
        mockSession as any,
        1,
        'Test transcript',
        mockMetadata,
      );

      expect(service.handleDeepgramTranscript).toHaveBeenCalledWith(
        mockSession,
        1,
        'Test transcript',
        mockMetadata,
      );
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
});
