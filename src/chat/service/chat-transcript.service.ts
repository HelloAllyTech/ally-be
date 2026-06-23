import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { ChatAiService } from './chat-ai-service';
import { ChatService } from './chat.service';
import { LoggerService } from 'src/logger/logger.service';
import { Chat, ChatSummaryStatus } from '../entity/chat.entity';
import axios from 'axios';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { FlattenedSummaryNotePayload } from '../type/call.details.type';
import { CallDetailsService } from './call-details.service';
import { NotificationService } from '../../notification/service/notification.service';

@Injectable()
export class ChatTranscriptService {
  logger = LoggerService.getInstance(ChatTranscriptService.name);

  constructor(
    private readonly chatAiService: ChatAiService,
    private readonly chatService: ChatService,
    private readonly config: AppConfigService,
    @Inject(forwardRef(() => CallDetailsService))
    private readonly callDetailsService: CallDetailsService,
    private readonly notificationService: NotificationService,
  ) {}

  async processTranscribeResult(params: {
    chatId: number;
    transcription?: MessageRequest[];
    summary?: FlattenedSummaryNotePayload;
    downloadPresignedUrl?: string;
    deletePresignedUrl?: string;
    error?: string;
    stage?: string;
    correlationId?: string;
  }): Promise<void> {
    const {
      chatId,
      transcription,
      summary,
      downloadPresignedUrl,
      deletePresignedUrl,
      error,
      stage,
      correlationId,
    } = params;

    const startedAt = Date.now();
    this.logger.info(
      `Processing transcription result for chat: ${chatId} correlationId=${correlationId} hasError=${!!error}`,
    );

    const chat = await this.chatService.getChatByIdForServiceCall(chatId);
    if (!chat) {
      this.logger.info(
        `Chat not found: ${chatId} correlationId=${correlationId}`,
      );
      if (!this.config.isDevelopment && downloadPresignedUrl) {
        await this.deleteFromS3(downloadPresignedUrl);
      }
      return;
    }

    // Fall back to the correlation id stamped at dispatch if the callback
    // didn't echo one (older in-flight messages).
    const effectiveCorrelationId =
      correlationId ??
      (chat.metadata as Record<string, any> | undefined)?.correlationId;

    // Idempotency: a retried/duplicate delivery of an already-successful chat
    // is a no-op. This is what makes the AI-side delivery retries safe.
    if (chat.summaryStatus === ChatSummaryStatus.SUCCESS) {
      this.logger.info(
        `Chat already has a summary, ignoring duplicate result: ${chatId} correlationId=${effectiveCorrelationId}`,
      );
      return;
    }

    // ally-ai reported a genuine processing failure: record it (with the stage
    // and upstream reason) and ack 200 so the AI side does not re-post.
    if (error) {
      this.logger.error(
        `AI service reported failure for chat ${chatId} stage=${stage} correlationId=${effectiveCorrelationId}: ${error}`,
      );
      await this.recordFailure(chatId, {
        stage: stage ?? 'transcribe-result',
        reason: error,
        correlationId: effectiveCorrelationId,
        mode: 'explicit-failure',
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    try {
      let tx = transcription;
      let sm = summary;
      if (!(tx && sm) && downloadPresignedUrl) {
        const s3Result = await this.downloadFromS3(downloadPresignedUrl);
        tx = s3Result.transcription;
        sm = s3Result.summary;
      }

      if (tx && sm) {
        await this.chatAiService.addTranscript(chat, tx);
        await this.chatAiService.addSummary(chatId, sm);
      }

      if (!this.config.isDevelopment && deletePresignedUrl) {
        await this.deleteFromS3(deletePresignedUrl);
      }

      // Mark SUCCESS and ack immediately. The slow, non-critical post-summary
      // work (AI custom-field fill + counselor email) is deliberately moved
      // OFF this synchronous path — running it inline used to push the callback
      // past the AI-service read timeout under concurrency and flip good
      // summaries to FAILED.
      await this.chatService.updateChat(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });
      this.logger.info(
        `process-transcript acked SUCCESS for chat ${chatId} correlationId=${effectiveCorrelationId} elapsedMs=${Date.now() - startedAt}`,
      );

      // Fire-and-forget: both calls are internally best-effort and never throw.
      void this.runPostSummaryTasks(chat, chatId, effectiveCorrelationId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : JSON.stringify(err);
      this.logger.error(
        `Failed to persist transcription result for chat ${chatId} correlationId=${effectiveCorrelationId}: ${reason}`,
      );
      await this.recordFailure(chatId, {
        stage: stage ?? 'transcribe-result',
        reason: `Failed to persist result on ally-core: ${reason}`,
        correlationId: effectiveCorrelationId,
        mode: 'delivery-failure',
        elapsedMs: Date.now() - startedAt,
      });
      // Rethrow so the AI side treats it as a delivery failure and retries the
      // (idempotent) result — a transient DB blip then self-heals.
      throw err;
    }
  }

  /**
   * Marks a chat FAILED with a categorised reason and posts an actionable
   * Slack alert. Centralised so every failure path records the same shape
   * (stage + reason + correlationId + mode).
   */
  private async recordFailure(
    chatId: number,
    params: {
      stage: string;
      reason: string;
      correlationId?: string;
      mode: 'explicit-failure' | 'delivery-failure';
      elapsedMs?: number;
    },
  ): Promise<void> {
    const { stage, reason, correlationId, mode, elapsedMs } = params;
    await this.chatService.updateChat(chatId, {
      summaryStatus: ChatSummaryStatus.FAILED,
      metadata: { error: reason, stage, correlationId } as Record<string, any>,
    });
    await this.notificationService.notifyTranscriptionFailure({
      chatId,
      stage,
      reason,
      correlationId,
      mode,
      elapsedMs,
    });
  }

  /**
   * Slow, non-critical work that runs after the chat is already SUCCESS and the
   * callback has been acked. Each step is best-effort and isolated so a failure
   * here can never affect the summary's success state.
   */
  private async runPostSummaryTasks(
    chat: Chat,
    chatId: number,
    correlationId?: string,
  ): Promise<void> {
    try {
      await this.callDetailsService.fillAiCustomFields(chat, chat.tenantId);
    } catch (err) {
      this.logger.error(
        `Post-summary custom-field fill failed for chat ${chatId} correlationId=${correlationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    await this.chatAiService.sendSummaryReadyEmail(chatId);
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
