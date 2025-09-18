import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { SqsService } from '../../aws/service/sqs.service';
import { MAX_RETRY_DELAY_SECONDS } from '../constants/audio-retry-constants';
import { AudioRetryMessage } from '../type/audio.retry.type';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class AudioRetryProducer {
  private readonly logger = LoggerService.getInstance(AudioRetryProducer.name);
  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: AppConfigService,
  ) {}

  async sendAudioFileRetryMessage(message: AudioRetryMessage): Promise<void> {
    const audioFileRetryQueueUrl =
      this.configService.sqs.audioFile.retryQueueUrl;
    if (!audioFileRetryQueueUrl) {
      throw new Error('Audio file retry queue URL is not configured');
    }
    const { chatId, retryCount } = message;
    this.logger.info(
      `Sending audio file retry message for chat ${chatId} | retryCount: ${retryCount}`,
    );
    // for sqs delay queue, max delay time is 15 minutes
    const delaySeconds = Math.min(
      2 ** (retryCount + 1) * 60,
      MAX_RETRY_DELAY_SECONDS,
    );
    await this.sqsService.sendMessage(audioFileRetryQueueUrl, message, {
      DelaySeconds: delaySeconds,
    });
  }
}
