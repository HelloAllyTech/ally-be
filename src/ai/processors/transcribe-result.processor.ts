import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from './base-processor.interface';
import { LoggerService } from '../../logger/logger.service';
import { ChatAiService } from '../../chat/service/chat-ai-service';
import axios from 'axios';
import { TranscribeAndSummarizeResponseMessage } from '../dto/transcribe-and-summarize-response.model';
import { ChatService } from 'src/chat/service/chat.service';
import { ChatSummaryStatus } from 'src/common/entities/chat.entity';
import { FailedDependencyException } from 'src/exception/custom.exception';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class TranscribeResultProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    TranscribeResultProcessor.name,
  );

  constructor(
    private readonly chatAiService: ChatAiService,
    private readonly chatService: ChatService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  getEventType(): string {
    return 'transcribe_and_summarize_response';
  }

  async process(data: TranscribeAndSummarizeResponseMessage): Promise<void> {
    const { chat_id, download_presigned_url, delete_presigned_url, error } =
      data;

    this.logInfo(`Processing transcription result for chat: ${chat_id}`);
    this.logger.debug(`S3 Result Path: ${download_presigned_url}`);

    try {
      const chat = await this.chatService.getChatByIdForServiceCall(chat_id);
      if (!chat) {
        this.logInfo(`Chat not found: ${chat_id}`);
        if (!this.config.isDevelopment && delete_presigned_url) {
          // Delete the result from S3
          await this.deleteFromS3(delete_presigned_url);
        }
        return;
      }

      if (chat.summaryStatus === ChatSummaryStatus.SUCCESS) {
        this.logInfo(`Chat already has a summary: ${chat_id}`);
        return;
      }

      if (error) {
        this.logInfo(`Error from AI service: ${error}`);
        throw new FailedDependencyException(data);
      }

      if (download_presigned_url) {
        // Download the result from S3
        const s3Result = await this.downloadFromS3(download_presigned_url);

        // Add the transcription to the chat
        await this.chatAiService.addTranscript(chat, s3Result.transcription);

        // Add the summary to the chat
        await this.chatAiService.addSummary(chat_id, s3Result.summary);
      }

      if (!this.config.isDevelopment && delete_presigned_url) {
        // Delete the result from S3
        await this.deleteFromS3(delete_presigned_url);
      }

      await this.chatService.updateChat(chat_id, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });
    } catch (error) {
      this.logger.error(
        `Failed to process transcription result for chat ${chat_id} with error ${JSON.stringify(
          error,
        )}`,
      );
      await this.chatService.updateChat(chat_id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: { error },
      });
      throw error;
    }
  }

  private async downloadFromS3(s3Path: string): Promise<any> {
    try {
      this.logger.debug(`Downloading from S3: ${s3Path}`);
      const response = await axios.get(s3Path);
      this.logger.info(`Downloaded from S3: ${s3Path}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to download from S3: ${s3Path} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw new Error(`S3 download failed: ${error.message}`);
    }
  }

  private async deleteFromS3(deleteUrl: string): Promise<void> {
    try {
      this.logger.debug(`Deleting from S3: ${deleteUrl}`);
      await axios.delete(deleteUrl);
      this.logger.info(`Successfully deleted S3 file: ${deleteUrl}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete from S3: ${deleteUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
    }
  }
}
