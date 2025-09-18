import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsListener } from '../../aws/decorators/sqs-listener.decorator';
import { AudioRetryMessage } from '../type/audio.retry.type';
import { LoggerService } from '../../logger/logger.service';
import { checkAudioFileReady } from '../../common/util/audio.util';
import { MAX_RETRY_COUNT } from '../constants/audio-retry-constants';
import { AudioRetryProducer } from '../producer/audio-retry.producer';
import { AiEventService } from '../../ai/service/ai-event.service';
import { ChatService } from '../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../common/entities/chat.entity';

@Injectable()
export class AudioRetryConsumer {
  private readonly logger = LoggerService.getInstance(AudioRetryConsumer.name);

  constructor(
    private readonly audioRetryProducer: AudioRetryProducer,
    private readonly aiEventService: AiEventService,
    private readonly chatService: ChatService,
  ) {}

  @SqsListener(process.env.SQS_AUDIO_FILE_RETRY_QUEUE_URL!)
  async handleAudioFileRetry(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage: AudioRetryMessage = JSON.parse(message.Body);

      const { chatId, audioUrl, retryCount } = responseMessage || {};

      if (!chatId || !audioUrl) {
        this.logger.error(
          `Invalid audio file retry message: chatId: ${chatId}`,
        );
        return;
      }

      this.logger.info(
        `Processing audio file retry message for chat ${chatId} | retryCount: ${retryCount}`,
      );

      const isReady = await checkAudioFileReady(audioUrl);
      if (isReady) {
        this.logger.info(`Audio file is ready for chat ${chatId}`);
        this.aiEventService.publishTranscribeAudioEvent({
          message_type: 'transcribe_and_summarize_request',
          timestamp: Date.now(),
          audio_url: audioUrl,
          chat_id: chatId,
        });
      } else if (retryCount < MAX_RETRY_COUNT) {
        this.logger.info(
          `Audio file is not ready for chat ${chatId} and retrying | retryCount: ${retryCount}`,
        );
        this.audioRetryProducer.sendAudioFileRetryMessage({
          audioUrl,
          chatId,
          retryCount: retryCount + 1,
        });
      } else {
        this.logger.error(
          `Audio file is not ready for chat ${chatId} and max retry count reached`,
        );
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            error: 'Audio file is not ready',
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to process message ${message.MessageId}: ${JSON.stringify(error)}`,
      );
    }
  }
}
