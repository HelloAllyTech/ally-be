import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { ChatAiService } from './chat-ai-service';
import { ChatService } from './chat.service';
import { LoggerService } from 'src/logger/logger.service';
import { ChatSummaryStatus } from '../entity/chat.entity';
import axios from 'axios';
import { FailedDependencyException } from 'src/exception/custom.exception';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { FlattenedSummaryNotePayload } from '../type/call.details.type';

@Injectable()
export class ChatTranscriptService {
  logger = LoggerService.getInstance(ChatTranscriptService.name);

  constructor(
    private readonly chatAiService: ChatAiService,
    private readonly chatService: ChatService,
    private readonly config: AppConfigService,
  ) {}

  async processTranscribeResult(params: {
    chatId: number;
    transcription?: MessageRequest[];
    summary?: FlattenedSummaryNotePayload;
    downloadPresignedUrl?: string;
    deletePresignedUrl?: string;
    error?: string;
  }): Promise<void> {
    const {
      chatId,
      transcription,
      summary,
      downloadPresignedUrl,
      deletePresignedUrl,
      error,
    } = params;

    this.logger.info(`Processing transcription result for chat: ${chatId}`);
    this.logger.debug(`S3 Result Path: ${downloadPresignedUrl}`);
    try {
      const chat = await this.chatService.getChatByIdForServiceCall(chatId);
      if (!chat) {
        this.logger.info(`Chat not found: ${chatId}`);
        if (!this.config.isDevelopment && downloadPresignedUrl) {
          // Delete the result from S3
          await this.deleteFromS3(downloadPresignedUrl);
        }
        return;
      }

      if (chat.summaryStatus === ChatSummaryStatus.SUCCESS) {
        this.logger.info(`Chat already has a summary: ${chatId}`);
        return;
      }

      if (error) {
        this.logger.info(`Error from AI service: ${error}`);
        throw new FailedDependencyException(params);
      }
      if (transcription && summary) {
        await this.chatAiService.addTranscript(chat, transcription);

        await this.chatAiService.addSummary(chatId, summary);
      } else if (downloadPresignedUrl) {
        // Download the result from S3
        const s3Result = await this.downloadFromS3(downloadPresignedUrl);

        // Add the transcription to the chat
        await this.chatAiService.addTranscript(chat, s3Result.transcription);

        // Add the summary to the chat
        await this.chatAiService.addSummary(chatId, s3Result.summary);
      }

      if (!this.config.isDevelopment && deletePresignedUrl) {
        // Delete the result from S3
        await this.deleteFromS3(deletePresignedUrl);
      }

      await this.chatService.updateChat(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });
    } catch (error) {
      this.logger.error(
        `Failed to process transcription result for chat ${chatId} with error ${JSON.stringify(
          error,
        )}`,
      );
      await this.chatService.updateChat(chatId, {
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
