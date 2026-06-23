import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerService } from '../../logger/logger.service';
import { SqsService } from '../../aws/service/sqs.service';
import { ChatService } from '../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
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
    // Mint a trace id (unless the caller already supplied one) and carry it on
    // the SQS message. ally-ai echoes it back on the result callback, so a
    // single chat's transcription can be grepped end-to-end across services.
    const correlationId = event.correlation_id ?? randomUUID();
    const message: TranscribeAndSummarizeRequestMessage = {
      ...event,
      correlation_id: correlationId,
    };

    try {
      const requestQueueUrl =
        this.configService.sqs.transcription.requestQueueUrl || '';

      await this.sqsService.sendMessage(requestQueueUrl, message);

      await this.chatService.updateChat(event.chat_id, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
        metadata: { correlationId } as Record<string, any>,
      });
      this.logger.info(
        `Transcribe and summarize request published for chat ${event.chat_id} correlationId=${correlationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish transcribe and summarize request for chat ${event.chat_id} correlationId=${correlationId} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }
}
