import { Message } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ChatService } from '../service/chat.service';
import { S3Service } from 'src/aws/service/s3.service';
import { AudioChatProvider } from 'src/common/constants/chat.constants';
import { ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';
import { NotificationService } from '../../notification/service/notification.service';

@Injectable()
export class AudioUploadDlqConsumer {
  private readonly logger = LoggerService.getInstance(
    AudioUploadDlqConsumer.name,
  );

  constructor(
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly notificationService: NotificationService,
  ) {}

  async handleAudioUploadDlq(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.error('Empty message in audio upload DLQ');
      return;
    }

    try {
      const responseMessage = JSON.parse(message.Body);
      const record = responseMessage.Records[0];
      if (record?.eventName?.startsWith('ObjectCreated:')) {
        const s3Key = record?.s3?.object?.key;
        if (!s3Key) {
          this.logger.error('S3 key is empty in audio upload DLQ message');
          return;
        }
        const metadata = await this.s3Service.getHeadObject({
          bucket: process.env.AUDIO_STORAGE_S3_BUCKET!,
          key: s3Key,
        });
        const { chatId, provider } = metadata.Metadata as {
          chatId: string;
          provider: string;
        };
        if (
          !chatId ||
          !provider ||
          provider !== AudioChatProvider.AUDIO_UPLOAD
        ) {
          this.logger.error(
            'Invalid file metadata in audio upload DLQ message',
          );
          return;
        }
        const chat = await this.chatService.getChatByIdForServiceCall(+chatId);
        if (chat) {
          await this.chatService.updateChat(chat.id, {
            status: ChatStatus.CANCELLED,
            summaryStatus: ChatSummaryStatus.FAILED,
            metadata: {
              dlq_message: responseMessage,
            },
          });

          await this.notificationService.notifyTranscriptionFailure({
            chatId: chat.id,
            stage: 'audio-upload-dlq',
            reason:
              'Audio upload event exhausted retries and landed in the DLQ',
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process audio upload DLQ: ${error.message}`);
    }
  }
}
