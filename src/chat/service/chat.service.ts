import {
  forwardRef,
  HttpException,
  Injectable,
  Inject,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Message, MessageType } from '../../common/entities/message.entity';
import { Chat, ChatStatus } from '../../common/entities/chat.entity';
import { LoggerService } from '../../logger/logger.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { ChatRoom } from '../../common/entities/chat-room.entity';
import { CryptoService } from '../../common/service/crypto.service';
import { QueueService } from '../../queue/service/queue.service';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { AiService } from '../../ai/service/ai.service';
import {
  AudioChatPlatform,
  AudioChatProvider,
  QueueStatus,
} from '../../common/constants/chat.constants';
import { CallDetails } from '../../common/entities/call.details.entity';
import { Feedback } from '../../common/entities/feedback.entity';
import { User } from '../../common/entities/user.entity';
import { Pagination } from '../../common/type/common.type';
import { UserService } from '../../user/user.service';
import { ChatEvents } from '../constants/chat.constants';
import { ChatGateway } from '../gateway/chat.gateway';
import {
  DeepgramTranscriptMetadata,
  MessageWithFeedback,
  NudgeResponse,
  SendMessageWebSocketData,
  UpdateChatInput,
  UserChatSessionData,
} from '../type/chat.type';

import { RedisService } from '../../redis/service/redis.service';

