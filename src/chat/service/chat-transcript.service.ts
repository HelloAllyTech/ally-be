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
import { ChatAudioUploadsService } from '../../audio/service/chat-audio-uploads.service';

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
    private readonly chatAudioUploadsService: ChatAudioUploadsService,
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

    try {
      // Resolve transcript + summary (inline, or from the legacy S3 result
      // file). A download failure is caught below and recorded as FAILED.
      let tx = transcription;
      let sm = summary;
      if (!(tx && sm) && downloadPresignedUrl) {
        const s3Result = await this.downloadFromS3(downloadPresignedUrl);
        tx = tx ?? s3Result.transcription;
        sm = sm ?? s3Result.summary;
      }

      // No transcript at all → a genuine hard failure (transcription/
      // diarization failed upstream). There is nothing to show or retry.
      if (!tx) {
        if (error) {
          this.logger.error(
            `AI service reported failure (no transcript) for chat ${chatId} stage=${stage} correlationId=${effectiveCorrelationId}: ${error}`,
          );
          await this.recordFailure(chatId, {
            stage: stage ?? 'transcribe-result',
            reason: error,
            correlationId: effectiveCorrelationId,
            mode: 'explicit-failure',
            elapsedMs: Date.now() - startedAt,
          });
        }
        return;
      }

      // Persist the transcript FIRST so it survives a summary failure — this is
      // what lets us show the transcript and offer a summary retry instead of
      // throwing the whole session away.
      await this.chatAiService.addTranscript(chat, tx);

      if (!this.config.isDevelopment && deletePresignedUrl) {
        await this.deleteFromS3(deletePresignedUrl);
      }

      if (sm) {
        // Full success: transcript + summary. The slow post-summary work
        // (custom-field fill + counselor email) runs off the request path.
        await this.chatAiService.addSummary(chatId, sm);
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        });
        this.logger.info(
          `process-transcript acked SUCCESS for chat ${chatId} correlationId=${effectiveCorrelationId} elapsedMs=${Date.now() - startedAt}`,
        );
        void this.runPostSummaryTasks(chat, chatId, effectiveCorrelationId);
      } else if (error) {
        // Summary generation failed upstream (transcript was delivered). Keep
        // the transcript viewable and mark the summary retryable (manual button
        // + cron auto-retry) rather than failing the whole chat.
        await this.markSummaryRetryable(chatId, chat, {
          reason: error,
          stage: stage ?? 'summarize',
          correlationId: effectiveCorrelationId,
        });
        this.logger.info(
          `process-transcript saved transcript; summary FAILED (retryable) for chat ${chatId} correlationId=${effectiveCorrelationId}`,
        );
      } else {
        // Phase 1 of two-phase delivery: the transcript arrived on its own and
        // the summary is still being generated. The transcript is now SAVED, so
        // it can never be lost to a slow/hung/failed summary. Keep the chat
        // IN_PROGRESS (the reaper still guards a genuinely stuck summary) and
        // record that the transcript is ready. Preserve existing metadata.
        const existingMetadata =
          (chat.metadata as Record<string, any> | undefined) ?? {};
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.IN_PROGRESS,
          metadata: {
            ...existingMetadata,
            correlationId:
              effectiveCorrelationId ?? existingMetadata.correlationId,
            transcriptReady: true,
          } as Record<string, any>,
        });
        this.logger.info(
          `process-transcript stored transcript (phase 1); summary pending for chat ${chatId} correlationId=${effectiveCorrelationId}`,
        );
        // Confirmation ping: transcript is safely stored before summarisation.
        // Best-effort — a Slack hiccup must never affect the stored transcript.
        try {
          await this.notificationService.notifyTranscriptStored({
            chatId,
            correlationId: effectiveCorrelationId,
            messageCount: tx.length,
          });
        } catch (notifyErr) {
          this.logger.error(
            `Failed to send transcript-stored Slack alert for chat ${chatId} correlationId=${effectiveCorrelationId}: ${
              notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
            }`,
          );
        }
      }
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
   * The transcript was persisted but summary generation failed upstream. Mark
   * the summary FAILED but flag it retryable (transcript exists), so the client
   * can show the transcript with a "Retry summary" action and the cron can
   * auto-retry. Preserves existing metadata (e.g. the dispatch correlationId).
   */
  private async markSummaryRetryable(
    chatId: number,
    chat: Chat,
    params: { reason: string; stage: string; correlationId?: string },
  ): Promise<void> {
    const { reason, stage, correlationId } = params;
    const existingMetadata =
      (chat.metadata as Record<string, any> | undefined) ?? {};
    await this.chatService.updateChat(chatId, {
      summaryStatus: ChatSummaryStatus.FAILED,
      metadata: {
        ...existingMetadata,
        error: reason,
        stage,
        correlationId: correlationId ?? existingMetadata.correlationId,
        summaryRetryable: true,
        summaryRetryAttempts: 0,
      } as Record<string, any>,
    });
    await this.notificationService.notifyTranscriptionFailure({
      chatId,
      stage,
      reason: `${reason} (transcript saved; summary retryable)`,
      correlationId,
      mode: 'explicit-failure',
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
    // Summary is final — the recording is no longer needed. Delete it now
    // (best-effort) now that it can no longer be needed for recovery.
    if (!this.config.isDevelopment) {
      try {
        const cleaned =
          await this.chatAudioUploadsService.cleanupStoredAudio(chatId);
        if (cleaned) {
          this.logger.info(
            `Deleted stored audio after summary success for chat ${chatId} correlationId=${correlationId}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to delete stored audio after summary success for chat ${chatId} correlationId=${correlationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
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
