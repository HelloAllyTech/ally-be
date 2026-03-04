import { Message } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { AudioUploadService } from '../service/audio-upload.service';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class AudioUploadConsumer {
  private readonly logger = LoggerService.getInstance(AudioUploadConsumer.name);

  constructor(private readonly audioUploadService: AudioUploadService) {}

  async handleAudioUpload(message: Message): Promise<void> {
    if (!message.Body) {
      this.logger.error('Empty message in audio upload queue');
      return;
    }
    try {
      const s3Event = JSON.parse(message.Body);
      const record = s3Event?.Records?.[0];

      if (record.eventName.startsWith('ObjectCreated:')) {
        const s3Key = record?.s3?.object?.key;
        if (!s3Key) {
          this.logger.error('S3 key is empty in audio upload queue message');
          return;
        }
        await this.audioUploadService.processAudioUpload(s3Key);
      }
    } catch (error) {
      this.logger.error(`Failed to process audio upload: ${error.message}`);
    }
  }
}