import { NotFoundException } from '@nestjs/common';
import { MessageBrokerChannel } from 'src/common/constants/message-broker.constants';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { TokenUser } from '../../auth/type/auth.types';
import { TIME } from '../../common/constants/time.constants';
import {
  ANONYMOUS_CLIENT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { CommonUtil } from '../../common/util/common.util';
import { CallInfoDto, DeleteChatResponseDto } from '../dto/chat.response.dto';
import {
  CallInfo,
  SummaryFeedbackResponse,
} from '../dto/call-log.response.dto';
import { StringUtil } from '../../common/util/string.util';
import { ForbiddenException } from '../../exception/custom.exception';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { SettingsService } from '../../settings/service/settings.service';
import {
  CallLogFilters,
  CallLogSortBy,
  SortOrder,
} from '../dto/call-log.request.dto';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { ChatRepository } from '../repository/chat.repository';
import { AppConfigService } from 'src/config/config.service';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { SummaryFeedbackDto } from '../dto/summary-feedback.dto';
import { SummaryFeedbackRepository } from '../repository/summary-feedback.repository';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { MessageRepository } from '../repository/message.repository';
import { ChatUtil } from '../util/chat.util';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/auth/service/permission-validator.service';
import { GroupService } from 'src/authorization/service/group.service';

@Injectable()
export class ChatService {
  logger = LoggerService.getInstance(ChatService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();
  constructor(
    private messageRepository: MessageRepository,
    private chatRepository: ChatRepository,

    @InjectRepository(ChatRoom)
    private chatRoomRepository: Repository<ChatRoom>,
    private callDetailsRepository: CallDetailsRepository,
    private summaryFeedbackRepository: SummaryFeedbackRepository,
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService,
    private gateway: ChatGateway,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
    private cryptoService: CryptoService,
    private readonly cache: RedisService,
    private readonly publisher: MessageBrokerService,
    private dataSource: DataSource,
    private settingsService: SettingsService,
    private broadcastMessageService: BroadcastMessageService,
    private streamFileProcessorService: StreamFileProcessorService,
    private readonly config: AppConfigService,
    private chatAudioUploadsService: ChatAudioUploadsService,
    private permissionValidator: PermissionValidator,
    private groupService: GroupService,
  ) {}

  async getChat(id: number) {
    const chatQuery = this.chatRepository
      .createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .where('chat.id = :id', { id })
      .andWhere('chat.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      });
    const chat = (await chatQuery.getOne()) as Chat & { details: CallDetails };
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    const decryptedCallDetails = await this.decryptCallDetails(chat.details);
    chat.details = decryptedCallDetails ?? ({} as CallDetails);
    return chat;
  }

  async requestChat(userId: number) {
    this.logger.debug(`requestChat - userId:${userId}`);
    return this.dataSource.transaction(async (entityManager) => {
      const repo = entityManager.getRepository(Chat) || this.chatRepository;
      const activeChats = await repo.findOne({
        where: {
          clientId: userId,
          status: In([ChatStatus.ACTIVE, ChatStatus.PAUSED]),
          tenantId: ExecutionManager.getTenantId(),
        },
      });

      if (activeChats) {
        this.logger.debug(`requestChat - activeChats:${activeChats.id}`);
        throw new HttpException(
          'You already have an active or waiting chat session',
          400,
        );
      }

      const chatRoom = await this.getOrCreateChatRoom(userId, entityManager);

      const chat = await this.createChat(userId, chatRoom.id, entityManager);

      return this.queueService.enqueue(
        {
          userId,
          chatId: chat.id,
          priority: 1,
        },
        entityManager,
      );
    });
  }

  async addNewChatWithCounselor(counselorId: number, clientId: number) {
    return this.dataSource.transaction(async (entityManager) => {
      const chatRepo = entityManager.getRepository(Chat) || this.chatRepository;
      const chatRoomRepo =
        entityManager.getRepository(ChatRoom) || this.chatRoomRepository;
      const activeChats = await chatRepo.findOne({
        where: {
          clientId,
          counselorId,
          status: In([ChatStatus.ACTIVE, ChatStatus.PAUSED]),
          tenantId: ExecutionManager.getTenantId(),
        },
      });

      if (activeChats) {
        this.logger.debug(`requestChat - activeChats:${activeChats.id}`);
        throw new HttpException(
          'You already have an active or waiting chat session',
          400,
        );
      }

      const newChatRoom = chatRoomRepo.create({
        clientId,
        counselorId,
        tenantId: ExecutionManager.getTenantId(),
      });

      await chatRoomRepo.save(newChatRoom);

      const newChat = chatRepo.create({
        clientId,
        counselorId,
        roomId: newChatRoom.id,
        tenantId: ExecutionManager.getTenantId(),
      });

      return chatRepo.save(newChat);
    });
  }

  async createChat(
    userId: number,
    roomId: number,
    entityManager?: EntityManager,
  ) {
    const repo = entityManager?.getRepository(Chat) || this.chatRepository;
    const callDetailsRepo =
      entityManager?.getRepository(CallDetails) || this.callDetailsRepository;
    const chatObject = repo.create({
      clientId: userId,
      roomId: roomId,
      status: ChatStatus.PAUSED,
      tenantId: ExecutionManager.getTenantId(),
    });
    const chat = await repo.save(chatObject);
    await callDetailsRepo.save({
      chatId: chat.id,
      tenantId: ExecutionManager.getTenantId(),
      callInfo: {
        provider: AudioChatProvider.WEBRTC,
      },
    });
    return chat;
  }

  async createChatWithClientAndCounselor(
    params: {
      clientId: number;
      counselorId?: number;
      tenantId?: string;
      provider?: AudioChatProvider;
      platform?: AudioChatPlatform;
      externalId?: string;
      status?: ChatStatus;
      startedAt?: Date;
      endedAt?: Date;
      duration?: number;
    },
    entityManager?: EntityManager,
  ) {
    const {
      clientId,
      counselorId,
      tenantId,
      provider,
      platform,
      externalId,
      status,
      startedAt,
      endedAt,
      duration,
    } = params;
    const chatRepo = entityManager?.getRepository(Chat) || this.chatRepository;
    const chatRoomRepo =
      entityManager?.getRepository(ChatRoom) || this.chatRoomRepository;
    const callDetailsRepo =
      entityManager?.getRepository(CallDetails) || this.callDetailsRepository;

    const newChatRoom = chatRoomRepo.create({
      clientId,
      counselorId,
      tenantId: tenantId || ExecutionManager.getTenantId(),
    });

    await chatRoomRepo.save(newChatRoom);

    const createdBy = ExecutionManager.getUserId();

    const chat = chatRepo.create({
      clientId,
      counselorId,
      roomId: newChatRoom.id,
      status: status || ChatStatus.ACTIVE,
      startedAt: startedAt || new Date(),
      ...(endedAt ? { endedAt } : {}),
      externalId,
      tenantId: tenantId || ExecutionManager.getTenantId(),
      ...(createdBy ? { createdBy: +createdBy } : {}),
    });

    await chatRepo.save(chat);

    const callDetails = callDetailsRepo.create({
      chatId: chat.id,
      tenantId: tenantId || ExecutionManager.getTenantId(),
      startTime: new Date(),
      callDuration: duration,
      callInfo: {
        provider,
        platform,
        summaryName: ChatUtil.getSummaryName(chat),
      },
    });

    await callDetailsRepo.save(callDetails);

    return chat;
  }

  async createChatForAnonymousClient(
    params: {
      counselorId: number;
      provider?: AudioChatProvider;
      platform?: AudioChatPlatform;
      externalId?: string;
      status?: ChatStatus;
      startedAt?: Date;
      endedAt?: Date;
      duration?: number;
    },
    entityManager?: EntityManager,
  ): Promise<Chat | null> {
    const clientId = ANONYMOUS_CLIENT_ID;

    const chat = await this.createChatWithClientAndCounselor(
      {
        clientId,
        ...params,
      },
      entityManager,
    );

    return chat;
  }

  async getOrCreateChatRoom(userId: number, entityManager?: EntityManager) {
    const repo =
      entityManager?.getRepository(ChatRoom) || this.chatRoomRepository;
    const chatRoom = await repo.findOne({
      where: {
        clientId: userId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (chatRoom) {
      return chatRoom;
    }

    const newChatRoom = repo.create({
      clientId: userId,
      tenantId: ExecutionManager.getTenantId(),
    });

    return repo.save(newChatRoom);
  }

  async getChatsByUserIds(
    userIds: number[],
    options?: {
      status?: ChatStatus[];
      sort?: 'asc' | 'desc';
      orderBy?: 'createdAt' | 'updatedAt';
    },
  ) {
    return this.chatRepository.find({
      where: {
        clientId: In(userIds),
        ...(options?.status ? { status: In(options.status) } : {}),
        tenantId: ExecutionManager.getTenantId(),
      },
      order: {
        [options?.orderBy || 'createdAt']: options?.sort || 'desc',
      },
    });
  }
  async getChatById(chatId: number) {
    const cachedChat = await this.cache.get(`chat:${chatId}`);
    if (cachedChat) {
      return JSON.parse(cachedChat) as Chat;
    }
    const chat = await this.chatRepository.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    if (chat) {
      await this.cache.set(`chat:${chatId}`, JSON.stringify(chat));
    }
    return chat;
  }

  // Used only for service level integration
  async getChatByIdForServiceCall(chatId: number) {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId },
    });
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    return chat;
  }

  async getChatsByCouncilorId(
    counselorId: number,
    options?: { status?: ChatStatus },
    entityManager?: EntityManager,
  ) {
    const repo = entityManager?.getRepository(Chat) || this.chatRepository;
    return repo.findOne({
      where: {
        counselorId: counselorId,
        ...options,
        tenantId: ExecutionManager.getTenantId(),
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async addCouncilorToChat(
    counselorId: number,
    chatId: number,
    entityManager?: EntityManager,
  ) {
    const repo = entityManager?.getRepository(Chat) || this.chatRepository;
    const callDetailsRepo =
      entityManager?.getRepository(CallDetails) || this.callDetailsRepository;
    const chat = await repo.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    if (chat.counselorId) {
      throw new HttpException('Chat already has a counselor', 400);
    }
    const startTime = new Date();
    chat.counselorId = counselorId;
    chat.status = ChatStatus.ACTIVE;
    chat.startedAt = startTime;
    const updatedChat = await repo.save(chat);
    await callDetailsRepo.update(
      { chatId: chatId, tenantId: ExecutionManager.getTenantId() },
      { startTime: startTime },
    );
    return updatedChat;
  }

  async getParticipantRoles(participants: User[]) {
    const userIds = participants?.map((participant) => participant.id) ?? [];

    // Process all user role lookups in parallel
    const userRolesPromises = userIds.map((userId) =>
      this.groupService.getUserRolesByUserId(userId),
    );
    const userRolesResults = await Promise.all(userRolesPromises);

    // Create userId to roles mapping
    const userIdRoleMapping: { [userId: number]: string[] } = {};
    userIds.forEach((userId, index) => {
      userIdRoleMapping[userId] = userRolesResults[index].map(
        (userRole) => userRole.name,
      );
    });

    return userIdRoleMapping;
  }

  async startCall(participantPhoneNumbers: string[]) {
    if (!participantPhoneNumbers || participantPhoneNumbers?.length < 2) {
      throw new HttpException('Need at least 2 participants', 400);
    }
    const participants = await this.userService.getUsersByPhoneNumbers(
      participantPhoneNumbers,
    );

    if (!participants || participants.length < 2) {
      throw new HttpException('Not enough valid participants found', 404);
    }

    const participantRoles = await this.getParticipantRoles(participants);

    const counselor = participants?.find((participant) =>
      participantRoles[participant.id].includes(UserRole.COUNSELOR),
    );

    if (!counselor) {
      throw new HttpException(`Counselor not found`, 404);
    }

    let client = participants?.find((participant) =>
      participantRoles[participant.id].includes(UserRole.CLIENT),
    );

    if (!client) {
      // Try to find a phone number that's not the counselor's
      const clientPhoneNumber = participantPhoneNumbers?.find(
        (phn) => phn !== counselor.phone,
      );
      if (!clientPhoneNumber) {
        throw new HttpException('Client phone number not found', 404);
      }
      client = await this.userService.createUser({
        phoneNumber: clientPhoneNumber,
        role: UserRole.CLIENT,
      });
    }
    // TODO: check if we could reuse requestChat method
    const chat = await this.addNewChatWithCounselor(counselor.id, client.id);
    const chatResponse = await this.getChatResponse(chat);
    const payload = {
      type: ChatEvents.CALL_STARTED,
      payload: chatResponse,
    };
    this.gateway.sendMessagesToRoomUsingPublish(
      ChatEvents.CALL_STARTED,
      [counselor.id, client.id],
      payload,
    );
    return chat;
  }

  async accept(councilorId: number, chatId: number) {
    return this.dataSource.transaction(async (entityManager) => {
      const activeChats = await this.getChatsByCouncilorId(
        councilorId,
        {
          status: ChatStatus.ACTIVE,
        },
        entityManager,
      );
      if (activeChats) {
        throw new HttpException('You already have an active chat session', 400);
      }

      const chat = await this.addCouncilorToChat(
        councilorId,
        chatId,
        entityManager,
      );
      const queueEntry = await this.queueService.getQueueByChatId(
        chatId,
        entityManager,
      );

      if (!queueEntry) {
        throw new HttpException('Chat not found in queue', 404);
      }
      await this.queueService.updateQueueStatus(
        queueEntry.entryId,
        QueueStatus.MATCHED,
        entityManager,
      );
      const room = `user-${chat.clientId}`;
      const chatResponse = await this.getChatResponse(chat, entityManager);
      const payload = {
        type: ChatEvents.CHAT_ACCEPTED,
        payload: chatResponse,
      };
      this.gateway.sendMessagesToRoom(room, payload);
    });
  }

  async handleDeepgramTranscript(
    session: UserChatSessionData,
    chatId: number,
    transcript: string,
    metadata?: DeepgramTranscriptMetadata,
  ) {
    return this.gateway.handleDeepgramTranscript(
      session,
      chatId,
      transcript,
      metadata,
    );
  }

  async getMessageByChatId(
    chatId: number,
    filter?: {
      type?: MessageType;
      limit?: number;
      offset?: number;
      sortBy?: string;
      order?: 'ASC' | 'DESC';
    },
    entityManager?: EntityManager,
  ) {
    const repo =
      entityManager?.getRepository(Message) || this.messageRepository;
    const query = repo
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId })
      .leftJoinAndMapOne(
        'message.feedback',
        Feedback,
        'feedback',
        'feedback.messageId = message.id',
      );

    query.orderBy(
      `message.${filter?.sortBy || 'createdAt'}`,
      filter?.order || 'DESC',
    );

    if (filter?.type) {
      query.andWhere('message.type = :type', { type: filter.type });
    }
    if (filter?.limit) {
      query.limit(filter.limit);
    }
    if (filter?.offset) {
      query.offset(filter.offset);
    }
    query.andWhere('message.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });
    const [messages, count] = await query.getManyAndCount();
    const decryptedMessages = await this.decryptMessages(messages);
    return {
      messages: decryptedMessages,
      count,
    };
  }

  formatMessage(message: MessageWithFeedback) {
    return {
      messageId: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      messageType: message.type,
      content: message.content,
      context: message.context,
      createdAt: message.createdAt.toISOString(),
      feedback: message.feedback,
      startSeconds: message.startSeconds,
      endSeconds: message.endSeconds,
    };
  }

  async saveMessage(
    chatId: number,
    senderId: number,
    data: {
      content: string;
      context?: string;
      messageType?: MessageType;
      createdAt?: Date;
      startSeconds?: number;
      endSeconds?: number;
      parentMessageId?: number;
    },
  ) {
    const encryptedContent = await this.cryptoService.encrypt(
      data.content,
      this.config.phiData?.phiDataEncryptionKey,
    );
    const message = this.messageRepository.create({
      chatId,
      senderId,
      content: encryptedContent,
      context: data.context,
      type: data.messageType || MessageType.TEXT,
      tenantId: ExecutionManager.getTenantId(),
      parentMessageId: data.parentMessageId,
      createdAt: data.createdAt,
      startSeconds: data.startSeconds,
      endSeconds: data.endSeconds,
    });
    return this.messageRepository.save(message);
  }

  async save(message: Message) {
    return this.messageRepository.save(message);
  }

  async getMessageObject(
    chatId: number,
    senderId: number,
    data: { content: string; context?: string; messageType?: MessageType },
  ) {
    const encryptedContent = await this.cryptoService.encrypt(
      data.content,
      this.config.phiData?.phiDataEncryptionKey,
    );
    return this.messageRepository.create({
      chatId,
      senderId,
      content: encryptedContent,
      context: data.context,
      type: data.messageType || MessageType.TEXT,
      tenantId: ExecutionManager.getTenantId(),
    });
  }

  async getCounselorChat(id: number) {
    const latestChat = await this.getChatsByCouncilorId(id, {
      status: ChatStatus.ACTIVE,
    });
    if (!latestChat) {
      return [];
    }
    const chatResponse = await this.getChatResponse(latestChat);
    const callDetails = await this.callDetailsRepository.findOne({
      where: {
        chatId: latestChat.id,
      },
    });
    return {
      ...chatResponse,
      provider: callDetails?.callInfo?.provider,
      platform: callDetails?.callInfo?.platform,
    };
  }

  async getChatResponse(chat: Chat, entityManager?: EntityManager) {
    const client = await this.userService.get(chat.clientId);
    const counselor = chat.counselorId
      ? await this.userService.get(chat.counselorId)
      : null;
    const { messages } = await this.getMessageByChatId(
      chat.id,
      undefined,
      entityManager,
    );
    const payload = {
      counselor: this.userService.getMinimalUserInfo(counselor),
      client: this.userService.getMinimalUserInfo(client),
      messages: messages, //messages.map(this.formatMessage),
      chatId: chat.id,
      clientId: chat.clientId,
      counselorId: chat.counselorId,
      status: chat.status,
      startedAt: chat.startedAt,
      endedAt: chat.endedAt,
    };
    return payload;
  }

  async isChatEnded(chatId: number) {
    const chat = await this.getChatById(chatId);
    return chat?.status === ChatStatus.ENDED;
  }

  async endChat(chatId: number, endedAt?: Date) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    if (chat.status !== ChatStatus.ACTIVE) {
      throw new HttpException('Chat is not active', 400);
    }

    await this.chatRepository.update(chatId, {
      status: ChatStatus.ENDED,
      endedAt: endedAt || new Date(),
    });
    this.cache.del(`chat:${chatId}`);
    const updatedChat = await this.getChatById(chatId);
    if (updatedChat) {
      this.eventEmitter.emit(ChatEvents.CHAT_ENDED, updatedChat);
      this.logger.debug(`chat ended event emitted - chat:${chatId}`);
    }

    return updatedChat;
  }

  async getMyChats(id: number) {
    const chats = await this.getChatsByUserIds([id], {
      status: [ChatStatus.ACTIVE, ChatStatus.PAUSED],
    });

    if (!chats?.length) {
      return [];
    }
    const chatResponse = await this.getChatResponse(chats[0]);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chats[0].id, tenantId: ExecutionManager.getTenantId() },
    });
    return {
      ...chatResponse,
      provider: callDetails?.callInfo?.provider,
      platform: callDetails?.callInfo?.platform,
    };
  }

  async getMessages(
    chatId: number,
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'ASC' | 'DESC';
    },
  ) {
    const {
      limit = 10,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = options;

    const chat = await this.chatRepository.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    // Check if user has permission to view messages or is the participant of this chat
    const canViewMessages = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.VIEW_MESSAGE],
    );
    // Does client has permission to view messages?

    if (
      !canViewMessages &&
      chat.clientId !== userId &&
      chat.counselorId !== userId
    ) {
      throw new HttpException(
        'You are not authorized to access this chat',
        403,
      );
    }

    const { messages, count } = await this.getMessageByChatId(chatId, {
      limit,
      offset,
      sortBy,
      order: sortOrder,
      type: MessageType.TEXT,
    });

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.ACCESS_TRANSCRIPT,
      details: {
        chatId: chatId.toString(),
      },
    });

    return {
      data: messages.map((message) => this.formatMessage(message)),
      count,
    };
  }

  async handleChatEnded(chat: Chat) {
    this.logger.debug(`handleChatEnded - chatId: ${chat.id}`);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chat.id, tenantId: ExecutionManager.getTenantId() },
    });
    const provider = callDetails?.callInfo?.provider;

    const channel = findMessageBrokerChannelUsingProvider(provider!);
    let participants;

    this.logger.debug(
      `handleChatEnded - chatId: ${chat.id} | provider: ${provider}`,
    );

    if (provider === AudioChatProvider.WEBRTC) {
      participants = [chat.counselorId!, chat.clientId];
      await Promise.allSettled([
        this.updateSummaryAndTags(chat),
        this.updateMessageStatistics(chat, callDetails),
      ]);
    } else if (
      provider === AudioChatProvider.MICROPHONE ||
      provider === AudioChatProvider.EXOTEL_CONFERENCE_CALL
    ) {
      participants = [chat.counselorId!];
      await this.streamFileProcessorService.endCallStream({
        chatId: chat.id,
        provider,
      });
    } else if (provider === AudioChatProvider.OZONETEL) {
      participants = [chat.counselorId!];
    }
    if (channel && participants) {
      this.broadcastMessageService.broadcastChatEndedEvent(channel, {
        participants,
        chatId: chat.id,
      });
    }
  }

  async updateSummaryAndTags(chat: Chat) {
    const summary: any = (await this.generateSummary(chat.id)) || {};

    if (summary && summary.sessionSummary) {
      summary.sessionSummary = await this.cryptoService.encrypt(
        summary.sessionSummary,
        this.config.phiData?.phiDataEncryptionKey,
      );
    }

    await this.callDetailsRepository.update(
      { chatId: chat.id },
      {
        summary,
      },
    );
  }

  async updateCallMetadata(chatId: number, duration?: number) {
    this.logger.debug(`updateCallDetails:Start - chatId:${chatId}`);
    try {
      const chat = await this.getChatById(chatId);
      if (!chat) {
        this.logger.error(
          `updateCallMetadata - chatId:${chatId} - chat not found`,
        );
        return;
      }

      const callDetails = await this.callDetailsRepository.findOne({
        where: { chatId, tenantId: ExecutionManager.getTenantId() },
      });

      let callDurationInSeconds;
      const endDate = chat.endedAt || new Date();

      if (duration) {
        callDurationInSeconds = duration;
      } else {
        const startDate = chat.startedAt || new Date();

        callDurationInSeconds = ChatUtil.getCallDurationInSeconds(
          startDate,
          endDate,
        );
      }

      if (callDetails) {
        const updates = {
          endTime: endDate,
          callDuration: callDurationInSeconds,
        };
        await this.callDetailsRepository.update({ chatId }, updates);
      }
    } catch (err) {
      this.logger.error(`updateCallMetadata - chatId:${chatId} - error:${err}`);
    }
  }

  async updateMessageStatistics(chat: Chat, callDetails?: CallDetails | null) {
    this.logger.debug(
      `updateMessageStatistics:Start - chatId:${chat.id} | startedAt:${chat.startedAt} | endedAt:${chat.endedAt}`,
    );
    try {
      const chatId = chat.id;
      const { messages } = await this.getMessageByChatId(chatId, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
      const startDate = chat.startedAt || new Date();
      const endDate = chat.endedAt || new Date();

      const callDurationInSeconds = ChatUtil.getCallDurationInSeconds(
        startDate,
        endDate,
      );

      // get word count by language
      const wordCountByLanguage = await this.getWordCountByLanguage(chat.id);

      let noOfNudges = 0;
      let noOfStages = 0;
      let clientWordCount = 0;
      let counselorWordCount = 0;
      //format transcript also get the client talking percentage
      let transcript = '';
      let currentStage = '';

      messages.forEach((message) => {
        if (message.type === MessageType.NUDGE) {
          noOfNudges++;
        }
        if (
          message.type === MessageType.STAGE &&
          currentStage !== message.content
        ) {
          noOfStages++;
          currentStage = message.content;
        }
        if (message.type !== MessageType.TEXT) {
          return;
        }
        if (message.senderId == chat.clientId) {
          clientWordCount += StringUtil.wordCount(message.content);
          transcript += `Client: ${message.content}\n`;
        } else {
          counselorWordCount += StringUtil.wordCount(message.content);
          transcript += `Counselor: ${message.content}\n`;
        }
      });
      const clientTalkingPercentage =
        clientWordCount > 0
          ? parseFloat(
              (
                clientWordCount /
                (clientWordCount + counselorWordCount)
              ).toFixed(3),
            )
          : 0;
      const counselorTalkingPercentage =
        counselorWordCount > 0
          ? parseFloat(
              (
                counselorWordCount /
                (clientWordCount + counselorWordCount)
              ).toFixed(3),
            )
          : 0;

      if (!callDetails) {
        callDetails = await this.callDetailsRepository.findOne({
          where: { chatId, tenantId: ExecutionManager.getTenantId() },
        });
      }

      const existingCallInfo = callDetails?.callInfo || {};

      const encryptedTranscript = await this.cryptoService.encrypt(
        transcript,
        this.config.phiData?.phiDataEncryptionKey,
      );

      const updates = {
        noOfNudges,
        noOfStages,
        transcript: encryptedTranscript,
        callInfo: {
          ...existingCallInfo,
          clientTalkingPercentage: clientTalkingPercentage,
          counselorTalkingPercentage: counselorTalkingPercentage,
          clientTalkingTime: clientTalkingPercentage * callDurationInSeconds,
          counselorTalkingTime:
            counselorTalkingPercentage * callDurationInSeconds,
          ...(!existingCallInfo.summaryName
            ? { summaryName: ChatUtil.getSummaryName(chat) }
            : {}),
          wordCountByLanguage,
          clientWordCount,
          counselorWordCount,
        } as CallInfo,
        endTime: endDate,
        callDuration: callDurationInSeconds,
      };
      this.logger.debug(
        `updateMessageStatistics:updates:${JSON.stringify(updates)}`,
      );
      const details = await this.callDetailsRepository.update(
        { chatId },
        updates,
      );
      // delete the word count from cache
      await this.deleteWordCountByLanguage(chat.id);
      this.logger.debug(`updateMessageStatistics:End - chatId:${chat.id}`);
      return details;
    } catch (err) {
      this.logger.error(
        `updateMessageStatistics - chatId:${chat.id} - error:${err}`,
      );
    }
  }

  async generateSummary(
    chatId: number,
  ): Promise<FlattenedSummaryNotePayloadCamelCase | undefined> {
    this.logger.debug(`generateSummary - chatId:${chatId}`);
    const messageRequests: MessageRequest[] =
      await this.getChatHistoryForAIService(chatId, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    const convertedResponse = CommonUtil.convertToCamelCase(
      aiResponse,
    ) as FlattenedSummaryNotePayloadCamelCase;

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.SUMMARY_GENERATED,
      details: {
        chatId,
      },
    });

    return convertedResponse;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    if (aiResponse) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.SUMMARY_GENERATED_FROM_MESSAGES,
        details: {
          messageRequests,
        },
      });
      return aiResponse;
    }
    return;
  }

  async getChatHistoryForAIService(chatId: number, pagination?: Pagination) {
    const query = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndMapOne(
        'message.sender',
        User,
        'sender',
        'sender.id = message.senderId',
      )
      .where('message.chatId = :chatId', { chatId })
      .andWhere('message.type = :type', { type: MessageType.TEXT })
      .orderBy('message.createdAt', 'DESC');

    if (pagination) {
      query.offset(pagination.offset).limit(pagination.limit);
    }

    if (pagination?.sortBy) {
      query.orderBy(
        `message.${pagination.sortBy}`,
        pagination.order as 'ASC' | 'DESC',
      );
    }
    query.andWhere('message.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });

    const messages = await query.getMany();

    const decryptedMessages = await this.decryptMessages(messages);

    const messageRequests: MessageRequest[] = decryptedMessages.map(
      (message: any) => ({
        role:
          message.senderId === ANONYMOUS_CLIENT_ID
            ? 'CLIENT'
            : message.sender?.role,
        content: message.content,
        start_time: message.startSeconds,
        end_time: message.endSeconds,
      }),
    );
    return messageRequests;
  }

  async getCallLogs(user: TokenUser, options: Pagination) {
    const query = this.chatRepository
      .createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .leftJoinAndMapOne(
        'chat.client',
        User,
        'client',
        'client.id = chat.clientId',
      );
    if (user.role === UserRole.COUNSELOR) {
      query.where('chat.counselorId = :counselorId', { counselorId: user.id });
    }
    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }
    if (options.sortBy) {
      query.orderBy(
        `details.${options.sortBy}`,
        options.order as 'ASC' | 'DESC',
      );
    }
    query.andWhere('chat.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });
    const [callLogs, count] = await query.getManyAndCount();

    const decryptedCallLogs = await Promise.all(
      callLogs.map(async (callLog: any) => ({
        ...callLog,
        details:
          (await this.decryptCallDetails(callLog.details)) ??
          ({} as CallDetails),
      })),
    );
    return {
      data: decryptedCallLogs,
      count,
    };
  }
  async getAdminCallLogs(filters: CallLogFilters) {
    const query = this.chatRepository
      .createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .leftJoinAndMapOne(
        'chat.client',
        User,
        'client',
        'client.id = chat.clientId',
      )
      .leftJoinAndMapOne(
        'chat.counselor',
        User,
        'counselor',
        'counselor.id = chat.counselorId',
      );

    // Only show ENDED calls for admin call logs
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });

    this.applyStringFilters(query, filters);
    this.applyIdFilters(query, filters);
    this.applyDateFilters(query, filters);
    this.applyDurationFilters(query, filters);
    this.applyQualityFilters(query, filters);
    this.applyTagFilters(query, filters);

    query.andWhere('chat.tenant_id = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });

    if (filters.limit) query.limit(filters.limit);
    if (filters.offset) query.offset(filters.offset);

    this.applySorting(
      query,
      (filters.sortBy as CallLogSortBy) || CallLogSortBy.START_DATE,
      (filters.order as SortOrder) || SortOrder.DESC,
    );

    const [callLogs, count] = await query.getManyAndCount();
    const decryptedCallLogs = await Promise.all(
      callLogs.map(async (callLog: any) => ({
        ...callLog,
        details:
          (await this.decryptCallDetails(callLog.details)) ??
          ({} as CallDetails),
      })),
    );
    return { data: decryptedCallLogs, count };
  }

  private applyStringFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.counselorName) {
      query.andWhere('counselor.name ILIKE :counselorName', {
        counselorName: `%${filters.counselorName}%`,
      });
    }
  }

  private applyIdFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.counselorIds) {
      const ids = filters.counselorIds
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));

      if (ids.length > 0) {
        query.andWhere('chat.counselorId IN (:...counselorIds)', {
          counselorIds: ids,
        });
      }
    }
  }

  private applyDateFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.startDate) {
      query.andWhere('chat.startedAt >= :startDate', {
        startDate: new Date(filters.startDate),
      });
    }
    if (filters.endDate) {
      query.andWhere('chat.startedAt <= :endDate', {
        endDate: new Date(filters.endDate),
      });
    }
  }

  private applyDurationFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.minDuration !== undefined) {
      query.andWhere('details.callDuration >= :minDuration', {
        minDuration: filters.minDuration,
      });
    }
    if (filters.maxDuration !== undefined) {
      query.andWhere('details.callDuration <= :maxDuration', {
        maxDuration: filters.maxDuration,
      });
    }
  }

  private applyQualityFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.minQualityScore !== undefined) {
      query.andWhere(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        {
          minQualityScore: filters.minQualityScore,
        },
      );
    }
    if (filters.maxQualityScore !== undefined) {
      query.andWhere(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
        {
          maxQualityScore: filters.maxQualityScore,
        },
      );
    }
  }

  private applyTagFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    query.andWhere(
      "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
    );

    if (filters.tags) {
      const tags = filters.tags.split(',').map((tag) => tag.trim());
      query.andWhere(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags },
      );
    }
  }

  private applySorting(
    query: any,
    sortBy: CallLogSortBy,
    order: SortOrder = SortOrder.DESC,
  ) {
    const sortOrder = order as 'ASC' | 'DESC';

    switch (sortBy) {
      case CallLogSortBy.ID:
        query.orderBy('chat.id', sortOrder);
        break;
      case CallLogSortBy.COUNSELOR_NAME:
        query.orderBy('counselor.name', sortOrder);
        break;
      case CallLogSortBy.CLIENT_ID:
        query.orderBy('chat.clientId', sortOrder);
        break;
      case CallLogSortBy.CALL_DURATION:
        query.orderBy('details.callDuration', sortOrder);
        break;
      case CallLogSortBy.START_DATE:
        query.orderBy('chat.startedAt', sortOrder);
        break;
      case CallLogSortBy.QUALITY_SCORE:
        query.orderBy(
          "CAST(details.summary->>'callQuality' AS NUMERIC)",
          sortOrder,
        );
        break;
      case CallLogSortBy.TAGS:
        query.orderBy("details.summary->'tags'->0->>'tag'", sortOrder);
        break;
      case CallLogSortBy.CREATED_AT:
      default:
        query.orderBy('chat.createdAt', sortOrder);
        break;
    }
  }
  async enhance(summary: string) {
    return this.aiService.enhance(summary);
  }

  async updateCallDetails(
    chatId: number,
    summary: FlattenedSummaryNotePayloadCamelCase,
  ) {
    if (summary.sessionSummary) {
      summary.sessionSummary = await this.cryptoService.encrypt(
        summary.sessionSummary,
        this.config.phiData?.phiDataEncryptionKey,
      );
    }

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { summary },
    );
    return this.getChat(chatId);
  }

  async updateCallInfo(chatId: number, body: CallInfoDto) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }

    const currentUserId = ExecutionManager.getUserId();
    if (!currentUserId) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check if user has admin permissions to update any call info
    const canAccessOthersCallInfo =
      await this.permissionValidator.validatePermissions(
        parseInt(currentUserId),
        [PERMISSIONS.ORGANIZATION_ACCESS],
      );

    // If not admin, check if user is the counselor assigned to this chat
    if (
      !canAccessOthersCallInfo &&
      chat.counselorId != parseInt(currentUserId)
    ) {
      throw new ForbiddenException(
        'You are not authorized to update call info for this chat',
      );
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }
    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: { ...callDetails.callInfo, summaryName: body.summaryName } },
    );
    return this.getChat(chatId);
  }

  getNudge(newMessage: string, messageRequests: MessageRequest[]) {
    return this.aiService.getNudge(newMessage, messageRequests);
  }

  async tagPositivityRatings(tags: string[]) {
    const aiResponse = await this.aiService.generateTagPositivityRatings(tags);
    return aiResponse.tags;
  }

  async decryptCallDetails(
    callDetails: CallDetails | null,
  ): Promise<CallDetails | undefined> {
    if (!callDetails) return undefined;

    const decryptedCallDetails = { ...callDetails };

    try {
      if (decryptedCallDetails.transcript) {
        decryptedCallDetails.transcript = await this.cryptoService.decrypt(
          decryptedCallDetails.transcript,
          this.config.phiData?.phiDataEncryptionKey,
        );
      }

      if (decryptedCallDetails.summary?.sessionSummary) {
        const decryptedSummary = await this.cryptoService.decrypt(
          decryptedCallDetails.summary.sessionSummary,
          this.config.phiData?.phiDataEncryptionKey,
        );
        decryptedCallDetails.summary.sessionSummary = decryptedSummary;
      }

      return decryptedCallDetails;
    } catch (error) {
      this.logger.error(
        `Failed to decrypt call details: ${JSON.stringify(error)}`,
      );
      decryptedCallDetails.transcript = '';
      if (decryptedCallDetails.summary?.sessionSummary) {
        decryptedCallDetails.summary.sessionSummary = '';
      }
      return decryptedCallDetails;
    }
  }

  async getChatWithCallDetails(
    chatId: number,
  ): Promise<{ chat: Chat | null; callDetails: CallDetails | null }> {
    const chat = await this.getChatById(chatId);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    const decryptedCallDetails = await this.decryptCallDetails(callDetails);

    return { chat, callDetails: decryptedCallDetails ?? ({} as CallDetails) };
  }

  async pauseOrResumeChat(chatId: number, pause: boolean) {
    const callDetails = await this.callDetailsRepository.findOne({
      where: {
        chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }

    const updatedCallInfo = {
      ...callDetails.callInfo,
      pauseChat: pause,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );
    await this.cache.set(
      `chat-paused-${chatId}`,
      String(pause),
      TIME.DAY_IN_SECONDS,
    );
  }

  async isChatPaused(chatId: number) {
    const cachedValue = await this.cache.get(`chat-paused-${chatId}`);
    if (cachedValue) {
      return cachedValue === 'true';
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    const isPaused = callDetails?.callInfo?.pauseChat;
    if (isPaused !== undefined) {
      await this.cache.set(
        `chat-paused-${chatId}`,
        String(isPaused),
        TIME.DAY_IN_SECONDS,
      );
    }
    return isPaused;
  }

  async triggerNudge(
    newMessage: { content: string; chatId: number; id: number },
    session: UserChatSessionData,
    chatId: number,
    channel: string,
  ) {
    const isChatPaused = await this.isChatPaused(chatId);
    if (isChatPaused) {
      this.logger.debug(`Chat is paused for chatId ${chatId}`);
      return;
    }
    const isNudgeEnabled = await this.settingsService.getNudgeStatus();
    if (!isNudgeEnabled) {
      this.logger.debug(`Nudge is disabled for chatId ${chatId}`);
      return;
    }
    const messages = await this.getChatHistoryForAIService(chatId, {
      sortBy: 'createdAt',
      order: 'DESC',
      limit: 4,
    });

    const formattedNewMessage = `${session.role}: ${newMessage.content}`;

    this.aiService
      .getNudge(formattedNewMessage, messages)
      .then((nudge) => {
        this.logger.debug(
          `Nudge:${newMessage.content} | chatId :${chatId} | ${nudge?.nudge} | stage: ${nudge?.stage}`,
        );
        if (nudge) {
          this.handleNudge(nudge, session, newMessage, channel);
        }
      })
      .catch((error) => {
        this.logger.error(
          `AI Nudge Error: ${error.message} | chatId : ${chatId} | userId : ${session.userId}`,
        );
      });
  }

  incrementWordCountByLanguage(
    chatId: number,
    language: string,
    count: number,
  ) {
    const key = this.getWordCountKey(chatId);
    return this.cache.hincrBy(key, language, count);
  }

  private async getWordCountByLanguage(chatId: number) {
    const key = this.getWordCountKey(chatId);
    const rawCounts = await this.cache.hgetAll(key);
    return Object.entries(rawCounts).reduce(
      (acc, [lang, count]) => {
        acc[lang] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private async deleteWordCountByLanguage(chatId: number) {
    const key = this.getWordCountKey(chatId);
    await this.cache.del(key);
  }

  private getWordCountKey(chatId: number) {
    return `call:${chatId}:word-count`;
  }

  async handleNudge(
    nudgeResponse: NudgeResponse,
    session: UserChatSessionData,
    parentMessage: { content: string; chatId: number; id: number },
    channel: string,
  ) {
    this.logger.debug(
      `handleNudge - nudge :${nudgeResponse.nudge} | stage :${nudgeResponse.stage}`,
    );
    const { nudge, stage } = nudgeResponse;
    if (nudge) {
      await this.persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: nudge,
          messageType: MessageType.NUDGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.NUDGE,
        },
        channel,
      );
    }
    if (stage) {
      await this.persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: stage,
          messageType: MessageType.STAGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.STAGE,
        },
        channel,
      );
    }
  }

  async persistAndBroadcastMessage(
    session: UserChatSessionData,
    data: SendMessageWebSocketData,
    broadCastOptions: {
      event?: ChatEvents;
    } = {
      event: ChatEvents.MESSAGE_RECEIVED,
    },
    channel: string = MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
  ) {
    const chatId = data.chatId;
    const senderId = session.userId;
    const message = await this.saveMessage(chatId, senderId, data);
    const chat = await this.getChatById(chatId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const participants = [chat?.counselorId!];
    if (
      broadCastOptions.event != ChatEvents.NUDGE &&
      broadCastOptions.event != ChatEvents.STAGE
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      participants.push(chat?.clientId!);
    }

    this.publisher.publish(channel, {
      participants,
      message,
      broadCastOptions,
    });
    return message;
  }

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    return this.userService.getCounselorNames(limit, offset, search);
  }

  async getAllTags(limit?: number, offset?: number, search?: string) {
    const query = this.callDetailsRepository
      .createQueryBuilder('details')
      .select(
        "DISTINCT jsonb_array_elements(details.summary->'tags')->>'tag'",
        'tag',
      )
      .where("details.summary->'tags' IS NOT NULL")
      .andWhere("jsonb_typeof(details.summary->'tags') = 'array'")
      .andWhere('details.tenant_id = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .orderBy('tag', 'ASC');

    if (search && search.trim()) {
      query.andWhere(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        {
          search: `%${search.trim()}%`,
        },
      );
    }

    if (limit) {
      query.limit(limit);
    }
    if (offset) {
      query.offset(offset);
    }

    const tags = await query.getRawMany();
    const count = await query.getCount();

    return {
      data: tags
        .map((item) => item.tag)
        .filter((tag) => tag && tag.trim() !== ''),
      count,
    };
  }

  async cancelCallByClient(userId: number, chatId: number) {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, tenantId: ExecutionManager.getTenantId() },
    });
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    if (chat.clientId !== userId) {
      throw new HttpException(
        'You are not authorized to cancel this call',
        403,
      );
    }

    if (chat.status === ChatStatus.ENDED) {
      throw new HttpException('Call is already ended', 400);
    }

    if (chat.status === ChatStatus.ACTIVE) {
      throw new HttpException(
        'Call is currently active and cannot be cancelled by client',
        400,
      );
    }

    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    if (!callDetails) {
      throw new HttpException('Call details not found', 404);
    }

    const currentTime = new Date();

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { startTime: currentTime, endTime: currentTime, callDuration: 0 },
    );

    await this.chatRepository.update(chatId, {
      status: ChatStatus.CANCELLED,
      startedAt: currentTime,
      endedAt: currentTime,
    });
    this.cache.del(`chat:${chatId}`);
    return { success: true };
  }

  async addNoteToSession(
    chatId: number,
    createNoteDto: AddNoteDto,
  ): Promise<AddNotesResponse> {
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });

    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }

    const existingCallInfo = callDetails.callInfo || {};
    const updatedCallInfo = {
      ...existingCallInfo,
      notes: createNoteDto.content,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );

    return { notes: createNoteDto.content };
  }

  async addFeedbackToChat(
    chatId: number,
    summaryFeedbackDto: SummaryFeedbackDto,
  ): Promise<SummaryFeedbackResponse> {
    return this.dataSource.transaction(async (entityManager) => {
      const callDetailsRepo =
        entityManager.getRepository(CallDetails) || this.callDetailsRepository;
      const summaryFeedbackRepo = this.summaryFeedbackRepository;
      const callDetails = await callDetailsRepo.findOne({
        where: { chatId, tenantId: ExecutionManager.getTenantId() },
      });
      if (!callDetails) {
        this.logger.error(`Call details not found for chat ${chatId}`);
        throw new NotFoundException(
          `Call details not found for chat ${chatId}`,
        );
      }
      const existingCallInfo = callDetails.callInfo || {};
      const updatedCallInfo = {
        ...existingCallInfo,
        isSummaryFeedbackAdded: true,
      };

      const feedback = await summaryFeedbackRepo.createSummaryFeedback(
        chatId,
        summaryFeedbackDto.rating,
        summaryFeedbackDto.feedback,
        entityManager,
      );

      await callDetailsRepo.update(
        { chatId, tenantId: ExecutionManager.getTenantId() },
        { callInfo: updatedCallInfo },
      );
      return { message: 'Feedback added successfully', feedback };
    });
  }

  async getChatByExternalId(externalId: string): Promise<Chat | null> {
    const chat = await this.chatRepository.findOne({
      where: { externalId, tenantId: ExecutionManager.getTenantId() },
    });
    return chat;
  }

  async updateChat(chatId: number, input: UpdateChatInput) {
    await this.chatRepository.updateChat(chatId, input);
  }

  private async decryptMessages(messages: Message[]) {
    return await Promise.all(
      messages.map(async (message) => {
        return {
          ...message,
          content: await this.cryptoService.decrypt(
            message.content,
            this.config.phiData?.phiDataEncryptionKey,
          ),
        };
      }),
    );
  }

  async deleteChat(chatId: number): Promise<DeleteChatResponseDto> {
    const { chat, callDetails } = await this.getChatWithCallDetails(chatId);
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    if (callDetails?.callInfo?.provider !== AudioChatProvider.AUDIO_UPLOAD) {
      throw new BadRequestException('Deletion is nor supported for this chat');
    }
    const tenantId = ExecutionManager.getTenantId()!;
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.messageRepository.deleteMessageByChatId(
          chatId,
          tenantId,
          manager,
        );
        await this.callDetailsRepository.deleteCallDetailsByChatId(
          chatId,
          tenantId,
          manager,
        );
        await this.summaryFeedbackRepository.deleteSummaryFeedbackByChatId(
          chatId,
          manager,
        );
        await this.chatAudioUploadsService.deleteUploadedAudioFile(chatId);
        await this.chatAudioUploadsService.deleteChatAudioUploadsByChatId(
          chatId,
          tenantId,
          manager,
        );
        await this.chatRepository.deleteChat(chatId, tenantId, manager);
      });
      await this.cache.del(`chat:${chatId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete chat ${chatId}: ${error}`);
      throw new HttpException(
        `Failed to delete chat ${chatId}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
