import { forwardRef, HttpException, Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
      .where('chat.id = :id', { id });
    const chat = await chatQuery.getOne();
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    return chat;
  }

  async requestChat(userId: number) {
    this.logger.info(`requestChat - userId:${userId}`);
    const activeChats = await this.chatRepository.findOne({
      where: {
        clientId: userId,
        status: ChatStatus.ACTIVE,
      },
    });

    if (activeChats) {
      this.logger.info(`requestChat - activeChats:${activeChats.id}`);
      throw new HttpException(
        'You already have an active or waiting chat session',
        400,
      );
    }

    const chatRoom = await this.getOrCreateChatRoom(userId);

    const chat = await this.createChat(userId, chatRoom.id);

    return this.queueService.enqueue({
      userId,
      chatId: chat.id,
      priority: 1,
    });
  }

  async createChat(userId: number, roomId: number) {
    const chatObject = this.chatRepository.create({
      clientId: userId,
      roomId: roomId,
      status: ChatStatus.PAUSED,
    });
    const chat = await this.chatRepository.save(chatObject);
    await this.callDetailsRepository.save({
      chatId: chat.id,
    });
    return chat;
  }

  async getOrCreateChatRoom(userId: number) {
    const chatRoom = await this.chatRoomRepository.findOne({
      where: {
        clientId: userId,
      },
    });

    if (chatRoom) {
      return chatRoom;
    }

    const newChatRoom = this.chatRoomRepository.create({
      clientId: userId,
    });

    return this.chatRoomRepository.save(newChatRoom);
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
      },
      order: {
        [options?.orderBy || 'createdAt']: options?.sort || 'desc',
      },
    });
  }
  async getChatById(chatId: number) {
    return this.chatRepository.findOne({
      where: {
        id: chatId,
      },
    });
  }

  async getChatsByCouncilorId(
    counselorId: number,
    options?: { status?: ChatStatus },
  ) {
    return this.chatRepository.findOne({
      where: {
        counselorId: counselorId,
        ...options,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async addCouncilorToChat(counselorId: number, chatId: number) {
    const chat = await this.chatRepository.findOne({
      where: {
        id: chatId,
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
    const updatedChat = await this.chatRepository.save(chat);
    await this.callDetailsRepository.update(
      { chatId: chatId },
      { startTime: startTime },
    );
    return updatedChat;
  }

  async accept(councilorId: number, chatId: number) {
    const activeChats = await this.getChatsByCouncilorId(councilorId, {
      status: ChatStatus.ACTIVE,
    });
    if (activeChats) {
      throw new HttpException('You already have an active chat session', 400);
    }

    const chat = await this.addCouncilorToChat(councilorId, chatId);
    const queueEntry = await this.queueService.getQueueByChatId(chatId);

    if (!queueEntry) {
      throw new HttpException('Chat not found in queue', 404);
    }
    await this.queueService.updateQueueStatus(
      queueEntry.entryId,
      QueueStatus.MATCHED,
    );
    const room = `user-${chat.clientId}`;
    const chatResponse = await this.getChatResponse(chat);
    const payload = {
      type: ChatEvents.CHAT_ACCEPTED,
      payload: chatResponse,
    };
    this.gateway.sendMessagesToRoom(room, payload);
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
  ) {
    const query = this.messageRepository
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
    data: { content: string; context?: string; messageType?: MessageType },
  ) {
    const message = this.messageRepository.create({
      chatId,
      senderId,
      content: data.content,
      context: data.context,
      type: data.messageType || MessageType.TEXT,
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

  async getChatResponse(chat: Chat) {
    const client = await this.userService.get(chat.clientId);
    const counselor = chat.counselorId
      ? await this.userService.get(chat.counselorId)
      : null;
    const messages = await this.getMessageByChatId(chat.id);
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
    const { summary_note, tags, call_quality } = await this.generateSummary(
      chat.id,
    );
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
    const durationInSeconds = Math.floor(
      (endDate.getTime() - startDate.getTime()) / 1000,
    );

    let noOfNudges = 0;
    let noOfStages = 0;
    let clientMessages = '';
    let counselorMessages = '';
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
        clientMessages += message.content.length;
        transcript += `Client: ${message.content}\n`;
      } else {
        counselorMessages += message.content.length;
        transcript += `Counselor: ${message.content}\n`;
      }
    });
    const clientTalkingPercentage =
      (clientMessages.length /
        (clientMessages.length + counselorMessages.length)) *
      100;
    const counselorTalkingPercentage =
      (counselorMessages.length /
        (clientMessages.length + counselorMessages.length)) *
      100;
    const updates = {
      noOfNudges,
      noOfStages,
      transcript,
      callInfo: {
        clientTalkingPercentage,
        counselorTalkingPercentage,
      } as CallInfo,
      endTime: chat.endedAt,
      callDuration: durationInSeconds,
    };

    const details = await this.callDetailsRepository.update(
      { chatId },
      updates,
    );
    return details;
  }

  async generateSummary(chatId: number): Promise<GenerateSummaryResponse> {
    const messageRequests: MessageRequest[] =
      await this.getChatHistoryForAIService(chatId);
    const { summary_note, tags, call_quality } =
      await this.aiService.generateSummaryAndTags(messageRequests);
    return { summary_note, tags, call_quality };
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

    const messages = await query.getMany();

    const messageRequests: MessageRequest[] = messages.map((message: any) => ({
      role: message.sender.role,
      content: message.content,
      timestamp: message.createdAt.toISOString(),
    }));
    return messageRequests;
  }

  async getCallLogs(id: number, options: Pagination) {
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
      .where('chat.counselorId = :counselorId', { counselorId: id });
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
    const callLogs = await query.getMany();
    return callLogs;
  }

  async enhance(summary: string) {
    return this.aiService.enhance(summary);
  }

  async updateCallDetails(chatId: number, callDetails: any) {
    await this.callDetailsRepository.update(
      { chatId },
      { summary: callDetails },
    );
    return this.getChat(chatId);
  }
}
