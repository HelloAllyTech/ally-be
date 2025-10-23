import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CallDetails } from '../../common/entities/call.details.entity';
import {
  FlattenedSummaryNotePayload,
  FlattenedSummaryNotePayloadCamelCase,
} from '../../common/entities/type/call.details.type';
import { CommonUtil } from '../../common/util/common.util';
import { ChatService } from './chat.service';
import { Message, MessageType } from '../../common/entities/message.entity';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { UserRole } from '../../common/constants/user.constants';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from '../../logger/logger.service';
import { ValidationException } from '../../exception/custom.exception';
import { CryptoService } from '../../common/service/crypto.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';
import { Chat } from 'src/common/entities/chat.entity';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { UserService } from 'src/user/service/user.service';
import { NotificationService } from 'src/notification/service/notification.service';

@Injectable()
export class ChatAiService {
  constructor(
    @InjectRepository(CallDetails)
    private readonly callDetailsRepository: Repository<CallDetails>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly config: AppConfigService,
    private readonly chatAudioUploadsService: ChatAudioUploadsService,
    private readonly cryptoService: CryptoService,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
  ) {}

  private readonly logger = LoggerService.getInstance(ChatAiService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async addSummary(chatId: number, summary: FlattenedSummaryNotePayload) {
    try {
      this.logger.info(`Adding summary for chatId: ${chatId} from ai service`);

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.SUMMARY_RECEIVED,
        details: {
          chatId,
        },
      });

      const chat = await this.chatService.getChatByIdForServiceCall(chatId);

      if (!chat) {
        throw new ValidationException('Chat not found');
      }

      const convertedResponse = CommonUtil.convertToCamelCase(
        summary,
      ) as FlattenedSummaryNotePayloadCamelCase;
      if (convertedResponse.sessionSummary) {
        convertedResponse.sessionSummary = await this.cryptoService.encrypt(
          convertedResponse.sessionSummary,
          this.config.phiData?.phiDataEncryptionKey,
        );
      }

      await this.callDetailsRepository.update(
        { chatId },
        {
          summary: convertedResponse,
        },
      );

      this.setAuthContext({
        userId: chat.counselorId!,
        tenantId: chat.tenantId,
      });

      if (!chat.counselorId) {
        this.logger.error(`Counselor id is not set for chatId: ${chatId}`);
        return true;
      }

      const counselor = await this.userService.get(chat.counselorId);

      if (!counselor) {
        this.logger.error(`Counselor not found for chatId: ${chatId}`);
        return true;
      }

      const { callDetails } =
        await this.chatService.getChatWithCallDetails(chatId);

      await this.notificationService.sendEmailSummaryNotification({
        to: counselor.email,
        chatId,
        summaryName: callDetails?.callInfo?.summaryName,
      });
      this.logger.info(`Summary added for chatId: ${chatId} from ai service`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error adding summary for chatId: ${chatId} from ai service with error ${JSON.stringify(
          error,
        )}`,
      );
      throw new ValidationException('Error adding summary');
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async addTranscript(chat: Chat, messages: MessageRequest[]) {
    try {
      this.logger.info(
        `Adding transcript for chatId: ${chat.id} from ai service`,
      );

      this.setAuthContext({
        userId: chat.counselorId!,
        tenantId: chat.tenantId,
      });

      const formattedMessages = messages.map(async (message) => {
        const encryptedContent = await this.cryptoService.encrypt(
          message.content,
          this.config.phiData?.phiDataEncryptionKey,
        );
        return this.messageRepository.create({
          chatId: chat.id,
          senderId:
            message.role === UserRole.CLIENT ? chat.clientId : chat.counselorId,
          type: MessageType.TEXT,
          content: encryptedContent,
          startSeconds: message.start_time,
          endSeconds: message.end_time,
          tenantId: ExecutionManager.getTenantId(),
        });
      });
      const createdMessages = await Promise.all(formattedMessages);
      await this.messageRepository.save(createdMessages);
      // update message statistics
      this.chatService.updateMessageStatistics(chat);

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.TRANSCRIPT_RECEIVED,
        details: {
          chatId: chat.id,
        },
      });
      this.logger.info(
        `Transcript added for chatId: ${chat.id} from ai service`,
      );
      const uploadedAudioFile =
        await this.chatAudioUploadsService.getAudioUpload(chat.id);
      if (
        !this.config.isDevelopment &&
        uploadedAudioFile &&
        uploadedAudioFile.storageKey
      ) {
        this.logger.info(
          `Deleting audio file for chatId: ${chat.id} from ai service`,
        );
        await this.s3Service.deleteObject({
          bucket: this.config.s3.audioBucket!,
          key: uploadedAudioFile.storageKey,
        });
        await this.chatAudioUploadsService.updateAudioUpload(chat.id, {
          storageKey: null,
          sampleRate: null,
          format: null,
        });
        this.auditLogger.log({
          eventType: AUDIT_EVENTS.AUDIO_UPLOAD_CLEANUP_S3_FILES,
          tenantId: chat.tenantId,
          userId: chat.counselorId!,
          details: {
            chatId: chat.id,
          },
        });
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Error adding transcript for chatId: ${chat.id} from ai service with error ${JSON.stringify(
          error,
        )}`,
      );
      throw new ValidationException('Error adding transcript');
    }
  }

  setAuthContext(context: { userId: number; tenantId: string }) {
    ExecutionManager.setAuthContext(
      context.userId.toString(),
      context.tenantId,
    );
  }
}
