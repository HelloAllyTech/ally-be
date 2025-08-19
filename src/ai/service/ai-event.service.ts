import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { SqsService } from '../../aws/service/sqs.service';
import { ChatService } from '../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../common/entities/chat.entity';
import { TranscribeAndSummarizeRequestMessage } from '../dto/transcribe-and-summarize-request.model';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class AiEventService {
  private readonly logger = LoggerService.getInstance(AiEventService.name);

  constructor(
    private readonly sqsService: SqsService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly configService: AppConfigService,
  ) {}

  async publishTranscribeAudioEvent(
    event: TranscribeAndSummarizeRequestMessage,
  ): Promise<void> {
    try {
      const requestQueueUrl =
        this.configService.sqs.transcription.requestQueueUrl || '';

      await this.sqsService.sendMessage(requestQueueUrl, event);

      await this.chatService.updateChat(event.chat_id, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      });
      this.logger.info(
        `Transcribe and summarize request published for chat ${event.chat_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish transcribe and summarize request for chat ${event.chat_id}:`,
        error,
      );
      throw error;
    }
  }
}
