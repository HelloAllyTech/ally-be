import {
  forwardRef,
  HttpException,
  Injectable,
  Inject,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In } from 'typeorm';
import { Message, MessageType } from '../entity/message.entity';
import { Chat, ChatStatus } from '../entity/chat.entity';
import { LoggerService } from '../../logger/logger.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { QueueService } from '../../queue/service/queue.service';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import {
  AudioChatPlatform,
  AudioChatProvider,
  QueueStatus,
} from '../../common/constants/chat.constants';
import { CallDetails } from '../entity/call.details.entity';
import { User } from '../../user/entity/user.entity';
import { Pagination } from '../../common/type/common.type';
import { UserService } from '../../user/service/user.service';
import { ChatEvents } from '../constants/chat.constants';
import { ChatGateway } from '../gateway/chat.gateway';
import {
  DeepgramTranscriptMetadata,
  NudgeResponse,
  SendMessageWebSocketData,
  UpdateChatInput,
  UserChatSessionData,
} from '../type/chat.type';

import { RedisService } from '../../redis/service/redis.service';

import { NotFoundException } from '@nestjs/common';
import { MessageBrokerChannel } from 'src/message-broker/constants/message-broker.constants';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import { TokenUser } from '../../auth/type/auth.types';
import {
  ANONYMOUS_CLIENT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { FlattenedSummaryNotePayloadCamelCase } from '../type/call.details.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { CallInfoDto, DeleteChatResponseDto } from '../dto/chat.response.dto';
import { SummaryFeedbackResponse } from '../dto/call-log.response.dto';
import { ForbiddenException } from '../../exception/custom.exception';
import { CallLogFilters } from '../dto/call-log.request.dto';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { ChatRepository } from '../repository/chat.repository';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { SummaryFeedbackDto } from '../dto/summary-feedback.dto';
import { SummaryFeedbackRepository } from '../repository/summary-feedback.repository';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { MessageRepository } from '../repository/message.repository';
import { ChatUtil } from '../util/chat.util';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { GroupService } from 'src/authorization/service/group.service';
import { MessageService } from './message.service';
import { CallDetailsService } from './call-details.service';
import { CallLogService } from './call-log.service';
import { AiChatIntegrationService } from './ai-chat-integration.service';
import { ChatFeedbackService } from './chat-feedback.service';

@Injectable()
export class ChatService {
  logger = LoggerService.getInstance(ChatService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();
  constructor(
    private messageRepository: MessageRepository,
    private chatRepository: ChatRepository,
    private messageService: MessageService,
    private callDetailsService: CallDetailsService,
    private callLogService: CallLogService,
    private aiChatIntegrationService: AiChatIntegrationService,
    private chatFeedbackService: ChatFeedbackService,

    private callDetailsRepository: CallDetailsRepository,
    private summaryFeedbackRepository: SummaryFeedbackRepository,
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService,
    private gateway: ChatGateway,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
    private dataSource: DataSource,
    private chatAudioUploadsService: ChatAudioUploadsService,
    private permissionValidator: PermissionValidator,
    private groupService: GroupService,
  ) {}

  async getChat(id: number) {
    const chatData = await this.chatRepository.findOne({
      where: { id, tenantId: ExecutionManager.getTenantId() },
    });
    if (!chatData) {
      throw new NotFoundException(`Chat not found for chatId: ${id}`);
    }
    const userId = Number(ExecutionManager.getUserId());
    const hasAdminAccess = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.ORGANIZATION_ACCESS],
    );
    if (
      (!hasAdminAccess && chatData.counselorId !== userId) ||
      (hasAdminAccess && chatData.tenantId !== ExecutionManager.getTenantId())
    ) {
      throw new ForbiddenException('You are not allowed to access this chat');
    }
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

  // TODO: remove
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

      const chat = await this.createChat(userId, entityManager);

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

      const newChat = chatRepo.create({
        clientId,
        counselorId,
        tenantId: ExecutionManager.getTenantId(),
      });

      return chatRepo.save(newChat);
    });
  }

  async createChat(userId: number, entityManager?: EntityManager) {
    const repo = entityManager?.getRepository(Chat) || this.chatRepository;
    const callDetailsRepo =
      entityManager?.getRepository(CallDetails) || this.callDetailsRepository;
    const chatObject = repo.create({
      clientId: userId,
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
    const callDetailsRepo =
      entityManager?.getRepository(CallDetails) || this.callDetailsRepository;

    const createdBy = ExecutionManager.getUserId();

    const startTime = startedAt || new Date();

    const chat = chatRepo.create({
      clientId,
      counselorId,
      status: status || ChatStatus.ACTIVE,
      startedAt: startTime,
      ...(endedAt ? { endedAt } : {}),
      externalId,
      tenantId: tenantId || ExecutionManager.getTenantId(),
      ...(createdBy ? { createdBy: +createdBy } : {}),
    });

    await chatRepo.save(chat);

    const callDetails = callDetailsRepo.create({
      chatId: chat.id,
      tenantId: tenantId || ExecutionManager.getTenantId(),
      startTime,
      ...(endedAt ? { endTime: endedAt } : {}),
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

  // TODO: will be decprecated
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

  // TODO: will be decprecated
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

  // TODO: will be decprecated
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
    return this.messageService.saveMessage(chatId, senderId, data);
  }

  async save(message: Message) {
    return this.messageService.save(message);
  }

  async getMessageObject(
    chatId: number,
    senderId: number,
    data: { content: string; context?: string; messageType?: MessageType },
  ) {
    return this.messageService.getMessageObject(chatId, senderId, data);
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
    const { messages } = await this.messageService.getMessageByChatId(
      chat.id,
      undefined,
      entityManager,
    );
    const counselorInfo = await this.userService.getMinimalUserInfo(counselor);
    const clientInfo = await this.userService.getMinimalUserInfo(client);
    const payload = {
      counselor: counselorInfo,
      client: clientInfo,
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
    const chat = await this.chatRepository.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    return this.messageService.getMessages(chatId, userId, chat, options);
  }

  async handleChatEnded(chat: Chat) {
    return this.callDetailsService.handleChatEnded(chat);
  }

  async updateSummaryAndTags(chat: Chat) {
    return this.callDetailsService.updateSummaryAndTags(chat);
  }

  async updateCallMetadata(chatId: number, duration?: number) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      this.logger.error(
        `updateCallMetadata - chatId:${chatId} - chat not found`,
      );
      return;
    }
    return this.callDetailsService.updateCallMetadata(chat, duration);
  }

  async updateMessageStatistics(chat: Chat, callDetails?: CallDetails | null) {
    return this.callDetailsService.updateMessageStatistics(chat, callDetails);
  }

  async generateSummary(
    chatId: number,
  ): Promise<FlattenedSummaryNotePayloadCamelCase | undefined> {
    const summary = await this.callDetailsService.generateSummary(chatId);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.SUMMARY_GENERATED,
      details: {
        chatId,
      },
    });

    return summary;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    return this.aiChatIntegrationService.generateSummaryForMessage(
      messageRequests,
    );
  }

  async getCallLogs(user: TokenUser, options: Pagination) {
    return this.callLogService.getCallLogs(user, options);
  }

  async getAdminCallLogs(filters: CallLogFilters) {
    return this.callLogService.getAdminCallLogs(filters);
  }
  async enhance(summary: string) {
    return this.aiChatIntegrationService.enhance(summary);
  }

  async updateCallDetails(
    chatId: number,
    summary: FlattenedSummaryNotePayloadCamelCase,
  ) {
    await this.callDetailsService.updateCallDetails(chatId, summary);
    return this.getChat(chatId);
  }

  async updateCallInfo(chatId: number, body: CallInfoDto) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }

    await this.callDetailsService.updateCallInfo(chatId, body, chat);
    return this.getChat(chatId);
  }

  getNudge(newMessage: string, messageRequests: MessageRequest[]) {
    return this.aiChatIntegrationService.getNudge(newMessage, messageRequests);
  }

  async tagPositivityRatings(tags: string[]) {
    return this.aiChatIntegrationService.tagPositivityRatings(tags);
  }

  async decryptCallDetails(
    callDetails: CallDetails | null,
  ): Promise<CallDetails | undefined> {
    return this.callDetailsService.decryptCallDetails(callDetails);
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
    return this.callDetailsService.pauseOrResumeChat(chatId, pause);
  }

  async isChatPaused(chatId: number) {
    return this.callDetailsService.isChatPaused(chatId);
  }

  async triggerNudge(
    newMessage: { content: string; chatId: number; id: number },
    session: UserChatSessionData,
    chatId: number,
    channel: string,
  ) {
    return this.aiChatIntegrationService.triggerNudge(
      newMessage,
      session,
      chatId,
      channel,
      (nudge, sess, msg, ch) => this.handleNudge(nudge, sess, msg, ch),
    );
  }

  incrementWordCountByLanguage(
    chatId: number,
    language: string,
    count: number,
  ) {
    return this.callDetailsService.incrementWordCountByLanguage(
      chatId,
      language,
      count,
    );
  }

  async handleNudge(
    nudgeResponse: NudgeResponse,
    session: UserChatSessionData,
    parentMessage: { content: string; chatId: number; id: number },
    channel: string,
  ) {
    return this.aiChatIntegrationService.handleNudge(
      nudgeResponse,
      session,
      parentMessage,
      channel,
      (sess, data, opts, ch) =>
        this.persistAndBroadcastMessage(sess, data, opts, ch),
    );
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
    const chat = await this.getChatById(data.chatId);
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    return this.messageService.persistAndBroadcastMessage(
      session,
      data,
      chat,
      broadCastOptions,
      channel,
    );
  }

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    return this.callLogService.getCounselorNames(limit, offset, search);
  }

  async getAllTags(limit?: number, offset?: number, search?: string) {
    return this.callLogService.getAllTags(limit, offset, search);
  }

  // TODO: will be decprecated
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
    return this.callDetailsService.addNoteToSession(chatId, createNoteDto);
  }

  async addFeedbackToChat(
    chatId: number,
    summaryFeedbackDto: SummaryFeedbackDto,
  ): Promise<SummaryFeedbackResponse> {
    return this.chatFeedbackService.addFeedbackToChat(
      chatId,
      summaryFeedbackDto,
    );
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
