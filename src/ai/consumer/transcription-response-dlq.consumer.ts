import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from 'src/chat/service/chat.service';
import { ChatSummaryStatus } from 'src/chat/entity/chat.entity';
import { SqsDlqListener } from '../../aws/decorators/sqs-listener.decorator';

@Injectable()
export class TranscriptionResponseDlqConsumer {
  private readonly logger = LoggerService.getInstance(
    TranscriptionResponseDlqConsumer.name,
  );

  constructor(private readonly chatService: ChatService) {}

  @SqsDlqListener(process.env.SQS_TRANSCRIPTION_RESPONSE_DLQ_URL!)
  async handleTranscriptionResponseDlq(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage = JSON.parse(message.Body);

      this.logger.info(
        `Processing transcription response DLQ message: ${responseMessage.message_type} for chat ${responseMessage.chat_id}`,
      );

      await this.chatService.updateChat(responseMessage.chat_id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessage,
        },
      });

      this.logger.info(
        `Updated chat ${responseMessage.chat_id} status to FAILED due to transcription response DLQ`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${message.MessageId}: with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error; // Re-throw to prevent message deletion
    }
  }
}
