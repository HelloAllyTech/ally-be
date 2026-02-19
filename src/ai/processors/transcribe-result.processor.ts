import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from './base-processor.interface';
import { LoggerService } from '../../logger/logger.service';
import { TranscribeAndSummarizeResponseMessage } from '../dto/transcribe-and-summarize-response.model';
import { AppConfigService } from 'src/config/config.service';
import { ChatTranscriptService } from '../../chat/service/chat-transcript.service';
import { PROCESSOR_EVENT_TYPES } from '../constants/processor.constants';

@Injectable()
export class TranscribeResultProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    TranscribeResultProcessor.name,
  );

  constructor(
    private readonly chatTranscriptService: ChatTranscriptService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.TRANSCRIBE_AND_SUMMARIZE_RESPONSE;
  }

  async process(data: TranscribeAndSummarizeResponseMessage): Promise<void> {
    const { chat_id, download_presigned_url, delete_presigned_url, error } =
      data;

    this.logInfo(`Processing transcription result event for chat: ${chat_id}`);
    await this.chatTranscriptService.processTranscribeResult({
      chatId: chat_id,
      downloadPresignedUrl: download_presigned_url,
      deletePresignedUrl: delete_presigned_url,
      error: error,
    });
  }
}
