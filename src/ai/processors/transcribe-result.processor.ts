import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from './base-processor.interface';
import { LoggerService } from '../../logger/logger.service';
import { ChatAiService } from '../../chat/service/chat-ai-service';
import axios from 'axios';
import { TranscribeAndSummarizeResponseMessage } from '../dto/transcribe-and-summarize-response.model';
import { ChatService } from 'src/chat/service/chat.service';
import { ChatSummaryStatus } from 'src/common/entities/chat.entity';
import { FailedDependencyException } from 'src/exception/custom.exception';

@Injectable()
export class TranscribeResultProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    TranscribeResultProcessor.name,
  );

  constructor(
    private readonly chatAiService: ChatAiService,
    private readonly chatService: ChatService,
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
      if (error) {
        this.logInfo(`Error from AI service: ${error}`);
        throw new FailedDependencyException(data);
      }

      if (download_presigned_url) {
        this.logInfo(`Downloading results from S3: ${download_presigned_url}`);
        const s3Result = await this.downloadFromS3(download_presigned_url);

        this.logInfo(`Parsing JSON results for chat: ${chat_id}`);
        const { transcription, summary } = this.parseS3Result(s3Result);

        this.logInfo(`Adding transcription for chat: ${chat_id}`);
        await this.chatAiService.addTranscript(chat_id, transcription);

        this.logInfo(`Adding summary for chat: ${chat_id}`);
        await this.chatAiService.addSummary(chat_id, summary);

        this.logInfo(`Transcription and summary added to chat: ${chat_id}`);
      }

      if (delete_presigned_url) {
        this.logInfo(`Cleaning up S3 file for chat: ${chat_id}`);
        await this.deleteFromS3(delete_presigned_url);
        this.logInfo(`S3 file cleaned up for chat: ${chat_id}`);
      }

      await this.chatService.updateChat(chat_id, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });
    } catch (error) {
      this.logError(
        `Failed to process transcription result for chat ${chat_id}`,
        error,
      );
      await this.chatService.updateChat(chat_id, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: { message: error },
      });
      throw error;
    }
  }

  private async downloadFromS3(s3Path: string): Promise<any> {
    try {
      this.logger.debug(`Downloading from S3: ${s3Path}`);
      const response = await axios.get(s3Path);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to download from S3: ${s3Path}`, error);
      throw new Error(`S3 download failed: ${error.message}`);
    }
  }

  private async deleteFromS3(deleteUrl: string): Promise<void> {
    try {
      this.logger.debug(`Deleting from S3: ${deleteUrl}`);
      await axios.delete(deleteUrl);
      this.logger.debug(`Successfully deleted S3 file: ${deleteUrl}`);
    } catch (error) {
      this.logger.error(`Failed to delete from S3: ${deleteUrl}`, error);
      this.logger.warn(`S3 deletion failed but continuing: ${error.message}`);
    }
  }

  private parseS3Result(s3Result: any): { transcription: any; summary: any } {
    try {
      const transcription = s3Result.transcription || [];
      const summary = s3Result.summary || {};

      this.logger.debug(
        `Parsed transcription with ${transcription.length || 0} messages`,
      );
      this.logger.debug(
        `Parsed summary: ${summary.session_summary || 'No summary'}`,
      );

      return {
        transcription,
        summary,
      };
    } catch (error) {
      this.logger.error('Failed to parse S3 result', error);
      throw new Error(`JSON parsing failed: ${error.message}`);
    }
  }
}
