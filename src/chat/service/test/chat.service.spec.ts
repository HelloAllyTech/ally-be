import { Test, TestingModule } from '@nestjs/testing';
import { Repository, DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

import { ChatService } from '../chat.service';
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

import { Message } from '../../../common/entities/message.entity';
import { CallDetails } from '../../../common/entities/call.details.entity';
import { User } from '../../../common/entities/user.entity';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from '../../../common/entities/chat.entity';
import { MessageType } from '../../../common/entities/message.entity';
import { UserRole, UserStatus } from '../../../common/constants/user.constants';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import { ChatEvents } from '../../constants/chat.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { CallLogSortBy, SortOrder } from '../../dto/call-log.request.dto';
import { FlattenedSummaryNotePayloadCamelCase } from 'src/common/entities/type/call.details.type';
import { CallInfoDto } from '../../dto/chat.response.dto';
import { UserChatSessionData } from '../../type/chat.type';

describe('ChatService', () => {
  let service: ChatService;
  let messageRepository: Repository<Message>;
  let chatRepository: ChatRepository;
  let callDetailsRepository: Repository<CallDetails>;
  let queueService: QueueService;
  let userService: UserService;
  let aiService: AiService;
  let cache: RedisService;
  let dataSource: DataSource;
  let settingsService: SettingsService;
  let summaryFeedbackRepository: SummaryFeedbackRepository;
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
    messageRepository = module.get<MessageRepository>(MessageRepository);
    chatRepository = module.get<ChatRepository>(ChatRepository);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    queueService = module.get<QueueService>(QueueService);
    userService = module.get<UserService>(UserService);
    aiService = module.get<AiService>(AiService);
    cache = module.get<RedisService>(RedisService);
    dataSource = module.get<DataSource>(DataSource);
    settingsService = module.get<SettingsService>(SettingsService);
    summaryFeedbackRepository = module.get<SummaryFeedbackRepository>(
      SummaryFeedbackRepository,
    );
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
        .spyOn(messageRepository, 'create')
        .mockReturnValue(mockMessage as any);
      jest
        .spyOn(messageRepository, 'save')
        .mockResolvedValue(mockMessage as any);

      const result = await service.saveMessage(1, 1, messageData);

      expect(result).toEqual(mockMessage);
      expect(messageRepository.create).toHaveBeenCalledWith({
        chatId: 1,
        senderId: 1,
        content: 'Test message',
        context: 'Test context',
        type: MessageType.TEXT,
        tenantId: 'test-tenant',
        parentMessageId: 1,
        createdAt: expect.any(Date),
        startSeconds: 10,
        endSeconds: 20,
      });
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

  describe('getMessages', () => {
    it('should return messages for authorized user', async () => {
      const mockMessages = [mockMessage];
      const mockChatWithUsers = { ...mockChat, clientId: 1, counselorId: 2 };

      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithUsers as any);
      jest.spyOn(service, 'getMessageByChatId').mockResolvedValue({
        messages: mockMessages,
        count: 1,
      });
      jest.spyOn(service, 'formatMessage').mockReturnValue({
        messageId: 1,
        chatId: 1,
        senderId: 1,
        messageType: MessageType.TEXT,
        content: 'Test message',
        context: undefined,
        createdAt: expect.any(String),
        feedback: undefined,
        startSeconds: undefined,
        endSeconds: undefined,
      });

      const result = await service.getMessages(1, 1, {
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(result.data).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('should throw HttpException when chat not found', async () => {
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getMessages(1, 1, {})).rejects.toThrow(
        HttpException,
      );
      await expect(service.getMessages(1, 1, {})).rejects.toThrow(
        'Chat not found',
      );
    });

    it('should throw HttpException when user not authorized', async () => {
      const mockChatWithDifferentUsers = {
        ...mockChat,
        clientId: 2,
        counselorId: 3,
      };
      jest
        .spyOn(chatRepository, 'findOne')
        .mockResolvedValue(mockChatWithDifferentUsers as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await expect(service.getMessages(1, 1, {})).rejects.toThrow(
        HttpException,
      );
      await expect(service.getMessages(1, 1, {})).rejects.toThrow(
        'You are not authorized to access this chat',
      );
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

  describe('formatMessage', () => {
    it('should format message correctly', () => {
      const messageWithFeedback = {
        ...mockMessage,
        feedback: { id: 1, rating: 5, comment: 'Good' },
      };

      const result = service.formatMessage(messageWithFeedback as any);

      expect(result).toEqual({
        messageId: 1,
        chatId: 1,
        senderId: 1,
        messageType: MessageType.TEXT,
        content: 'Test message',
        context: undefined,
        createdAt: expect.any(String),
        feedback: { id: 1, rating: 5, comment: 'Good' },
        startSeconds: undefined,
        endSeconds: undefined,
      });
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

  describe('getMessageByChatId', () => {
    it('should return messages for chat ID', async () => {
      const mockMessages = [mockMessage];
      const mockQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockMessages, 1]),
      };
      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQuery as any);

      const result = await service.getMessageByChatId(1, {
        type: MessageType.TEXT,
        limit: 10,
        offset: 1,
        sortBy: 'createdAt',
        order: 'DESC',
      });

      expect(result).toEqual({ messages: mockMessages, count: 1 });
      expect(mockQuery.where).toHaveBeenCalledWith('message.chatId = :chatId', {
        chatId: 1,
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
        .spyOn(messageRepository, 'create')
        .mockReturnValue(mockMessage as any);

      const result = await service.getMessageObject(1, 1, messageData);

      expect(result).toEqual(mockMessage);
      expect(messageRepository.create).toHaveBeenCalledWith({
        chatId: 1,
        senderId: 1,
        content: 'Test message',
        context: 'Test context',
        type: MessageType.TEXT,
        tenantId: 'test-tenant',
      });
    });
  });

  describe('save', () => {
    it('should save message', async () => {
      jest
        .spyOn(messageRepository, 'save')
        .mockResolvedValue(mockMessage as any);

      const result = await service.save(mockMessage);

      expect(result).toEqual(mockMessage);
      expect(messageRepository.save).toHaveBeenCalledWith(mockMessage);
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
        .spyOn(service, 'getMessageByChatId')
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

  describe('incrementWordCountByLanguage', () => {
    it('should increment word count by language', async () => {
      jest.spyOn(cache, 'hincrBy').mockResolvedValue(5);

      const result = await service.incrementWordCountByLanguage(1, 'en', 3);

      expect(result).toBe(5);
      expect(cache.hincrBy).toHaveBeenCalledWith('call:1:word-count', 'en', 3);
    });
  });

  describe('getNudge', () => {
    it('should get nudge from AI service', async () => {
      const mockNudge = { nudge: 'Test nudge', stage: 'Test stage' };
      const mockMessages = [{ role: 'CLIENT', content: 'Hello' }];

      jest.spyOn(aiService, 'getNudge').mockResolvedValue(mockNudge as any);

      const result = await service.getNudge('Hello', mockMessages as any);

      expect(result).toEqual(mockNudge);
      expect(aiService.getNudge).toHaveBeenCalledWith('Hello', mockMessages);
    });
  });

  describe('tagPositivityRatings', () => {
    it('should get tag positivity ratings', async () => {
      const mockTags = ['positive', 'negative'];
      const mockResponse = { tags: [{ tag: 'positive', rating: 0.8 }] };

      jest
        .spyOn(aiService, 'generateTagPositivityRatings')
        .mockResolvedValue(mockResponse as any);

      const result = await service.tagPositivityRatings(mockTags);

      expect(result).toEqual(mockResponse.tags);
      expect(aiService.generateTagPositivityRatings).toHaveBeenCalledWith(
        mockTags,
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

  describe('getCounselorNames', () => {
    it('should return counselor names', async () => {
      const mockNames = ['John Doe', 'Jane Smith'];

      jest
        .spyOn(userService, 'getCounselorNames')
        .mockResolvedValue(mockNames as any);

      const result = await service.getCounselorNames(10, 0, 'John');

      expect(result).toEqual(mockNames);
      expect(userService.getCounselorNames).toHaveBeenCalledWith(10, 0, 'John');
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

  describe('handleChatEnded', () => {
    it('should handle chat ended for WEBRTC provider', async () => {
      const mockCallDetailsForWebRTC = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForWebRTC as any);
      jest.spyOn(service, 'updateSummaryAndTags').mockResolvedValue(undefined);
      jest
        .spyOn(service, 'updateMessageStatistics')
        .mockResolvedValue(undefined);

      await service.handleChatEnded(mockChat);

      expect(service.updateSummaryAndTags).toHaveBeenCalledWith(mockChat);
      expect(service.updateMessageStatistics).toHaveBeenCalledWith(
        mockChat,
        mockCallDetailsForWebRTC,
      );
    });

    it('should handle chat ended for MICROPHONE provider', async () => {
      const mockCallDetailsForMicrophone = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.MICROPHONE },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForMicrophone as any);
      jest
        .spyOn(service['streamFileProcessorService'], 'endCallStream')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service['broadcastMessageService'], 'broadcastChatEndedEvent')
        .mockImplementation(() => {});

      await service.handleChatEnded(mockChat);

      expect(
        service['streamFileProcessorService'].endCallStream,
      ).toHaveBeenCalledWith({
        chatId: mockChat.id,
        provider: AudioChatProvider.MICROPHONE,
      });
      expect(
        service['broadcastMessageService'].broadcastChatEndedEvent,
      ).toHaveBeenCalled();
    });

    it('should handle chat ended for OZONETEL', async () => {
      const mockCallDetailsForPhone = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.OZONETEL },
      };

      const updateSummaryAndTagsSpy = jest
        .spyOn(service, 'updateSummaryAndTags')
        .mockResolvedValue(undefined);
      const updateMessageStatisticsSpy = jest
        .spyOn(service, 'updateMessageStatistics')
        .mockResolvedValue(undefined);

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForPhone as any);
      jest
        .spyOn(service['broadcastMessageService'], 'broadcastChatEndedEvent')
        .mockImplementation(() => {});

      await service.handleChatEnded(mockChat);

      // For non-WEBRTC providers, updateSummaryAndTags and updateMessageStatistics are not called
      expect(updateSummaryAndTagsSpy).not.toHaveBeenCalled();
      expect(updateMessageStatisticsSpy).not.toHaveBeenCalled();
      expect(
        service['broadcastMessageService'].broadcastChatEndedEvent,
      ).toHaveBeenCalled();
    });
  });

  describe('updateSummaryAndTags', () => {
    it('should update summary and tags', async () => {
      const mockSummary = { summary: 'Test summary', tags: ['tag1', 'tag2'] };

      jest
        .spyOn(service, 'generateSummary')
        .mockResolvedValue(mockSummary as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateSummaryAndTags(mockChat);

      expect(service.generateSummary).toHaveBeenCalledWith(mockChat.id);
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: mockChat.id },
        { summary: mockSummary },
      );
    });

    it('should handle error when generateSummary fails', async () => {
      jest
        .spyOn(service, 'generateSummary')
        .mockRejectedValue(new Error('AI service error'));

      await expect(service.updateSummaryAndTags(mockChat)).rejects.toThrow(
        'AI service error',
      );
      expect(service.generateSummary).toHaveBeenCalledWith(mockChat.id);
    });
  });

  describe('updateCallMetadata', () => {
    it('should update call metadata with provided duration', async () => {
      const mockCallDetailsForUpdate = { ...mockCallDetails, callInfo: {} };

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat as any);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForUpdate as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallMetadata(1, 300);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          endTime: expect.any(Date),
          callDuration: 300,
        }),
      );
    });

    it('should update call metadata without duration', async () => {
      const mockCallDetailsForUpdate = {
        ...mockCallDetails,
        callInfo: {},
        startTime: new Date('2023-01-01T10:00:00Z'),
        endTime: null,
        callDuration: 0,
      };

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForUpdate as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallMetadata(1);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          endTime: expect.any(Date),
          callDuration: expect.any(Number),
        }),
      );
    });

    it('should update call metadata using chat.startedAt for duration calculation', async () => {
      const mockChatWithStartedAt = {
        ...mockChat,
        startedAt: new Date('2023-01-01T10:00:00Z'),
      };
      const mockCallDetailsForUpdate = {
        ...mockCallDetails,
        callInfo: {},
        startTime: new Date('2023-01-01T10:00:00Z'),
        endTime: null,
        callDuration: 0,
      };

      jest
        .spyOn(service, 'getChatById')
        .mockResolvedValue(mockChatWithStartedAt);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForUpdate as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallMetadata(1);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          endTime: expect.any(Date),
          callDuration: expect.any(Number),
        }),
      );
    });

    it('should handle error gracefully', async () => {
      jest
        .spyOn(service, 'getChatById')
        .mockRejectedValue(new Error('Test error'));

      await service.updateCallMetadata(1);

      expect(true).toBe(true);
    });
  });

  describe('updateMessageStatistics', () => {
    it('should update message statistics successfully', async () => {
      const mockMessages = [
        {
          ...mockMessage,
          senderId: 1,
          content: 'Hello',
          sender: { role: UserRole.CLIENT },
          type: MessageType.TEXT,
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Hi',
          sender: { role: UserRole.COUNSELOR },
          type: MessageType.TEXT,
        },
      ];
      const mockCallDetailsForStats = { ...mockCallDetails, callInfo: {} };

      jest
        .spyOn(service, 'getMessageByChatId')
        .mockResolvedValue({ messages: mockMessages, count: 2 });
      jest
        .spyOn(service as any, 'getWordCountByLanguage')
        .mockResolvedValue({ en: 10, es: 5 });
      jest
        .spyOn(service as any, 'deleteWordCountByLanguage')
        .mockResolvedValue(undefined);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateMessageStatistics(
        mockChat,
        mockCallDetailsForStats as any,
      );

      expect(service.getMessageByChatId).toHaveBeenCalledWith(mockChat.id, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
      expect((service as any).getWordCountByLanguage).toHaveBeenCalledWith(
        mockChat.id,
      );
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: mockChat.id },
        expect.objectContaining({
          callInfo: expect.objectContaining({
            clientTalkingPercentage: expect.any(Number),
            counselorTalkingPercentage: expect.any(Number),
            clientTalkingTime: expect.any(Number),
            counselorTalkingTime: expect.any(Number),
            summaryName: expect.any(String),
            wordCountByLanguage: { en: 10, es: 5 },
            clientWordCount: expect.any(Number),
            counselorWordCount: expect.any(Number),
          }),
          endTime: expect.any(Date),
          callDuration: expect.any(Number),
          noOfNudges: 0,
        }),
      );
      expect((service as any).deleteWordCountByLanguage).toHaveBeenCalledWith(
        mockChat.id,
      );
    });

    it('should handle NUDGE and STAGE message types', async () => {
      const mockMessages = [
        {
          ...mockMessage,
          senderId: 1,
          content: 'Nudge message',
          sender: { role: UserRole.CLIENT },
          type: MessageType.NUDGE,
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Stage 1',
          sender: { role: UserRole.COUNSELOR },
          type: MessageType.STAGE,
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Stage 2',
          sender: { role: UserRole.COUNSELOR },
          type: MessageType.STAGE,
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Stage 1',
          sender: { role: UserRole.COUNSELOR },
          type: MessageType.STAGE,
        },
        {
          ...mockMessage,
          senderId: 1,
          content: 'Hello',
          sender: { role: UserRole.CLIENT },
          type: MessageType.TEXT,
        },
      ];
      const mockCallDetailsForStats = { ...mockCallDetails, callInfo: {} };

      jest
        .spyOn(service, 'getMessageByChatId')
        .mockResolvedValue({ messages: mockMessages, count: 5 });
      jest
        .spyOn(service as any, 'getWordCountByLanguage')
        .mockResolvedValue({ en: 10, es: 5 });
      jest
        .spyOn(service as any, 'deleteWordCountByLanguage')
        .mockResolvedValue(undefined);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateMessageStatistics(
        mockChat,
        mockCallDetailsForStats as any,
      );

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: mockChat.id },
        expect.objectContaining({
          noOfNudges: 1,
          noOfStages: 3, // "Stage 1", "Stage 2", then "Stage 1" again (different from current "Stage 2")
          callInfo: expect.objectContaining({
            clientWordCount: 1, // Only the TEXT message "Hello" counts
            counselorWordCount: 0, // No TEXT messages from counselor
          }),
        }),
      );
    });

    it('should skip non-TEXT message types for word count', async () => {
      const mockMessages = [
        {
          ...mockMessage,
          senderId: 1,
          content: 'Nudge message',
          sender: { role: UserRole.CLIENT },
          type: MessageType.NUDGE,
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Stage message',
          sender: { role: UserRole.COUNSELOR },
          type: MessageType.STAGE,
        },
        {
          ...mockMessage,
          senderId: 1,
          content: 'System message',
          sender: { role: UserRole.CLIENT },
          type: MessageType.SYSTEM,
        },
      ];
      const mockCallDetailsForStats = { ...mockCallDetails, callInfo: {} };

      jest
        .spyOn(service, 'getMessageByChatId')
        .mockResolvedValue({ messages: mockMessages, count: 3 });
      jest
        .spyOn(service as any, 'getWordCountByLanguage')
        .mockResolvedValue({ en: 10, es: 5 });
      jest
        .spyOn(service as any, 'deleteWordCountByLanguage')
        .mockResolvedValue(undefined);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateMessageStatistics(
        mockChat,
        mockCallDetailsForStats as any,
      );

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: mockChat.id },
        expect.objectContaining({
          noOfNudges: 1,
          noOfStages: 1,
          callInfo: expect.objectContaining({
            clientWordCount: 0, // No TEXT messages
            counselorWordCount: 0, // No TEXT messages
          }),
        }),
      );
    });

    it('should handle error gracefully', async () => {
      jest
        .spyOn(service, 'getMessageByChatId')
        .mockRejectedValue(new Error('Test error'));

      await service.updateMessageStatistics(mockChat);

      expect(true).toBe(true);
    });
  });

  describe('generateSummary', () => {
    it('should generate summary', async () => {
      const mockMessageRequests = [{ role: 'CLIENT', content: 'Hello' }];
      const mockAiResponse = { summary: 'Test summary', tags: ['tag1'] };

      jest
        .spyOn(service, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessageRequests as any);
      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(mockAiResponse as any);

      const result = await service.generateSummary(1);

      expect(service.getChatHistoryForAIService).toHaveBeenCalledWith(1, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
      expect(aiService.generateSummaryAndTags).toHaveBeenCalledWith(
        mockMessageRequests,
      );
      expect(result).toEqual(mockAiResponse);
    });
  });

  describe('generateSummaryForMessage', () => {
    it('should generate summary for message', async () => {
      const mockMessageRequests = [{ role: 'CLIENT', content: 'Hello' }];
      const mockAiResponse = { summary: 'Test summary' };

      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(mockAiResponse as any);

      const result = await service.generateSummaryForMessage(
        mockMessageRequests as any,
      );

      expect(aiService.generateSummaryAndTags).toHaveBeenCalledWith(
        mockMessageRequests,
      );
      expect(result).toEqual(mockAiResponse);
    });

    it('should return undefined when AI service returns null', async () => {
      const mockMessageRequests = [{ role: 'CLIENT', content: 'Hello' }];

      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(undefined);

      const result = await service.generateSummaryForMessage(
        mockMessageRequests as any,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('getChatHistoryForAIService', () => {
    it('should get chat history for AI service', async () => {
      const mockMessages = [
        {
          ...mockMessage,
          senderId: 1,
          content: 'Hello',
          sender: { role: UserRole.CLIENT },
        },
        {
          ...mockMessage,
          senderId: 2,
          content: 'Hi',
          sender: { role: UserRole.COUNSELOR },
        },
      ];
      const mockQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockMessages),
      };

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQuery as any);

      const result = await service.getChatHistoryForAIService(1, {
        offset: 0,
        limit: 10,
        sortBy: 'createdAt',
        order: 'DESC',
      });

      expect(result).toEqual([
        {
          role: 'CLIENT',
          content: 'Hello',
          start_time: undefined,
          end_time: undefined,
        },
        {
          role: 'COUNSELOR',
          content: 'Hi',
          start_time: undefined,
          end_time: undefined,
        },
      ]);
    });
  });

  describe('enhance', () => {
    it('should enhance summary', async () => {
      const mockEnhancedSummary = 'Enhanced summary';

      jest
        .spyOn(aiService, 'enhance')
        .mockResolvedValue(mockEnhancedSummary as any);

      const result = await service.enhance('Original summary');

      expect(aiService.enhance).toHaveBeenCalledWith('Original summary');
      expect(result).toEqual(mockEnhancedSummary);
    });
  });

  describe('getCallLogs', () => {
    it('should get call logs for counselor', async () => {
      const mockUser = { id: 1, role: UserRole.COUNSELOR };
      const mockCallLogs = [{ ...mockChat, details: mockCallDetails }];
      const mockQuery = {
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockCallLogs, 1]),
      };

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQuery as any);

      const result = await service.getCallLogs(mockUser as any, {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual({ data: mockCallLogs, count: 1 });
      expect(mockQuery.where).toHaveBeenCalledWith(
        'chat.counselorId = :counselorId',
        { counselorId: 1 },
      );
    });
  });

  describe('getAllTags', () => {
    it('should get all tags', async () => {
      const mockTags = [{ tag: 'tag1' }, { tag: 'tag2' }];
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockTags),
        getCount: jest.fn().mockResolvedValue(2),
      };

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQuery as any);

      const result = await service.getAllTags(10, 0, 'tag');

      expect(result).toEqual({
        data: ['tag1', 'tag2'],
        count: 2,
      });
    });
  });

  describe('pauseOrResumeChat', () => {
    it('should pause chat', async () => {
      const mockCallDetailsForPause = { ...mockCallDetails, callInfo: {} };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForPause as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      await service.pauseOrResumeChat(1, true);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        { callInfo: { ...mockCallDetailsForPause.callInfo, pauseChat: true } },
      );
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'true',
        expect.any(Number),
      );
    });

    it('should resume chat', async () => {
      const mockCallDetailsForResume = {
        ...mockCallDetails,
        callInfo: { pauseChat: true },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForResume as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      await service.pauseOrResumeChat(1, false);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: { ...mockCallDetailsForResume.callInfo, pauseChat: false },
        },
      );
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'false',
        expect.any(Number),
      );
    });
  });

  describe('isChatPaused', () => {
    it('should return cached pause status', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue('true');

      const result = await service.isChatPaused(1);

      expect(result).toBe(true);
    });

    it('should fetch from database when not cached', async () => {
      const mockCallDetailsForPause = {
        ...mockCallDetails,
        callInfo: { pauseChat: true },
      };

      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForPause as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      const result = await service.isChatPaused(1);

      expect(result).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'true',
        expect.any(Number),
      );
    });

    it('should return undefined when no call details found', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      const result = await service.isChatPaused(1);

      expect(result).toBeUndefined();
    });
  });

  describe('getWordCountByLanguage', () => {
    it('should get word count by language', async () => {
      const mockWordCounts = { en: '10', es: '5' };
      jest.spyOn(cache, 'hgetAll').mockResolvedValue(mockWordCounts);

      const result = await (service as any).getWordCountByLanguage(1);

      expect(result).toEqual({ en: 10, es: 5 });
      expect(cache.hgetAll).toHaveBeenCalledWith('call:1:word-count');
    });
  });

  describe('deleteWordCountByLanguage', () => {
    it('should delete word count by language', async () => {
      jest.spyOn(cache, 'del').mockResolvedValue(undefined);

      const result = await (service as any).deleteWordCountByLanguage(1);

      expect(result).toBeUndefined();
      expect(cache.del).toHaveBeenCalledWith('call:1:word-count');
    });
  });

  describe('addNoteToSession', () => {
    it('should add note to session', async () => {
      const mockCallDetailsForNote = { ...mockCallDetails, callInfo: {} };
      const noteDto = { content: 'Test note' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetailsForNote as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      const result = await service.addNoteToSession(1, noteDto);

      expect(result).toEqual({ notes: 'Test note' });
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: { ...mockCallDetailsForNote.callInfo, notes: 'Test note' },
        },
      );
    });
  });

  describe('persistAndBroadcastMessage', () => {
    it('should persist and broadcast message', async () => {
      const mockSession = {
        userId: 1,
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      };
      const mockMessageData = {
        chatId: 1,
        content: 'Test message',
        messageType: MessageType.TEXT,
      };
      const mockBroadcastOptions = {
        event: ChatEvents.MESSAGE_RECEIVED,
      };

      jest.spyOn(service, 'saveMessage').mockResolvedValue(mockMessage as any);
      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat as any);
      jest.spyOn(service['publisher'], 'publish').mockResolvedValue(undefined);

      const result = await service.persistAndBroadcastMessage(
        mockSession as any,
        mockMessageData,
        mockBroadcastOptions,
      );

      expect(result).toEqual(mockMessage);
      expect(service.saveMessage).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({
          content: 'Test message',
          messageType: MessageType.TEXT,
        }),
      );
      expect(service['publisher'].publish).toHaveBeenCalledWith(
        'chat-message-WEBRTC',
        {
          participants: [2, 1], // counselorId, clientId
          message: mockMessage,
          broadCastOptions: mockBroadcastOptions,
        },
      );
    });
  });

  describe('getAdminCallLogs', () => {
    const mockCallLogs = [{ ...mockChat, details: mockCallDetails }];

    const mockQueryBuilder = {
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([mockCallLogs, 1]),
    };

    beforeEach(() => {
      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    it('should build the base query correctly and return call logs', async () => {
      const mockResult = [
        { id: 1, details: {} },
        { id: 2, details: {} },
      ];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockResult, 2]);

      const result = await service['getAdminCallLogs']({
        limit: 10,
        offset: 0,
        sortBy: CallLogSortBy.START_DATE,
        order: SortOrder.DESC,
        counselorName: 'John',
        counselorIds: '1,2',
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        minDuration: 60,
        maxDuration: 3600,
        minQualityScore: 3,
        maxQualityScore: 5,
        tags: 'urgent,important',
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledTimes(3);

      // Check that the base filters are applied
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.status = :status',
        { status: ChatStatus.ENDED },
      );

      // Check that pagination is applied
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // Note: offset(0) is not called because 0 is falsy in JavaScript

      // Check that sorting is applied
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.startedAt',
        SortOrder.DESC,
      );

      // Check that the query is executed
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();

      expect(result).toEqual({ data: mockResult, count: 2 });
    });

    it('should apply string filter for counselorName', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({ counselorName: 'John' } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'counselor.name ILIKE :counselorName',
        { counselorName: '%John%' },
      );
    });

    it('should apply ID filter for counselorIds', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({ counselorIds: '1, 2, 3' } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.counselorId IN (:...counselorIds)',
        { counselorIds: [1, 2, 3] },
      );
    });

    it('should apply date filters correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-12-31T23:59:59Z';

      await service.getAdminCallLogs({ startDate, endDate } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt >= :startDate',
        { startDate: new Date(startDate) },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt <= :endDate',
        { endDate: new Date(endDate) },
      );
    });

    it('should apply duration filters correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({
        minDuration: 10,
        maxDuration: 60,
      } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration >= :minDuration',
        { minDuration: 10 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration <= :maxDuration',
        { maxDuration: 60 },
      );
    });

    it('should apply quality filters correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({
        minQualityScore: 3,
        maxQualityScore: 5,
      } as any);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        { minQualityScore: 3 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
        { maxQualityScore: 5 },
      );
    });

    it('should apply tag filters correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({ tags: 'urgent, followup' } as any);

      // The base tag filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
      );

      // The tag matching clause
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags: ['urgent', 'followup'] },
      );
    });

    it('should apply sorting by counselor name', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.getAdminCallLogs({
        sortBy: CallLogSortBy.COUNSELOR_NAME,
        order: SortOrder.ASC,
      } as any);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'counselor.name',
        SortOrder.ASC,
      );
    });
  });

  describe('private filter methods', () => {
    const mockQuery = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
    };

    describe('applyStringFilters', () => {
      it('should apply counselor name filter', () => {
        const filters = { counselorName: 'John Doe' };
        (service as any).applyStringFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'counselor.name ILIKE :counselorName',
          { counselorName: '%John Doe%' },
        );
      });

      it('should not apply filter when counselorName is not provided', () => {
        const filters = {};
        (service as any).applyStringFilters(mockQuery, filters);

        expect(mockQuery.andWhere).not.toHaveBeenCalled();
      });
    });

    describe('applyIdFilters', () => {
      it('should apply counselor IDs filter', () => {
        const filters = { counselorIds: '1, 2, 3' };
        (service as any).applyIdFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.counselorId IN (:...counselorIds)',
          { counselorIds: [1, 2, 3] },
        );
      });

      it('should filter out invalid IDs', () => {
        const filters = { counselorIds: '1, invalid, 3, 4' };
        (service as any).applyIdFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.counselorId IN (:...counselorIds)',
          { counselorIds: [1, 3, 4] },
        );
      });

      it('should not apply filter when no valid IDs', () => {
        const filters = { counselorIds: 'invalid, not-a-number' };
        (service as any).applyIdFilters(mockQuery, filters);

        expect(mockQuery.andWhere).not.toHaveBeenCalled();
      });

      it('should not apply filter when counselorIds is not provided', () => {
        const filters = {};
        (service as any).applyIdFilters(mockQuery, filters);

        expect(mockQuery.andWhere).not.toHaveBeenCalled();
      });
    });

    describe('applyDateFilters', () => {
      it('should apply start date filter', () => {
        const filters = { startDate: '2024-01-01T00:00:00Z' };
        (service as any).applyDateFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.startedAt >= :startDate',
          { startDate: new Date('2024-01-01T00:00:00Z') },
        );
      });

      it('should apply end date filter', () => {
        const filters = { endDate: '2024-12-31T23:59:59Z' };
        (service as any).applyDateFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.startedAt <= :endDate',
          { endDate: new Date('2024-12-31T23:59:59Z') },
        );
      });

      it('should apply both start and end date filters', () => {
        const filters = {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
        };
        (service as any).applyDateFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.startedAt >= :startDate',
          { startDate: new Date('2024-01-01T00:00:00Z') },
        );
        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'chat.startedAt <= :endDate',
          { endDate: new Date('2024-12-31T23:59:59Z') },
        );
      });
    });

    describe('applyDurationFilters', () => {
      it('should apply min duration filter', () => {
        const filters = { minDuration: 60 };
        (service as any).applyDurationFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'details.callDuration >= :minDuration',
          { minDuration: 60 },
        );
      });

      it('should apply max duration filter', () => {
        const filters = { maxDuration: 3600 };
        (service as any).applyDurationFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'details.callDuration <= :maxDuration',
          { maxDuration: 3600 },
        );
      });

      it('should apply both min and max duration filters', () => {
        const filters = { minDuration: 60, maxDuration: 3600 };
        (service as any).applyDurationFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'details.callDuration >= :minDuration',
          { minDuration: 60 },
        );
        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'details.callDuration <= :maxDuration',
          { maxDuration: 3600 },
        );
      });

      it('should handle minDuration of 0', () => {
        const filters = { minDuration: 0 };
        (service as any).applyDurationFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          'details.callDuration >= :minDuration',
          { minDuration: 0 },
        );
      });
    });

    describe('applyQualityFilters', () => {
      it('should apply min quality score filter', () => {
        const filters = { minQualityScore: 3 };
        (service as any).applyQualityFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
          { minQualityScore: 3 },
        );
      });

      it('should apply max quality score filter', () => {
        const filters = { maxQualityScore: 5 };
        (service as any).applyQualityFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
          { maxQualityScore: 5 },
        );
      });

      it('should apply both min and max quality score filters', () => {
        const filters = { minQualityScore: 3, maxQualityScore: 5 };
        (service as any).applyQualityFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
          { minQualityScore: 3 },
        );
        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
          { maxQualityScore: 5 },
        );
      });
    });

    describe('applyTagFilters', () => {
      it('should apply base tag filter and tag matching', () => {
        const filters = { tags: 'urgent, followup' };
        (service as any).applyTagFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
        );
        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
          { tags: ['urgent', 'followup'] },
        );
      });

      it('should apply only base tag filter when no tags provided', () => {
        const filters = {};
        (service as any).applyTagFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
        );
        expect(mockQuery.andWhere).toHaveBeenCalledTimes(1);
      });

      it('should handle single tag', () => {
        const filters = { tags: 'urgent' };
        (service as any).applyTagFilters(mockQuery, filters);

        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
          { tags: ['urgent'] },
        );
      });
    });

    describe('applySorting', () => {
      it('should apply sorting by ID', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.ID,
          SortOrder.ASC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith('chat.id', 'ASC');
      });

      it('should apply sorting by counselor name', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.COUNSELOR_NAME,
          SortOrder.DESC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          'counselor.name',
          'DESC',
        );
      });

      it('should apply sorting by client ID', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.CLIENT_ID,
          SortOrder.ASC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith('chat.clientId', 'ASC');
      });

      it('should apply sorting by call duration', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.CALL_DURATION,
          SortOrder.DESC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          'details.callDuration',
          'DESC',
        );
      });

      it('should apply sorting by start date', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.START_DATE,
          SortOrder.ASC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith('chat.startedAt', 'ASC');
      });

      it('should apply sorting by quality score', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.QUALITY_SCORE,
          SortOrder.DESC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          "CAST(details.summary->>'callQuality' AS NUMERIC)",
          'DESC',
        );
      });

      it('should apply sorting by tags', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.TAGS,
          SortOrder.DESC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          "details.summary->'tags'->0->>'tag'",
          'DESC',
        );
      });

      it('should apply sorting by created at', () => {
        (service as any).applySorting(
          mockQuery,
          CallLogSortBy.CREATED_AT,
          SortOrder.DESC,
        );

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          'chat.createdAt',
          'DESC',
        );
      });

      it('should default to DESC order when not specified', () => {
        (service as any).applySorting(mockQuery, CallLogSortBy.START_DATE);

        expect(mockQuery.orderBy).toHaveBeenCalledWith(
          'chat.startedAt',
          'DESC',
        );
      });
    });
  });

  describe('updateCallDetails', () => {
    it('should update call details', async () => {
      const mockSummary: FlattenedSummaryNotePayloadCamelCase = {
        callQuality: 5,
        newCallFollowUp: 'scheduled',
        callId: 'test-call-1',
        callDuration: 3600,
        callDate: '2023-01-01',
        callTime: '10:00:00',
        clientId: '1',
        counsellor: 'Jane Smith',
        callType: 'audio',
        age: 25,
        gender: 'female',
        profession: 'student',
        relationshipStatus: 'single',
        languages: [{ language: 'en', percentage: 100 }],
        location: 'New York',
        codeOfConcern: 'anxiety',
        sessionSummary: 'Test summary',
        counselingProcessFlow: 'intake',
        keyConcerns: 'anxiety and stress',
        subjectiveObservations: 'Client appeared anxious',
        objectiveObservations: 'Client was fidgeting',
        assessment: 'Mild anxiety',
        dominantFeelings: 'anxiety, worry',
        issuesWorkedOn: 'stress management',
        keyTherapeuticTechniques: 'CBT, mindfulness',
        referralsProvided: null,
        homework: 'Practice breathing exercises',
        planForNextCall: 'Continue CBT techniques',
        listeningShare: 0.7,
        reflectiveQuestionsAsked: 5,
        openEndedQuestionsAsked: 3,
        emotionalLift: 'positive',
        tags: [{ tag: 'tag1', positivity_rating: 0.5 }],
      };

      const mockChatWithDetails = {
        ...mockChat,
        details: {
          id: 1,
          chatId: 1,
          callDuration: 300,
          startTime: new Date(),
          endTime: new Date(),
          noOfNudges: 0,
          noOfStages: 1,
          transcript: 'Test transcript',
          summary: undefined,
          callOutcome: 'Completed',
          callInfo: undefined,
          tenantId: 'test-tenant',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(service, 'getChat').mockResolvedValue(mockChatWithDetails);

      const result = await service.updateCallDetails(1, mockSummary);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        { summary: mockSummary },
      );
      expect(service.getChat).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockChatWithDetails);
    });
  });

  describe('updateCallInfo', () => {
    it('should update call info successfully', async () => {
      const mockCallInfo: CallInfoDto = {
        summaryName: 'CALL-456',
      };

      const mockCallDetails = {
        id: 1,
        chatId: 1,
        callInfo: {
          provider: AudioChatProvider.MICROPHONE,
          platform: AudioChatPlatform.WEB,
        },
        tenantId: 'test-tenant',
      };

      const mockChatWithDetails = {
        ...mockChat,
        details: {
          id: 1,
          chatId: 1,
          callDuration: 300,
          startTime: new Date(),
          endTime: new Date(),
          noOfNudges: 0,
          noOfStages: 1,
          transcript: 'Test transcript',
          summary: undefined,
          callOutcome: 'Completed',
          callInfo: undefined,
          tenantId: 'test-tenant',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      // Mock ExecutionManager to return counselorId that matches the chat
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('2');

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(service, 'getChat').mockResolvedValue(mockChatWithDetails);

      const result = await service.updateCallInfo(1, mockCallInfo);

      expect(service.getChatById).toHaveBeenCalledWith(1);
      expect(callDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 1, tenantId: 'test-tenant' },
      });
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        { callInfo: { ...mockCallDetails.callInfo, summaryName: 'CALL-456' } },
      );
      expect(service.getChat).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockChatWithDetails);
    });

    it('should throw NotFoundException when chat not found', async () => {
      const mockCallInfo: CallInfoDto = {
        summaryName: 'CALL-456',
      };

      jest.spyOn(service, 'getChatById').mockResolvedValue(null);

      await expect(service.updateCallInfo(1, mockCallInfo)).rejects.toThrow(
        'Chat with ID 1 not found',
      );
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      const mockCallInfo: CallInfoDto = {
        summaryName: 'CALL-456',
      };

      const mockChatWithDifferentCounselor = {
        ...mockChat,
        counselorId: 999, // Different counselor ID
      };

      // Mock ExecutionManager to return different user ID
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('123');
      jest
        .spyOn(service, 'getChatById')
        .mockResolvedValue(mockChatWithDifferentCounselor as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await expect(service.updateCallInfo(1, mockCallInfo)).rejects.toThrow(
        'You are not authorized to update call info for this chat',
      );
    });

    it('should throw NotFoundException when call details not found', async () => {
      const mockCallInfo: CallInfoDto = {
        summaryName: 'CALL-456',
      };

      // Mock ExecutionManager to return counselorId that matches the chat
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('2');

      jest.spyOn(service, 'getChatById').mockResolvedValue(mockChat);
      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.updateCallInfo(1, mockCallInfo)).rejects.toThrow(
        'Call details not found for chat 1',
      );
    });
  });

  describe('triggerNudge', () => {
    const mockNewMessage = {
      content: 'Hello, I need help',
      chatId: 1,
      id: 123,
    };

    const mockSession: UserChatSessionData = {
      id: '1',
      type: 'user',
      user: null,
      room: 'test-room',
      chatId: 1,
      userId: 1,
      role: UserRole.CLIENT,
      tenantId: 'test-tenant',
    };

    const mockChannel = 'test-channel';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should trigger nudge successfully when chat is not paused and nudge is enabled', async () => {
      const mockMessages = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];
      const mockNudgeResponse = {
        nudge: 'How are you feeling today?',
        stage: 'Assessment',
      };

      jest.spyOn(service, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(service, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages as any);
      jest
        .spyOn(aiService, 'getNudge')
        .mockResolvedValue(mockNudgeResponse as any);
      jest.spyOn(service, 'handleNudge').mockResolvedValue(undefined);

      await service.triggerNudge(mockNewMessage, mockSession, 1, mockChannel);

      expect(service.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(service.getChatHistoryForAIService).toHaveBeenCalledWith(1, {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 4,
      });
      expect(aiService.getNudge).toHaveBeenCalledWith(
        'CLIENT: Hello, I need help',
        mockMessages,
      );
      expect(service.handleNudge).toHaveBeenCalledWith(
        mockNudgeResponse,
        mockSession,
        mockNewMessage,
        mockChannel,
      );
    });

    it('should not trigger nudge when chat is paused', async () => {
      jest.spyOn(service, 'isChatPaused').mockResolvedValue(true);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest.spyOn(service, 'getChatHistoryForAIService').mockResolvedValue([]);
      jest.spyOn(aiService, 'getNudge').mockResolvedValue({} as any);
      jest.spyOn(service, 'handleNudge').mockResolvedValue(undefined);

      await service.triggerNudge(mockNewMessage, mockSession, 1, mockChannel);

      expect(service.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).not.toHaveBeenCalled();
      expect(service.getChatHistoryForAIService).not.toHaveBeenCalled();
      expect(aiService.getNudge).not.toHaveBeenCalled();
      expect(service.handleNudge).not.toHaveBeenCalled();
    });

    it('should not trigger nudge when nudge is disabled', async () => {
      jest.spyOn(service, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(false);
      jest.spyOn(service, 'getChatHistoryForAIService').mockResolvedValue([]);
      jest.spyOn(aiService, 'getNudge').mockResolvedValue({} as any);
      jest.spyOn(service, 'handleNudge').mockResolvedValue(undefined);

      await service.triggerNudge(mockNewMessage, mockSession, 1, mockChannel);

      expect(service.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(service.getChatHistoryForAIService).not.toHaveBeenCalled();
      expect(aiService.getNudge).not.toHaveBeenCalled();
      expect(service.handleNudge).not.toHaveBeenCalled();
    });

    it('should not call handleNudge when AI service returns undefined', async () => {
      const mockMessages = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];

      jest.spyOn(service, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(service, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages as any);
      jest.spyOn(aiService, 'getNudge').mockResolvedValue(undefined);
      jest.spyOn(service, 'handleNudge').mockResolvedValue(undefined);

      await service.triggerNudge(mockNewMessage, mockSession, 1, mockChannel);

      expect(service.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(service.getChatHistoryForAIService).toHaveBeenCalledWith(1, {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 4,
      });
      expect(aiService.getNudge).toHaveBeenCalledWith(
        'CLIENT: Hello, I need help',
        mockMessages,
      );
      expect(service.handleNudge).not.toHaveBeenCalled();
    });

    it('should handle AI service error gracefully', async () => {
      const mockMessages = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];
      const mockError = new Error('AI service error');

      jest.spyOn(service, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(service, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages as any);
      jest.spyOn(aiService, 'getNudge').mockRejectedValue(mockError);
      jest.spyOn(service, 'handleNudge').mockResolvedValue(undefined);

      // Should not throw error
      await service.triggerNudge(mockNewMessage, mockSession, 1, mockChannel);

      expect(service.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(service.getChatHistoryForAIService).toHaveBeenCalledWith(1, {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 4,
      });
      expect(aiService.getNudge).toHaveBeenCalledWith(
        'CLIENT: Hello, I need help',
        mockMessages,
      );
      expect(service.handleNudge).not.toHaveBeenCalled();
    });
  });

  describe('handleNudge', () => {
    const mockSession: UserChatSessionData = {
      id: '1',
      type: 'user',
      user: null,
      room: 'test-room',
      chatId: 1,
      userId: 1,
      role: UserRole.CLIENT,
      tenantId: 'test-tenant',
    };

    const mockParentMessage = {
      content: 'Hello, I need help',
      chatId: 1,
      id: 123,
    };

    const mockChannel = 'test-channel';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle nudge and stage when both are provided', async () => {
      const mockNudgeResponse = {
        nudge: 'How are you feeling today?',
        stage: 'Assessment',
      };

      jest
        .spyOn(service, 'persistAndBroadcastMessage')
        .mockResolvedValue(mockMessage);

      await service.handleNudge(
        mockNudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
      );

      expect(service.persistAndBroadcastMessage).toHaveBeenCalledTimes(2);

      // Check nudge message
      expect(service.persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        {
          chatId: mockParentMessage.chatId,
          content: 'How are you feeling today?',
          messageType: MessageType.NUDGE,
          parentMessageId: mockParentMessage.id,
        },
        {
          event: ChatEvents.NUDGE,
        },
        mockChannel,
      );

      // Check stage message
      expect(service.persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        {
          chatId: mockParentMessage.chatId,
          content: 'Assessment',
          messageType: MessageType.STAGE,
          parentMessageId: mockParentMessage.id,
        },
        {
          event: ChatEvents.STAGE,
        },
        mockChannel,
      );
    });
  });

  describe('addFeedbackToChat', () => {
    const mockSummaryFeedbackDto = {
      rating: 5,
      feedback: {
        comment: 'Great session!',
        issues: ['none'],
      },
    };

    const mockCallDetails = {
      id: 1,
      chatId: 1,
      callInfo: {
        provider: AudioChatProvider.WEBRTC,
        platform: AudioChatPlatform.WEB,
      },
      tenantId: 'test-tenant',
    };

    const mockFeedback = {
      id: 1,
      chatId: 1,
      rating: 5,
      feedback: 'Great session!',
      tenantId: 'test-tenant',
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should add feedback to chat successfully', async () => {
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(mockCallDetails),
          update: jest.fn().mockResolvedValue({}),
        }),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      jest
        .spyOn(summaryFeedbackRepository, 'createSummaryFeedback')
        .mockResolvedValue(mockFeedback as any);

      const result = await service.addFeedbackToChat(1, mockSummaryFeedbackDto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(CallDetails);
      expect(
        summaryFeedbackRepository.createSummaryFeedback,
      ).toHaveBeenCalledWith(
        1,
        5,
        {
          comment: 'Great session!',
          issues: ['none'],
        },
        mockEntityManager,
      );
      expect(result).toEqual({
        message: 'Feedback added successfully',
        feedback: mockFeedback,
      });
    });

    it('should throw NotFoundException when call details not found', async () => {
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
        }),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation(async (callback: any) => {
          return callback(mockEntityManager);
        });

      await expect(
        service.addFeedbackToChat(1, mockSummaryFeedbackDto),
      ).rejects.toThrow('Call details not found for chat 1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(CallDetails);
      expect(
        summaryFeedbackRepository.createSummaryFeedback,
      ).not.toHaveBeenCalled();
    });
  });
});
