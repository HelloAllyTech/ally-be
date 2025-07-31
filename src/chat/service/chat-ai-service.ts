import { Injectable, NotFoundException } from '@nestjs/common';
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
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { ChatAudioUploadsService } from 'src/audio/service/chat-audio-uploads.service';

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
  ) {}

  private readonly logger = LoggerService.getInstance(ChatAiService.name);

  async addSummary(chatId: number, summary: FlattenedSummaryNotePayload) {
    try {
      this.logger.info(`Adding summary for chatId: ${chatId} from ai service`);
      const chat = await this.chatService.getChatByIdForServiceCall(chatId);
      if (!chat) {
        throw new NotFoundException('Chat not found');
      }
      const convertedResponse = CommonUtil.convertToCamelCase(
        summary,
      ) as FlattenedSummaryNotePayloadCamelCase;
      await this.callDetailsRepository.update(
        { chatId },
        {
          summary: convertedResponse,
        },
      );
      this.logger.info(`Summary added for chatId: ${chatId} from ai service`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error adding summary for chatId: ${chatId} from ai service`,
        error,
      );
      throw new ValidationException('Error adding summary');
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async addTranscript(chatId: number, messages: MessageRequest[]) {
    try {
      this.logger.info(
        `Adding transcript for chatId: ${chatId} from ai service`,
      );
      const chat = await this.chatService.getChatByIdForServiceCall(chatId);
      if (!chat) {
        throw new NotFoundException('Chat not found');
      }
      this.setAuthContext({
        userId: chat.counselorId!,
        role: UserRole.COUNSELOR,
        tenantId: chat.tenantId,
      });
      const formattedMessages = messages.map((message) =>
        this.messageRepository.create({
          chatId,
          senderId:
            message.role === UserRole.CLIENT ? chat.clientId : chat.counselorId,
          type: MessageType.TEXT,
          content: message.content,
          startSeconds: message.start_time,
          endSeconds: message.end_time,
          tenantId: ExecutionManager.getTenantId(),
        }),
      );
      await this.messageRepository.save(formattedMessages);
      // update message statistics
      this.chatService.updateMessageStatistics(chat);
      this.logger.info(
        `Transcript added for chatId: ${chatId} from ai service`,
      );
      const uploadedAudioFile =
        await this.chatAudioUploadsService.getAudioUpload(chatId);
      if (uploadedAudioFile && uploadedAudioFile.storageKey) {
        this.logger.info(
          `Deleting audio file for chatId: ${chatId} from ai service`,
        );
        await this.s3Service.deleteObject({
          bucket: this.config.s3.audioBucket!,
          key: uploadedAudioFile.storageKey,
        });
        await this.chatAudioUploadsService.updateAudioUpload(chatId, {
          storageKey: null,
          sampleRate: null,
          format: null,
        });
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Error adding transcript for chatId: ${chatId} from ai service`,
        error,
      );
      throw new ValidationException('Error adding transcript');
    }
  }

  setAuthContext(context: {
    userId: number;
    role: UserRole;
    tenantId: string;
  }) {
    ExecutionManager.setAuthContext(
      context.userId.toString(),
      context.role,
      context.tenantId,
    );
  }
}
