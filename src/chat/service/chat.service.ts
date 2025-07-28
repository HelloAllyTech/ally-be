import { forwardRef, HttpException, Injectable, Inject } from '@nestjs/common';
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
import { ChatRoom } from '../../common/entities/chat-room.entity';
import { QueueService } from '../../queue/service/queue.service';
import {
  AudioChatPlatform,
  AudioChatProvider,
  QueueStatus,
} from '../../common/constants/chat.constants';
import { ChatGateway } from '../gateway/chat.gateway';
import { UserService } from '../../user/user.service';
import { ChatEvents, LANGUAGE_MAP } from '../constants/chat.constants';
import { Feedback } from '../../common/entities/feedback.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../../common/entities/user.entity';
import { AiService } from '../../ai/service/ai.service';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import {
  DeepgramTranscriptMetadata,
  MessageWithFeedback,
  NudgeResponse,
  SendMessageWebSocketData,
  UserChatSessionData,
} from '../type/chat.type';
import { Pagination } from '../../common/type/common.type';
import { CallDetails } from '../../common/entities/call.details.entity';
import { RedisService } from '../../redis/service/redis.service';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';
import { StringUtil } from '../../common/util/string.util';
import { TokenUser } from '../../auth/type/auth.types';
import {
  ANONYMOUS_CLIENT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '../../exception/custom.exception';
import { TIME } from '../../common/constants/time.constants';
import { ChatUtil } from '../util/chat.util';
import { CommonUtil } from '../../common/util/common.util';
import { CallInfoDto } from '../dto/chat.response.dto';
import { CallInfo } from '../dto/call-log.response.dto';
import { SettingsService } from '../../settings/service/settings.service';
import { MessageBrokerChannel } from 'src/common/constants/message-broker.constants';
import {
  CallLogFilters,
  CallLogSortBy,
  SortOrder,
} from '../dto/call-log.request.dto';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { AddNoteDto } from '../dto/notes.dto';

@Injectable()
export class ChatService {
  logger = LoggerService.getInstance(ChatService.name);
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Chat)
    private chatRepository: Repository<Chat>,

    @InjectRepository(ChatRoom)
    private chatRoomRepository: Repository<ChatRoom>,
    @InjectRepository(CallDetails)
    private callDetailsRepository: Repository<CallDetails>,
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService,
    private gateway: ChatGateway,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
    private readonly cache: RedisService,
    private readonly publisher: MessageBrokerService,
    private dataSource: DataSource,
    private settingsService: SettingsService,
    private broadcastMessageService: BroadcastMessageService,
    private streamFileProcessorService: StreamFileProcessorService,
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
    const chat = await chatQuery.getOne();
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    return chat;
  }

  async requestChat(userId: number) {
    this.logger.info(`requestChat - userId:${userId}`);
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
        this.logger.info(`requestChat - activeChats:${activeChats.id}`);
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
        this.logger.info(`requestChat - activeChats:${activeChats.id}`);
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

  async createChatWithClientAndCounselor({
    clientId,
    counselorId,
    tenantId,
    provider,
    platform,
    entityManager,
  }: {
    clientId: number;
    counselorId?: number;
    tenantId?: string;
    provider?: AudioChatProvider;
    platform?: AudioChatPlatform;
    entityManager?: EntityManager;
  }) {
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

    const chat = chatRepo.create({
      clientId,
      counselorId,
      roomId: newChatRoom.id,
      status: ChatStatus.ACTIVE,
      startedAt: new Date(),
      tenantId: tenantId || ExecutionManager.getTenantId(),
    });

    await chatRepo.save(chat);

    await callDetailsRepo.save({
      chatId: chat.id,
      tenantId: tenantId || ExecutionManager.getTenantId(),
      startTime: new Date(),
      callInfo: {
        provider,
        platform,
      },
    });

    return chat;
  }

  async createChatForAnyonymousClient({
    counselorId,
    provider,
    platform,
    entityManager,
  }: {
    counselorId: number;
    provider?: AudioChatProvider;
    platform?: AudioChatPlatform;
    entityManager?: EntityManager;
  }): Promise<{
    chatId: number;
    clientId: number;
    counselorId: number;
  } | null> {
    const clientId = ANONYMOUS_CLIENT_ID;

    const chat = await this.createChatWithClientAndCounselor({
      clientId,
      counselorId,
      provider,
      platform,
      entityManager,
    });

    return {
      chatId: chat.id,
      clientId: clientId,
      counselorId,
    };
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

  async startCall(participantPhoneNumbers: string[]) {
    if (!participantPhoneNumbers || participantPhoneNumbers?.length < 2) {
      throw new HttpException('Need at least 2 participants', 400);
    }
    const participants = await this.userService.getUsersByPhoneNumbers(
      participantPhoneNumbers,
    );

    const counselor = participants?.find(
      (participant) => participant.role === UserRole.COUNSELOR,
    );
    if (!counselor) {
      throw new HttpException(`Counselor not found`, 404);
    }
    let client = participants?.find(
      (participant) => participant.role === UserRole.CLIENT,
    );
    if (!client) {
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
    return {
      messages,
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
    const message = this.messageRepository.create({
      chatId,
      senderId,
      content: data.content,
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
    return this.messageRepository.create({
      chatId,
      senderId,
      content: data.content,
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

  async endChat(chatId: number) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    if (chat.status !== ChatStatus.ACTIVE) {
      throw new HttpException('Chat is not active', 400);
    }

    await this.chatRepository.update(chatId, {
      status: ChatStatus.ENDED,
      endedAt: new Date(),
    });
    this.cache.del(`chat:${chatId}`);
    const updatedChat = await this.getChatById(chatId);
    if (updatedChat) {
      this.eventEmitter.emit(ChatEvents.CHAT_ENDED, updatedChat);
      this.logger.info(`chat ended event emitted - chat:${chatId}`);
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

    const role = ExecutionManager.getRole();
    if (role !== UserRole.ADMIN) {
      if (chat.clientId !== userId && chat.counselorId !== userId) {
        throw new HttpException(
          'You are not authorized to access this chat',
          403,
        );
      }
    }

    const { messages, count } = await this.getMessageByChatId(chatId, {
      limit,
      offset,
      sortBy,
      order: sortOrder,
      type: MessageType.TEXT,
    });

    return {
      data: messages.map((message) => this.formatMessage(message)),
      count,
    };
  }

  async handleChatEnded(chat: Chat) {
    this.logger.info(`handleChatEnded - chat:${chat.id}`);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chat.id, tenantId: ExecutionManager.getTenantId() },
    });
    const provider = callDetails?.callInfo?.provider;

    const channel = findMessageBrokerChannelUsingProvider(provider!);
    let participants;

    this.logger.info(
      `handleChatEnded - chat:${chat.id} | provider:${provider}`,
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

      if (channel) {
        this.broadcastMessageService.broadcastChatEndedEvent(channel, {
          participants,
          chatId: chat.id,
        });
      }
    }
  }

  async updateSummaryAndTags(chat: Chat) {
    const summary = (await this.generateSummary(chat.id)) || {};
    await this.callDetailsRepository.update(
      { chatId: chat.id },
      {
        summary,
      },
    );
  }

  async updateCallMetadata(chatId: number) {
    this.logger.info(`updateCallDetails:Start - chatId:${chatId}`);
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

      const startDate = chat.startedAt || new Date();
      const endDate = chat.endedAt || new Date();

      const callDurationInSeconds = ChatUtil.getCallDurationInSeconds(
        startDate,
        endDate,
      );

      if (callDetails) {
        const existingCallInfo = callDetails.callInfo || {};
        const updates = {
          callInfo: {
            ...existingCallInfo,
            summaryName: ChatUtil.getSummaryName(chat),
          },
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
    this.logger.info(
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

      const updates = {
        noOfNudges,
        noOfStages,
        transcript,
        callInfo: {
          ...existingCallInfo,
          clientTalkingPercentage: clientTalkingPercentage,
          counselorTalkingPercentage: counselorTalkingPercentage,
          clientTalkingTime: clientTalkingPercentage * callDurationInSeconds,
          counselorTalkingTime:
            counselorTalkingPercentage * callDurationInSeconds,
          summaryName: ChatUtil.getSummaryName(chat),
          wordCountByLanguage,
          clientWordCount,
          counselorWordCount,
        } as CallInfo,
        endTime: endDate,
        callDuration: callDurationInSeconds,
      };
      this.logger.info(
        `updateMessageStatistics:updates:${JSON.stringify(updates)}`,
      );
      const details = await this.callDetailsRepository.update(
        { chatId },
        updates,
      );
      // delete the word count from cache
      await this.deleteWordCountByLanguage(chat.id);
      this.logger.info(`updateMessageStatistics:End - chatId:${chat.id}`);
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
    this.logger.info(`generateSummary - chatId:${chatId}`);
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
    return convertedResponse;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    if (aiResponse) {
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

    const messageRequests: MessageRequest[] = messages.map((message: any) => ({
      role:
        message.senderId === ANONYMOUS_CLIENT_ID
          ? 'CLIENT'
          : message.sender?.role,
      content: message.content,
      start_time: message.startSeconds,
      end_time: message.endSeconds,
    }));
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
    const [callLogs, count] = await query.getManyAndCount();
    return {
      data: callLogs,
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
    return { data: callLogs, count };
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
    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { summary: summary },
    );
    return this.getChat(chatId);
  }

  async updateCallInfo(chatId: number, body: CallInfoDto) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }

    if (
      ExecutionManager.getRole() == UserRole.COUNSELOR &&
      chat.counselorId != ExecutionManager.getUserId()
    ) {
      throw new ForbiddenException(
        'You are not authorized to update call info',
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

  async exportSummary(
    tokenUser: TokenUser,
    chatId: number,
  ): Promise<{ summary: string; fileName: string }> {
    const { chat, callDetails } = await this.getChatWithCallDetails(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }

    if (
      tokenUser.role !== UserRole.SUPER_ADMIN &&
      tokenUser.role !== UserRole.ADMIN &&
      tokenUser.id !== chat.counselorId
    ) {
      throw new ForbiddenException(
        'You are not authorized to export this chat summary',
      );
    }

    // const client = await this.userService.get(chat.clientId);
    // const counselor = await this.userService.get(chat.counselorId!);

    // Assuming callDetails.summaryNote is available
    const summaryInfo =
      callDetails?.summary || ({} as FlattenedSummaryNotePayloadCamelCase);
    const summaryName =
      callDetails?.callInfo?.summaryName || ChatUtil.getSummaryName(chat);
    const counselor = await this.userService.get(chat.counselorId!);

    let summary = `Chat Summary\n`;
    summary += `============\n\n`;
    summary += `Call ID: ${chat.id}\n`;
    summary += `Call Date: ${new Date(chat.createdAt).toLocaleDateString()}\n`;
    summary += `Call Time: ${new Date(chat.createdAt).toLocaleTimeString()}\n`;
    summary += `Summary Name: ${summaryName}\n`;
    summary += `Call Duration (seconds): ${callDetails?.callDuration ?? 'N/A'}\n`;
    summary += `Tags:`;
    summary += summaryInfo?.tags?.length ? '\n' : '';
    summary += summaryInfo?.tags?.length
      ? summaryInfo.tags
          .map((tag) => `  - ${tag.tag} (Positivity: ${tag.positivity_rating})`)
          .join('\n') + '\n'
      : '  - N/A\n';

    summary += `Client ID: ${chat.clientId ?? 'N/A'}\n`;
    summary += `Counselor: ${counselor?.name ?? 'N/A'}\n`;
    summary += `Call Type: ${summaryInfo.callType ?? 'N/A'}\n`;
    summary += `Age: ${summaryInfo.age ?? 'N/A'}\n`;
    summary += `Gender: ${summaryInfo.gender}\n`;
    summary += `Profession: ${summaryInfo.profession ?? 'N/A'}\n`;
    summary += `Relationship Status: ${summaryInfo.relationshipStatus ?? 'N/A'}\n`;

    summary += `Languages:\n`;
    summary += summaryInfo?.languages?.length
      ? summaryInfo.languages
          .map(({ language, percentage }) => {
            const label =
              LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP] || language;
            return `  - ${label} (${percentage.toFixed(1)}%)`;
          })
          .join('\n') + '\n'
      : '  - N/A\n';

    summary += `Location: ${summaryInfo.location ?? 'N/A'}\n`;
    summary += `Code of Concern: ${summaryInfo.codeOfConcern}\n`;

    summary += `Session Summary: ${summaryInfo.sessionSummary}\n`;
    summary += `Counseling Process Flow: ${summaryInfo.counselingProcessFlow ?? 'N/A'}\n`;
    summary += `Key Concerns: ${summaryInfo.keyConcerns}\n`;
    summary += `Subjective Observations: ${summaryInfo.subjectiveObservations}\n`;
    summary += `Objective Observations: ${summaryInfo.objectiveObservations}\n`;
    summary += `Assessment: ${summaryInfo.assessment}\n`;
    summary += `Dominant Feelings: ${summaryInfo.dominantFeelings}\n`;
    summary += `Issues Worked On: ${summaryInfo.issuesWorkedOn}\n`;
    summary += `Key Therapeutic Techniques: ${summaryInfo.keyTherapeuticTechniques}\n`;

    summary += `Referrals Provided: ${summaryInfo.referralsProvided ?? 'N/A'}\n`;
    summary += `Homework: ${summaryInfo.homework}\n`;
    summary += `Plan for Next Call: ${summaryInfo.planForNextCall}\n`;

    summary += `Reflective Questions Asked: ${summaryInfo.reflectiveQuestionsAsked}\n`;
    summary += `Open-ended Questions Asked: ${summaryInfo.openEndedQuestionsAsked}\n`;
    summary += `Emotional Lift: ${summaryInfo.emotionalLift || 'N/A'}\n`;
    summary += `Call Quality: ${summaryInfo.callQuality || 'N/A'}\n`;
    summary += `New Call Follow-up: ${summaryInfo.newCallFollowUp || 'N/A'}\n`;

    // // Include tags
    // if (ChatUtil.isTagsAvailable(summaryInfo)) {
    //   summary += `Tags\n`;
    //   summary += `====\n`;
    //   for (const tag of summaryInfo.tags) {
    //     summary += `${tag.tag} - ${tag.positivity_rating}\n`;
    //   }
    //   summary += `\n`;
    // }

    // // Session details
    // if (ChatUtil.isSessionDetailsAvailable(summaryInfo)) {
    //   summary += `Session Details\n`;
    //   summary += `===============\n`;
    //   summary += `Counselor Name: ${counselor?.name}\n`;
    //   summary += `Session Number: ${chat.id}\n`;
    //   summary += `Date of Session: ${new Date(chat.createdAt).toLocaleDateString() || 'N/A'}\n`;
    //   summary += `New Call/Follow-up: ${summaryInfo.newCallFollowUp || 'N/A'}\n\n`;
    // }

    // Demographic details
    if (ChatUtil.isDemographicDetailsAvailable(summaryInfo)) {
      summary += `\nDemographic Details\n`;
      summary += `===================\n`;
      summary += `Client ID: ${'N/A'}\n`; // Check if this is needed in export
      summary += `Gender: ${summaryInfo.gender || 'N/A'}\n`;
      summary += `Age: ${summaryInfo.age || 'N/A'}\n`;
      summary += `Location: ${summaryInfo.location || 'N/A'}\n`;
      summary += `Profession: ${summaryInfo.profession || 'N/A'}\n`;
      summary += `Relationship Status: ${summaryInfo.relationshipStatus || 'N/A'}\n`;
      summary += `Languages: ${summaryInfo.languages?.map((language) => LANGUAGE_MAP[language.language as keyof typeof LANGUAGE_MAP] || language.language).join(', ') || 'N/A'}\n`;
      summary += `Code of Concern: ${summaryInfo.codeOfConcern || 'N/A'}\n`;
    }

    //metrics

    summary += `\nMetrics\n`;
    summary += `======\n`;
    summary += `No of Reflective Questions: ${summaryInfo.reflectiveQuestionsAsked}\n`;
    summary += `Emotions Lift: ${summaryInfo.emotionalLift}\n`;
    const clientTalkingPercentage =
      callDetails?.callInfo?.clientTalkingPercentage;
    const listeningShare =
      clientTalkingPercentage !== undefined && clientTalkingPercentage !== null
        ? clientTalkingPercentage * 100
        : 'N/A';
    summary += `Listening Share: ${listeningShare}%\n`;

    if (callDetails?.callInfo?.notes) {
      summary += `\nNotes\n`;
      summary += `=====\n`;
      summary += `${callDetails.callInfo.notes}\n`;
    }

    // // Counselor impressions
    // if (ChatUtil.isCounselorImpressionsAvailable(summaryInfo)) {
    //   summary += `Counselor Impressions\n`;
    //   summary += `======================\n`;
    //   summary += `Client Attitude: ${summaryInfo.clientAttitude || 'N/A'}\n`;
    //   summary += `Emotional State Start: ${summaryInfo.emotionalStateStart || 'N/A'}\n`;
    //   summary += `Emotional State Change: ${summaryInfo.emotionalStateChange || 'N/A'}\n`;
    //   summary += `Problem Analysis: ${summaryInfo.problemAnalysis || 'N/A'}\n`;
    //   summary += `Additional Insights: ${summaryInfo.additionalInsights || 'N/A'}\n`;
    //   summary += `Counselor Feelings: ${summaryInfo.counselorFeelings || 'N/A'}\n\n`;
    // }

    // // Session documentation
    // if (ChatUtil.isSessionDocumentationAvailable(summaryInfo)) {
    //   summary += `Session Documentation\n`;
    //   summary += `======================\n`;
    //   summary += `Key Concerns: ${summaryInfo.keyConcerns || 'N/A'}\n`;
    //   summary += `Dominant Feelings: ${summaryInfo.dominantFeelings || 'N/A'}\n`;
    //   summary += `Counseling Process Flow: ${summaryInfo.counselingProcessFlow || 'N/A'}\n`;
    //   summary += `Therapeutic Interventions: ${summaryInfo.keyTherapeuticTechniques || 'N/A'}\n`;
    //   summary += `Objective Observations: ${summaryInfo.objectiveObservations || 'N/A'}\n`;
    //   summary += `Subjective Observations: ${summaryInfo.subjectiveObservations || 'N/A'}\n`;
    //   summary += `Assessment: ${summaryInfo.assessment || 'N/A'}\n`;
    //   summary += `Referrals Provided: ${summaryInfo.referralsProvided || 'N/A'}\n`;
    //   summary += `Issues Worked On: ${summaryInfo.issuesWorkedOn || 'N/A'}\n`;
    //   summary += `Homework: ${summaryInfo.homework || 'N/A'}\n`;
    // }

    // if (ChatUtil.isFollowUpPlanAvailable(summaryInfo)) {
    //   summary += `Follow-up Plan\n`;
    //   summary += `==============\n`;
    //   summary += `Follow-up Status: ${summaryInfo.followUpStatus || 'N/A'}\n`;
    //   summary += `Follow-up Date: ${summaryInfo.followUpDate || 'N/A'}\n`;
    //   summary += `Follow-up Goals: ${summaryInfo.followUpGoals?.join(', ') || 'N/A'}\n`;
    // }

    // if (ChatUtil.isCallQualityAvailable(summaryInfo)) {
    //   summary += `\n`;
    //   summary += `Call Quality: ${summaryInfo.callQuality}\n`;
    // }

    return { summary, fileName: summaryName };
  }

  async getChatWithCallDetails(chatId: number) {
    const chat = await this.getChatById(chatId);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    return { chat, callDetails };
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
      this.logger.info(`Chat is paused for chatId ${chatId}`);
      return;
    }
    const isNudgeEnabled = await this.settingsService.getNudgeStatus();
    if (!isNudgeEnabled) {
      this.logger.info(`Nudge is disabled for chatId ${chatId}`);
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
        this.logger.info(
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
    this.logger.info(
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
  ): Promise<string> {
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

    return createNoteDto.content;
  }
}
