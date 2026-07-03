import { Injectable, HttpException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { CryptoService } from '../../common/service/crypto.service';
import { AppConfigService } from '../../config/config.service';
import { AuditLoggerService } from '../../audit/service/audit-logger.service';
import { PermissionValidator } from '../../authorization/service/permission-validator.service';
import { MessageRepository } from '../repository/message.repository';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ANONYMOUS_CLIENT_ID } from '../../common/constants/user.constants';
import { Pagination } from '../../common/type/common.type';
import { MessageWithFeedback } from '../type/chat.type';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { MessageType, Message } from '../entity/message.entity';
import { MessageFilter } from '../type/message.type';
import { ScribeSessionMode } from '../../common/constants/chat.constants';

@Injectable()
export class MessageService {
  private readonly logger = LoggerService.getInstance(MessageService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private messageRepository: MessageRepository,
    private cryptoService: CryptoService,
    private readonly config: AppConfigService,
    private permissionValidator: PermissionValidator,
  ) {}

  async getMessageByChatId(
    chatId: number,
    filter?: MessageFilter,
    entityManager?: EntityManager,
  ) {
    const { messages, count } =
      await this.messageRepository.getMessagesByChatIdQuery(
        chatId,
        ExecutionManager.getTenantId()!,
        filter,
        entityManager,
      );
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

  async getMessages(
    chatId: number,
    userId: number,
    chat: { clientId: number; counselorId?: number | null },
    options: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'ASC' | 'DESC';
    },
    mode?: ScribeSessionMode,
  ) {
    const {
      limit = 10,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = options;

    // Check if user has permission to view messages or is the participant of this chat
    const canViewMessages = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.VIEW_MESSAGES],
    );

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

    if (mode === ScribeSessionMode.DICTATION && messages.length > 0) {
      return this.concatenateMessages(messages);
    }

    return {
      data: messages.map((message) => this.formatMessage(message)),
      count,
      mode: mode || ScribeSessionMode.SCRIBE,
    };
  }

  /**
   * Store a manual scribe note's dictated transcript as the note's transcript.
   * The note's chat is DICTATION mode, so `getMessages` concatenates the TEXT
   * message rows into a single plain-text block for the Transcript view. We
   * keep the transcript as ONE encrypted TEXT message and REPLACE it on every
   * save: a note session can dictate several times (the caller accumulates the
   * full text and re-sends it), and replacing is idempotent under retries.
   *
   * Only TEXT rows are removed, so any non-transcript message types are left
   * untouched. Delete + insert run in a single transaction so a reader never
   * observes a note with no transcript mid-write.
   */
  async replaceDictationTranscript(
    chat: { id: number; counselorId?: number | null },
    transcript: string,
  ): Promise<void> {
    const tenantId = ExecutionManager.getTenantId()!;
    const encryptedContent = await this.cryptoService.encrypt(
      transcript,
      this.config.phiData?.phiDataEncryptionKey,
    );

    await this.messageRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(Message);
      await repo.delete({ chatId: chat.id, type: MessageType.TEXT, tenantId });
      await repo.save(
        repo.create({
          chatId: chat.id,
          senderId: chat.counselorId ?? undefined,
          type: MessageType.TEXT,
          content: encryptedContent,
          startSeconds: 0,
          tenantId,
        }),
      );
    });

    this.logger.info(
      `Replaced dictation transcript for chatId: ${chat.id} (chars=${transcript.length})`,
    );
  }

  async getChatHistoryForAIService(
    chatId: number,
    pagination?: Pagination,
    tenantId?: string,
  ) {
    const messages = await this.messageRepository.getChatHistoryQuery(
      chatId,
      tenantId ?? ExecutionManager.getTenantId()!,
      pagination,
    );

    const decryptedMessages = await this.decryptMessages(messages);

    const messageRequests: MessageRequest[] = decryptedMessages.map(
      (message: any) => ({
        // Sender role on the User entity doesn't exist as a column (roles are
        // resolved via UserGroup), so we can't read it from the join. In the
        // scribe/audio flow there are only two participants — anonymous client
        // and counselor — so any non-anonymous senderId is the counselor.
        role: message.senderId === ANONYMOUS_CLIENT_ID ? 'CLIENT' : 'COUNSELOR',
        content: message.content,
        start_time: message.startSeconds,
        end_time: message.endSeconds,
      }),
    );
    return messageRequests;
  }

  private concatenateMessages(messages: any[]) {
    const sortedMessages = [...messages].sort(
      (a, b) => (a.startSeconds || 0) - (b.startSeconds || 0),
    );
    const concatenatedContent = sortedMessages
      .map((message) => message.content)
      .join(' ');

    const firstMessage = sortedMessages[0];
    const lastMessage = sortedMessages[sortedMessages.length - 1];

    return {
      data: [
        {
          ...this.formatMessage(firstMessage),
          content: concatenatedContent,
          endSeconds: lastMessage.endSeconds,
        },
      ],
      count: 1,
      mode: ScribeSessionMode.DICTATION,
    };
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
}
