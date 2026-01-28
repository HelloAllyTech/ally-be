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

    return {
      data: messages.map((message) => this.formatMessage(message)),
      count,
    };
  }

  async getChatHistoryForAIService(chatId: number, pagination?: Pagination) {
    const messages = await this.messageRepository.getChatHistoryQuery(
      chatId,
      ExecutionManager.getTenantId()!,
      pagination,
    );

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
