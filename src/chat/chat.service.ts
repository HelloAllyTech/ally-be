import { forwardRef, HttpException, Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, MessageType } from '../common/entities/message.entity';
import { Chat, ChatStatus } from '../common/entities/chat.entity';
import { LoggerService } from '../logger/logger.service';
import { ChatRoom } from '../common/entities/chat-room.entity';
import { QueueService } from '../queue/queue.service';
import { QueueStatus } from '../common/constants/chat.constants';
import { ChatGateway } from './chat.gateway';
import { UserService } from '../user/user.service';
import { ChatEvents } from './constants/chat.constants';
import { Feedback } from '../common/entities/feedback.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../common/entities/user.entity';
import { AiService } from '../ai/ai.service';
import { MessageRequest } from '../ai/dto/ai.request.dto';
import { MessageWithFeedback } from './type/chat.type';
import { Pagination } from '../common/type/common.type';

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
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService,
    private gateway: ChatGateway,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,

    //  private kafkaProducerService: KafkaProducerService,
  ) {}

  // async createMessage(data: { senderId: number; receiverId: number; content: string }) {
  //   const sender = await this.userRepository.findOne({ where: { id: data.senderId } });
  //   const receiver = await this.userRepository.findOne({ where: { id: data.receiverId } });

  //   const message = this.messageRepository.create({
  //     content: data.content,
  //     sender,
  //     receiver,
  //   });

  //   // Send to Kafka instead of directly saving
  //   await this.kafkaProducerService.sendMessage('chat-messages', message);

  //   return message;
  // }

  // async getMessages(userId: number) {
  //   return this.messageRepository.find({
  //     where: [
  //       { sender: { id: userId } },
  //       { receiver: { id: userId } },
  //     ],
  //     relations: ['sender', 'receiver'],
  //     order: {
  //       createdAt: 'DESC',
  //     },
  //   });
  // }

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
    const chat = this.chatRepository.create({
      clientId: userId,
      roomId: roomId,
      status: ChatStatus.PAUSED,
    });
    return this.chatRepository.save(chat);
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

    chat.counselorId = counselorId;
    chat.status = ChatStatus.ACTIVE;
    chat.startedAt = new Date();
    return this.chatRepository.save(chat);
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

  async getMessageByChatId(
    chatId: number,
    filter?: { type?: MessageType; limit?: number },
  ) {
    const query = this.messageRepository
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId })
      .leftJoinAndMapOne(
        'message.feedback',
        Feedback,
        'feedback',
        'feedback.messageId = message.id',
      )
      .orderBy('message.createdAt', 'DESC');
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
      message_id: message.id,
      chat_id: message.chatId,
      sender_id: message.senderId,
      message_type: message.type,
      content: message.content,
      context: message.context,
      created_at: message.createdAt.toISOString(),
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
      messages: messages.map(this.formatMessage),
      chat_id: chat.id,
      client_id: chat.clientId,
      counselor_id: chat.counselorId,
      status: chat.status,
      started_at: chat.startedAt,
      ended_at: chat.endedAt,
    };
    return payload;
  }

  async endChat(id: number, chatId: number) {
    await this.chatRepository.update(chatId, {
      status: ChatStatus.ENDED,
      endedAt: new Date(),
    });
    const updatedChat = await this.getChatById(chatId);
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
    const summary = await this.generateSummary(chat.id);
    await this.chatRepository.update({ id: chat.id }, { summary });
  }

  async generateSummary(chatId: number): Promise<string> {
    const messageRequests: MessageRequest[] =
      await this.getChatHistoryForAIService(chatId);
    const summary = await this.aiService.generateSummary(messageRequests);
    return summary;
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

    if (pagination?.sort) {
      query.orderBy(
        `message.${pagination.sort}`,
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
}
