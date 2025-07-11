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

@Injectable()
export class ChatAiService {
  constructor(
    @InjectRepository(CallDetails)
    private readonly callDetailsRepository: Repository<CallDetails>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    private readonly chatService: ChatService,
  ) {}

  private readonly logger = LoggerService.getInstance(ChatAiService.name);

  async addSummary(chatId: number, summary: FlattenedSummaryNotePayload) {
    const convertedResponse = CommonUtil.convertToCamelCase(
      summary,
    ) as FlattenedSummaryNotePayloadCamelCase;
    this.logger.info(`Adding summary for chatId: ${chatId} from ai service`);
    await this.callDetailsRepository.update(
      { chatId },
      {
        summary: convertedResponse,
      },
    );
    return true;
  }

  async addTranscript(chatId: number, messages: MessageRequest[]) {
    this.logger.info(`Adding transcript for chatId: ${chatId} from ai service`);
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    const formattedMessages = messages.map((message) => ({
      chatId,
      senderId:
        message.role === UserRole.CLIENT ? chat.clientId : chat.counselorId,
      type: MessageType.TEXT,
      content: message.content,
      startSeconds: message.start_time,
      endSeconds: message.end_time,
    }));
    await this.messageRepository.save(formattedMessages);
    // update message statistics
    this.chatService.updateMessageStatistics(chat);
    return true;
  }
}
