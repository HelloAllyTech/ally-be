import {
  HttpException,
  Injectable,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In } from 'typeorm';
import { Chat, ChatStatus } from '../entity/chat.entity';
import { LoggerService } from '../../logger/logger.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import {
  AudioChatPlatform,
  AudioChatProvider,
} from '../../common/constants/chat.constants';
import { CallDetails } from '../entity/call.details.entity';
import { Pagination } from '../../common/type/common.type';
import { UserService } from '../../user/service/user.service';
import { ChatEvents } from '../constants/chat.constants';
import { UpdateChatInput } from '../type/chat.type';

import { RedisService } from '../../redis/service/redis.service';

import { NotFoundException } from '@nestjs/common';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import { TokenUser } from '../../auth/type/auth.types';
import { ANONYMOUS_CLIENT_ID } from '../../common/constants/user.constants';
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
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
    private dataSource: DataSource,
    private chatAudioUploadsService: ChatAudioUploadsService,
    private permissionValidator: PermissionValidator,
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

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    return this.callLogService.getCounselorNames(limit, offset, search);
  }

  async getAllTags(limit?: number, offset?: number, search?: string) {
    return this.callLogService.getAllTags(limit, offset, search);
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
