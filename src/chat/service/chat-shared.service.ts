import { Injectable } from '@nestjs/common';
import { ChatRepository } from '../repository/chat.repository';
import { CounselorStatsQueryDto } from 'src/analytics/dto/analytics.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Chat, ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';
import { MessageService } from './message.service';
import { MessageFilter } from '../type/message.type';
import { IsNull } from 'typeorm';

@Injectable()
export class ChatSharedService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly messageService: MessageService,
  ) {}

  async getCounselorStatsRaw(
    queryParams: CounselorStatsQueryDto,
    userId: number,
  ): Promise<any> {
    return this.chatRepository.getCounselorStatsRaw(queryParams, userId);
  }

  async getCompletedChatById(
    chatId: number,
    userId?: number,
  ): Promise<Chat | null> {
    return this.chatRepository.findOne({
      where: {
        id: chatId,
        counselorId: userId ? userId : undefined,
        tenantId: ExecutionManager.getTenantId(),
        status: ChatStatus.ENDED,
        summaryStatus: ChatSummaryStatus.SUCCESS,
        archivedAt: IsNull(),
      },
    });
  }

  async getMessagesByChatId(chatId: number, options?: MessageFilter) {
    return this.messageService.getMessageByChatId(chatId, options);
  }
}
