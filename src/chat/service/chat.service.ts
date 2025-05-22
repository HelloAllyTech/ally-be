import { forwardRef, HttpException, Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Message, MessageType } from '../../common/entities/message.entity';
import { Chat, ChatStatus } from '../../common/entities/chat.entity';
import { LoggerService } from '../../logger/logger.service';
import { ChatRoom } from '../../common/entities/chat-room.entity';
import { QueueService } from '../../queue/service/queue.service';
import { QueueStatus } from '../../common/constants/chat.constants';
import { ChatGateway } from '../gateway/chat.gateway';
import { UserService } from '../../user/user.service';
import { ChatEvents } from '../constants/chat.constants';
import { Feedback } from '../../common/entities/feedback.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../../common/entities/user.entity';
import { AiService } from '../../ai/service/ai.service';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import {
  DeepgramTranscriptMetadata,
  MessageWithFeedback,
  UserChatSessionData,
} from '../type/chat.type';
import { Pagination } from '../../common/type/common.type';
import { CallDetails } from '../../common/entities/call.details.entity';
import { RedisService } from '../../redis/service/redis.service';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { CallInfo } from '../../common/entities/type/call.details.type';
import { StringUtil } from '../../common/util/string.util';
import { TokenUser } from '../../auth/type/auth.types';
import { UserRole } from '../../common/constants/user.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '../../exception/custom.exception';
import { TIME } from '../../common/constants/time.constants';

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
    private readonly messageBrokerService: MessageBrokerService,
    private dataSource: DataSource,

    //  private kafkaProducerService: KafkaProducerService,
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
    });
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
      // TODO: UPDATE this once we have a phone number in table
      const clientPhoneNumber = participantPhoneNumbers?.find(
        (phn) => phn !== counselor.name,
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
    query.andWhere('message.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });
    return query.getMany();
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
    },
  ) {
    const message = this.messageRepository.create({
      chatId,
      senderId,
      content: data.content,
      context: data.context,
      type: data.messageType || MessageType.TEXT,
      tenantId: ExecutionManager.getTenantId(),
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

  async getCounsellorChat(id: number) {
    const latestChat = await this.getChatsByCouncilorId(id, {
      status: ChatStatus.ACTIVE,
    });
    if (!latestChat) {
      throw new HttpException('Chat not found', 404);
    }
    return this.getChatResponse(latestChat);
  }

  async getChatResponse(chat: Chat, entityManager?: EntityManager) {
    const client = await this.userService.get(chat.clientId);
    const counselor = chat.counselorId
      ? await this.userService.get(chat.counselorId)
      : null;
    const messages = await this.getMessageByChatId(
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

  async endChat(id: number, chatId: number) {
    await this.chatRepository.update(chatId, {
      status: ChatStatus.ENDED,
      endedAt: new Date(),
    });
    const updatedChat = await this.getChatById(chatId);
    if (updatedChat) {
      this.gateway.broadcastChatEndedEvent(updatedChat);
    }
    this.eventEmitter.emit(ChatEvents.CHAT_ENDED, updatedChat);

    return updatedChat;
  }

  async getMyChats(id: number) {
    const chats = await this.getChatsByUserIds([id], {
      status: [ChatStatus.ACTIVE, ChatStatus.PAUSED],
    });

    if (!chats?.length) {
      throw new HttpException('Chat not found', 404);
    }
    return this.getChatResponse(chats[0]);
  }

  async getMessages(
    chatId: number,
    userId: number,
    limit: number = 50,
    offset: number = 0,
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

    if (chat.clientId !== userId && chat.counselorId !== userId) {
      throw new HttpException(
        'You are not authorized to access this chat',
        403,
      );
    }

    const query = this.messageRepository.createQueryBuilder('message');
    query
      .where('message.chatId = :chatId', { chatId })
      .leftJoinAndMapOne(
        'message.feedback',
        Feedback,
        'feedback',
        'feedback.messageId = message.id',
      )
      .orderBy('message.createdAt', 'DESC');
    if (limit) {
      query.limit(limit);
    }
    if (offset) {
      query.offset(offset);
    }
    query.andWhere('message.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });
    return query.getMany();
  }

  async handleChatEnded(chat: Chat) {
    this.logger.info(`handleChatEnded - chat:${chat.id}`);
    await Promise.allSettled([
      this.updateSummaryAndTags(chat),
      this.updateMessageStatistics(chat),
    ]);
  }

  async updateSummaryAndTags(chat: Chat) {
    const { summary_note, tags, call_quality } =
      (await this.generateSummary(chat.id)) || {};
    await this.callDetailsRepository.update(
      { chatId: chat.id },
      {
        summary: {
          summaryNote: summary_note,
          tags: tags,
          callQuality: call_quality,
        },
      },
    );
  }

  async updateMessageStatistics(chat: Chat) {
    const chatId = chat.id;
    const messages = await this.getMessageByChatId(chatId, {
      sortBy: 'createdAt',
      order: 'ASC',
    });
    const startDate = chat.startedAt || new Date();
    const endDate = chat.endedAt || new Date();
    // duration in seconds as integer
    const callDurationInSeconds = Math.floor(
      (endDate.getTime() - startDate.getTime()) / 1000,
    );

    // get word count by language
    const wordCountByLanguage = await this.getWordCountByLanguage(chat.id);

    let noOfNudges = 0;
    let noOfStages = 0;
    let clientMessages = 0;
    let counselorMessages = 0;
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
        clientMessages += StringUtil.wordCount(message.content);
        transcript += `Client: ${message.content}\n`;
      } else {
        counselorMessages += StringUtil.wordCount(message.content);
        transcript += `Counselor: ${message.content}\n`;
      }
    });
    const clientTalkingPercentage =
      clientMessages > 0
        ? clientMessages / (clientMessages + counselorMessages)
        : 0;
    const counselorTalkingPercentage =
      counselorMessages > 0
        ? counselorMessages / (clientMessages + counselorMessages)
        : 0;
    const updates = {
      noOfNudges,
      noOfStages,
      transcript,
      callInfo: {
        clientTalkingPercentage: clientTalkingPercentage?.toFixed(3) || 0,
        counselorTalkingPercentage: counselorTalkingPercentage?.toFixed(3) || 0,
        clientTalkingTime: clientTalkingPercentage * callDurationInSeconds,
        counselorTalkingTime:
          counselorTalkingPercentage * callDurationInSeconds,
        summaryName: `Call:${chat.id}:${chat.startedAt}`,
        wordCountByLanguage,
      } as CallInfo,
      endTime: chat.endedAt,
      callDuration: callDurationInSeconds,
    };

    const details = await this.callDetailsRepository.update(
      { chatId },
      updates,
    );
    // delete the word count from cache
    await this.deleteWordCountByLanguage(chat.id);
    return details;
  }

  async generateSummary(
    chatId: number,
  ): Promise<GenerateSummaryResponse | undefined> {
    this.logger.info(`generateSummary - chatId:${chatId}`);
    const messageRequests: MessageRequest[] =
      await this.getChatHistoryForAIService(chatId, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    if (aiResponse) {
      return {
        summary_note: aiResponse.summary_note,
        tags: aiResponse.tags,
        call_quality: aiResponse.call_quality,
      };
    }
    return;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    if (aiResponse) {
      return {
        summary_note: aiResponse.summary_note,
        tags: aiResponse.tags,
        call_quality: aiResponse.call_quality,
      };
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
      role: message.sender.role,
      content: message.content,
      timestamp: message.createdAt.toISOString(),
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

  async enhance(summary: string) {
    return this.aiService.enhance(summary);
  }

  async updateCallDetails(chatId: number, callDetails: any) {
    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { summary: callDetails },
    );
    return this.getChat(chatId);
  }

  getNudge(newMessage: string, messageRequests: MessageRequest[]) {
    return this.aiService.getNudge(newMessage, messageRequests);
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
      tokenUser.role != UserRole.SUPER_ADMIN &&
      tokenUser.id != chat.counselorId
    ) {
      throw new ForbiddenException(
        'You are not authorized to export this chat summary',
      );
    }

    // const client = await this.userService.get(chat.clientId);
    // const counselor = await this.userService.get(chat.counselorId!);

    // Assuming callDetails.summaryNote is available
    const { tags = [], summaryNote } = callDetails?.summary || {};
    const summaryName =
      callDetails?.callInfo?.summaryName || `Call:${chat.id}:${chat.startedAt}`;

    let summary = `Chat Summary\n`;
    summary += `============\n\n`;
    summary += `Chat ID: ${chat.id}\n`;
    // summary += `Client: ${client?.name || 'Unknown'}\n`;
    // summary += `Counselor: ${counselor?.name || 'Unknown'}\n`;
    summary += `Start Time: ${chat.createdAt}\n`;
    summary += `End Time: ${chat.endedAt || 'Ongoing'}\n\n`;
    summary += `Summary Name: ${summaryName}\n\n`;

    // Include tags
    if (tags.length) {
      summary += `Tags: ${tags.join(', ')}\n\n`;
    }

    // Session details
    if (summaryNote?.session_details) {
      const d = summaryNote.session_details;
      summary += `Session Details\n`;
      summary += `===============\n`;
      summary += `Counselor Name: ${d.counselor_name || 'N/A'}\n`;
      summary += `Session Number: ${d.session_number || 'N/A'}\n`;
      summary += `Date of Session: ${d.date_of_session || 'N/A'}\n`;
      summary += `New Call/Follow-up: ${d.new_call_follow_up || 'N/A'}\n\n`;
    }

    // Demographic details
    if (summaryNote?.demographic_details) {
      const dd = summaryNote.demographic_details;
      summary += `Demographic Details\n`;
      summary += `===================\n`;
      Object.entries(dd).forEach(([key, value]) => {
        summary += `${key.replace(/_/g, ' ')}: ${value || 'N/A'}\n`;
      });
      summary += `\n`;
    }

    // Counselor impressions
    if (summaryNote?.counselor_impressions) {
      const ci = summaryNote.counselor_impressions;
      summary += `Counselor Impressions\n`;
      summary += `======================\n`;
      Object.entries(ci).forEach(([key, value]) => {
        summary += `${key.replace(/_/g, ' ')}: ${value || 'N/A'}\n`;
      });
      summary += `\n`;
    }

    // Session documentation
    if (summaryNote?.session_documentation) {
      const sd = summaryNote.session_documentation;
      summary += `Session Documentation\n`;
      summary += `======================\n`;
      summary += `Work Done: ${sd.work_done || 'N/A'}\n`;
      summary += `Key Concerns: ${(sd.key_concerns || []).join(', ') || 'N/A'}\n`;
      summary += `Dominant Feelings: ${(sd.dominant_feelings || []).join(', ') || 'N/A'}\n\n`;
    }

    return { summary, fileName: summaryName };
  }

  async getChatWithCallDetails(chatId: number) {
    const chat = await this.getChatById(chatId);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    return { chat, callDetails };
  }

  async pauseOrResumeNudge(chatId: number, pause: boolean) {
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
      pauseNudge: pause,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );
    await this.cache.set(
      `nudge-paused-${chatId}`,
      String(pause),
      TIME.DAY_IN_SECONDS,
    );
  }

  async isNudgePaused(chatId: number) {
    const cachedValue = await this.cache.get(`nudge-paused-${chatId}`);
    if (cachedValue) {
      return cachedValue === 'true';
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    const isPaused = callDetails?.callInfo?.pauseNudge;
    if (isPaused !== undefined) {
      await this.cache.set(
        `nudge-paused-${chatId}`,
        String(isPaused),
        TIME.DAY_IN_SECONDS,
      );
    }
    return isPaused;
  }

  incrementWordCountByLanguage(
    chatId: number,
    language: string,
    count: number,
  ) {
    return this.cache.hincrBy(`call:${chatId}:word-count`, language, count);
  }

  private async getWordCountByLanguage(chatId: number) {
    const rawCounts = await this.cache.hgetAll(`call:${chatId}:word-count`);
    return Object.entries(rawCounts).reduce(
      (acc, [lang, count]) => {
        acc[lang] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private async deleteWordCountByLanguage(chatId: number) {
    await this.cache.del(`call:${chatId}:word-count`);
  }
}
