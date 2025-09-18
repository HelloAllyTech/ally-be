import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsDlqListener } from '../../aws/decorators/sqs-listener.decorator';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from '../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../common/entities/chat.entity';

@Injectable()
export class AudioRetryDlqConsumer {
  private readonly logger = LoggerService.getInstance(
    AudioRetryDlqConsumer.name,
  );
  constructor(private readonly chatService: ChatService) {}

  @SqsDlqListener(process.env.SQS_AUDIO_FILE_RETRY_DLQ_URL!)
  async handleAudioFileRetryDlq(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage = JSON.parse(message.Body);

      this.logger.info(
        `Processing audio file retry DLQ message for chat ${responseMessage.chatId}`,
      );

      await this.chatService.updateChat(responseMessage.chat_id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessage,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to audio file retry DLQ message for message ${message.MessageId}: with error ${JSON.stringify(
          err,
        )}`,
      );
      throw err; // Re-throw to prevent message deletion
    }
  }
}
