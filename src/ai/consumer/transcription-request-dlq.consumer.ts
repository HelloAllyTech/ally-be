import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from 'src/chat/service/chat.service';
import { ChatSummaryStatus } from 'src/chat/entity/chat.entity';
import { SqsDlqListener } from '../../aws/decorators/sqs-listener.decorator';

@Injectable()
export class TranscriptionRequestDlqConsumer {
  private readonly logger = LoggerService.getInstance(
    TranscriptionRequestDlqConsumer.name,
  );

  constructor(private readonly chatService: ChatService) {}

  // TODO: Remove this once we have a proper way to handle DLQ messages
  @SqsDlqListener(process.env.SQS_TRANSCRIPTION_REQUEST_DLQ_URL!)
  async handleTranscriptionRequestDlq(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage = JSON.parse(message.Body);

      this.logger.info(
        `Processing transcription request DLQ message: ${responseMessage.message_type} for chat ${responseMessage.chat_id}`,
      );

      await this.chatService.updateChat(responseMessage.chat_id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessage,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to process message ${message.MessageId}: with error ${JSON.stringify(
          err,
        )}`,
      );
      throw err; // Re-throw to prevent message deletion
    }
  }
}
