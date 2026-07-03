import {
  HttpException,
  Injectable,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DataSource,
  EntityManager,
  In,
  LessThan,
  MoreThanOrEqual,
  Raw,
} from 'typeorm';
import { Chat, ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';
import { LoggerService } from '../../logger/logger.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import {
  AudioChatPlatform,
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import { CallDetails } from '../entity/call.details.entity';
import { Pagination, SuccessResponse } from '../../common/type/common.type';
import { UserService } from '../../user/service/user.service';
import {
  ChatEvents,
  CHAT_SUMMARY_TIMEOUT_MINUTES,
  CHAT_REPROCESS_LOOKBACK_DAYS,
  CHAT_SUMMARY_TIMEOUT_ERROR,
  MAX_STUCK_REPROCESS_ATTEMPTS,
} from '../constants/chat.constants';
import { TIME } from '../../common/constants/time.constants';
import { UpdateChatInput } from '../type/chat.type';

import { RedisService } from '../../redis/service/redis.service';
import { NotificationService } from '../../notification/service/notification.service';

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
import { MessageType } from '../entity/message.entity';
import { ChatUtil } from '../util/chat.util';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { MessageService } from './message.service';
import { CallDetailsService } from './call-details.service';
import { CallLogService } from './call-log.service';
import { AiChatIntegrationService } from './ai-chat-integration.service';
import { ChatFeedbackService } from './chat-feedback.service';
import { ToggleArchiveStatusDto } from '../dto/toggle-archive-status.dto';
import { ScribeSessionReviewSharedService } from 'src/scribe-session-review/service/review-shared.service';
import { ReviewStatus } from 'src/review/type/review.type';
import { SettingsService } from '../../settings/service/settings.service';
import { ChatSummaryAttemptService } from './chat-summary-attempt.service';
import {
  ScribeAttemptOutcome,
  ScribeAttemptTrigger,
} from '../entity/chat-summary-attempt.entity';

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
    private readonly scribeSessionReviewSharedService: ScribeSessionReviewSharedService,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
    private readonly summaryAttemptService: ChatSummaryAttemptService,
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
    const chat = await this.chatRepository.findChatWithDetails(
      id,
      ExecutionManager.getTenantId()!,
    );
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }
    const decryptedCallDetails = await this.decryptCallDetails(chat.details);
    chat.details = decryptedCallDetails ?? ({} as CallDetails);

    const review =
      await this.scribeSessionReviewSharedService.getReviewByScribeSessionId(
        id,
      );
    if (review) {
      return {
        ...chat,
        reviewId: review.id,
        reviewStatus: review.status,
        reviewNote: review.note,
        reviewCreatedAt: review.createdAt,
        reviewUpdatedAt: review.updatedAt,
      };
    }
    return chat;
  }

  async createChatWithClientAndCounselor(
    params: {
      clientId: number;
      counselorId?: number;
      tenantId?: string;
      provider?: AudioChatProvider;
      platform?: AudioChatPlatform;
      mode?: ScribeSessionMode;
      isLinear16Encoded?: boolean;
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
      mode,
      isLinear16Encoded,
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
        mode: mode || ScribeSessionMode.SCRIBE,
        isLinear16Encoded,
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
      mode?: ScribeSessionMode;
      isLinear16Encoded?: boolean;
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

  /**
   * Creates an empty manual scribe note: a Chat with mode DICTATION and no
   * audio, so the organization's custom-field values can be attached to it.
   * Manual notes are hand-typed (not transcribed), so they are categorised as
   * Dictation. Returns the new chat id and its auto-generated name
   * (CALL-{id}-{date}).
   */
  async createNote(
    counselorId: number,
  ): Promise<{ chatId: number; name: string }> {
    const enabled = await this.settingsService.getScribeNoteCreationEnabled();
    if (!enabled) {
      throw new ForbiddenException(
        'Scribe note creation is not enabled for this organization',
      );
    }

    const now = new Date();

    const chat = await this.createChatForAnonymousClient({
      counselorId,
      provider: AudioChatProvider.MICROPHONE,
      mode: ScribeSessionMode.DICTATION,
      status: ChatStatus.ENDED,
      startedAt: now,
      endedAt: now,
    });

    if (!chat) {
      throw new HttpException(
        'Failed to create note',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // A manual note has no audio/transcript to summarise, so mark the summary as
    // resolved; otherwise the call-logs list would show it stuck on "Processing".
    await this.updateChat(chat.id, {
      summaryStatus: ChatSummaryStatus.SUCCESS,
    });

    return { chatId: chat.id, name: ChatUtil.getSummaryName(chat) };
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

    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });

    return this.messageService.getMessages(
      chatId,
      userId,
      chat,
      options,
      callDetails?.callInfo?.mode,
    );
  }

  /**
   * Save a manual scribe note's dictated transcript. Stores the text as the
   * note's transcript (a TEXT message on the note's DICTATION chat) so it shows
   * in the Transcript view when the note is opened later, and rebuilds the flat
   * `call_details.transcript`. Idempotent — re-sending replaces the transcript.
   */
  async setNoteTranscript(
    chatId: number,
    userId: number,
    transcript: string,
  ): Promise<{ success: boolean }> {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, tenantId: ExecutionManager.getTenantId() },
    });
    if (!chat) {
      throw new HttpException('Chat not found', 404);
    }

    const trimmed = (transcript ?? '').trim();
    if (!trimmed) {
      throw new HttpException('Transcript is empty', 400);
    }

    await this.messageService.replaceDictationTranscript(chat, trimmed);
    // Rebuild the flat, encrypted call_details.transcript from the messages so
    // it stays in sync with the messages-backed Transcript view.
    await this.callDetailsService.updateMessageStatistics(chat);

    this.logger.info(
      `setNoteTranscript - chatId:${chatId} by userId:${userId} (chars=${trimmed.length})`,
    );
    return { success: true };
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

  /**
   * Re-run summary generation from the chat's stored transcript (manual "Retry
   * summary" action). For chats whose transcript was saved but the summary
   * failed; reuses the same engine as the auto-retry cron.
   */
  async retrySummary(
    chatId: number,
  ): Promise<{ success: boolean; message: string; needsReprocess?: boolean }> {
    const result = await this.callDetailsService.retrySummary(chatId);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.SUMMARY_GENERATED,
      details: {
        chatId,
        trigger: 'manual-retry',
        success: result.success,
      },
    });

    return result;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    return this.aiChatIntegrationService.generateSummaryForMessage(
      messageRequests,
    );
  }

  async getCallLogs(
    user: TokenUser,
    options: Pagination,
    archive?: string,
    callName?: string,
  ) {
    return this.callLogService.getCallLogs(user, options, archive, callName);
  }

  async updateArchiveStatus(
    id: number,
    toggleArchiveStatusDto: ToggleArchiveStatusDto,
  ): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const chat = await this.chatRepository.findOne({
      where: { id, tenantId, counselorId: userId },
    });
    if (!chat) {
      throw new NotFoundException('Call log not found');
    }
    if (toggleArchiveStatusDto.archive) {
      const review =
        await this.scribeSessionReviewSharedService.getReviewByScribeSessionId(
          chat.id,
          ReviewStatus.IN_REVIEW,
        );
      if (review) {
        throw new BadRequestException(
          'Scribe session review already exists for this call log',
        );
      }
    }
    const updatedChat = this.chatRepository.create({
      ...chat,
      archivedAt: toggleArchiveStatusDto.archive ? new Date() : (null as any),
    });
    await this.chatRepository.save(updatedChat);

    return {
      success: true,
    };
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

  private static readonly PENDING_SUMMARY_STATUSES = [
    ChatSummaryStatus.PENDING,
    ChatSummaryStatus.IN_PROGRESS,
  ];

  /**
   * Finds chats stuck on "Processing": still PENDING/IN_PROGRESS with no update
   * for longer than the TTL. Keyed off updatedAt (not createdAt) so that
   * re-dispatching a stuck chat resets its clock and the reaper won't re-fail a
   * reprocess that is in flight.
   */
  async findStalePendingChats(): Promise<Chat[]> {
    const cutoff = new Date(
      Date.now() - CHAT_SUMMARY_TIMEOUT_MINUTES * TIME.MINUTE_IN_MS,
    );

    return this.chatRepository.find({
      where: {
        summaryStatus: In(ChatService.PENDING_SUMMARY_STATUSES),
        updatedAt: LessThan(cutoff),
      },
    });
  }

  /**
   * Chats eligible for the one-time reprocess backfill: created within the
   * lookback window and either (a) still stuck on Processing, or (b) already
   * failed by the timeout reaper. Including (b) makes the backfill independent
   * of reaper timing and safe to re-run. Older stuck chats are intentionally
   * excluded — their audio has very likely aged out of storage.
   */
  async findReprocessableStuckChats(): Promise<Chat[]> {
    const ttlCutoff = new Date(
      Date.now() - CHAT_SUMMARY_TIMEOUT_MINUTES * TIME.MINUTE_IN_MS,
    );
    const lookbackCutoff = new Date(
      Date.now() - CHAT_REPROCESS_LOOKBACK_DAYS * TIME.DAY_IN_MS,
    );

    const stuckOrTimedOut = await this.chatRepository.find({
      where: [
        {
          summaryStatus: In(ChatService.PENDING_SUMMARY_STATUSES),
          updatedAt: LessThan(ttlCutoff),
          createdAt: MoreThanOrEqual(lookbackCutoff),
        },
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: Raw((alias) => `${alias} ->> 'error' = :timeoutError`, {
            timeoutError: CHAT_SUMMARY_TIMEOUT_ERROR,
          }),
          createdAt: MoreThanOrEqual(lookbackCutoff),
        },
      ],
    });

    // (c) FAILED chats whose audio upload was never finalized (status still
    // 'pending'). These are the "upload never finalized" backlog: the live
    // stream ended abnormally so the S3 multipart upload was never completed
    // and transcription never ran. They can carry ANY error string (older
    // reaper text, DLQ, etc.), so the exact-timeout filter above misses them —
    // yet they are exactly the sessions the S3 salvage path can recover.
    // Bounded by the per-chat reprocess attempt cap so genuinely-unrecoverable
    // ones (parts already aged out of S3) are not retried forever.
    const unfinalizedAudio = await this.chatRepository
      .createQueryBuilder('chat')
      .where('chat.summaryStatus = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .andWhere('chat.createdAt >= :lookbackCutoff', { lookbackCutoff })
      .andWhere(
        `COALESCE((chat.metadata ->> 'reprocessAttempts')::int, 0) < :maxAttempts`,
        { maxAttempts: MAX_STUCK_REPROCESS_ATTEMPTS },
      )
      .andWhere(
        `EXISTS (
          SELECT 1 FROM chat_audio_uploads au
          WHERE au."chatId" = chat.id AND LOWER(au.status) = 'pending'
        )`,
      )
      .getMany();

    const byId = new Map<number, Chat>();
    for (const chat of [...stuckOrTimedOut, ...unfinalizedAudio]) {
      byId.set(chat.id, chat);
    }
    return Array.from(byId.values());
  }

  /**
   * Fallback reaper for chats stuck on "Processing". A chat only leaves the
   * PENDING/IN_PROGRESS summary state when the AI service posts a result back.
   * If that result is lost the chat would sit on "Processing" indefinitely, so
   * this marks any such chat older than the TTL as FAILED. Registered to run on
   * the shared scheduler (see ChatSchedulerRegistrationService).
   */
  async markStalePendingChatsAsFailed(): Promise<void> {
    const staleChats = await this.findStalePendingChats();

    if (staleChats.length === 0) return;

    // Per chat: if the transcript was already stored (two-phase delivery),
    // failing the summary is recoverable — mark it retryable so the auto-retry
    // cron / manual retry can regenerate the summary from the saved transcript.
    // Only chats with no transcript are a dead failure.
    const retryableIds: number[] = [];
    const deadIds: number[] = [];

    for (const chat of staleChats) {
      try {
        const hasTranscript =
          (await this.messageRepository.count({
            where: { chatId: chat.id, type: MessageType.TEXT },
          })) > 0;

        const existingMetadata =
          (chat.metadata as Record<string, any> | undefined) ?? {};

        // The status guard makes this a no-op if the chat raced to SUCCESS
        // (e.g. a late phase-2 summary landed) between selection and update —
        // so a slow-but-successful summary is never clobbered back to FAILED.
        const result = await this.chatRepository.update(
          {
            id: chat.id,
            summaryStatus: In(ChatService.PENDING_SUMMARY_STATUSES),
          },
          {
            summaryStatus: ChatSummaryStatus.FAILED,
            metadata: hasTranscript
              ? ({
                  ...existingMetadata,
                  error: CHAT_SUMMARY_TIMEOUT_ERROR,
                  // Tag the stage so failure analytics attribute timeouts as
                  // 'summary-timeout' rather than 'unknown' (matches the Slack
                  // alert's stage). Overrides any earlier in-flight stage.
                  stage: 'summary-timeout',
                  summaryRetryable: true,
                  summaryRetryAttempts: Number(
                    existingMetadata.summaryRetryAttempts ?? 0,
                  ),
                } as Record<string, any>)
              : ({
                  error: CHAT_SUMMARY_TIMEOUT_ERROR,
                  stage: 'summary-timeout',
                } as Record<string, any>),
          },
        );

        if (result.affected && result.affected > 0) {
          (hasTranscript ? retryableIds : deadIds).push(chat.id);
          // Record the timed-out attempt. A saved transcript means the session
          // reached diarization; otherwise it never got past the audio upload.
          await this.summaryAttemptService.recordAttempt({
            chatId: chat.id,
            tenantId: chat.tenantId,
            trigger:
              Number(existingMetadata.reprocessAttempts) > 0
                ? ScribeAttemptTrigger.REPROCESS
                : ScribeAttemptTrigger.INITIAL,
            outcome: ScribeAttemptOutcome.FAILED,
            phaseReached: ChatSummaryAttemptService.phaseForFailureStage(
              'summary-timeout',
              hasTranscript,
            ),
            failureStage: 'summary-timeout',
            failureReason: CHAT_SUMMARY_TIMEOUT_ERROR,
            correlationId: existingMetadata.correlationId ?? null,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to mark stale chat ${chat.id} as FAILED: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const total = retryableIds.length + deadIds.length;
    if (total > 0) {
      this.logger.info(
        `Marked ${total} stale chat(s) FAILED after the ${CHAT_SUMMARY_TIMEOUT_MINUTES}min summary TTL ` +
          `(retryable/transcript-saved: ${retryableIds.length}, no-transcript: ${deadIds.length})`,
      );
      await this.notificationService.notifyTranscriptionFailure({
        stage: 'summary-timeout',
        mode: 'summary-timeout',
        reason:
          `No summary within ${CHAT_SUMMARY_TIMEOUT_MINUTES} minutes. ` +
          `Retryable (transcript saved): ${retryableIds.length}; ` +
          `no transcript (check ally-ai logs by correlationId): ${deadIds.length}`,
        chatIds: [...retryableIds, ...deadIds],
      });
    }
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
    const review =
      await this.scribeSessionReviewSharedService.getReviewByScribeSessionId(
        chatId,
        ReviewStatus.IN_REVIEW,
      );
    if (review) {
      throw new BadRequestException('Chat is already in review process');
    }
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
        await this.scribeSessionReviewSharedService.deleteReviewByScribeSessionId(
          chatId,
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
