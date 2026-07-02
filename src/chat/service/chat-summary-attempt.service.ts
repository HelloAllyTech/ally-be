import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Chat, ChatSummaryStatus } from '../entity/chat.entity';
import {
  ChatSummaryAttempt,
  ScribeAttemptOutcome,
  ScribeAttemptTrigger,
  ScribePhaseReached,
  ScribeSttAttempt,
} from '../entity/chat-summary-attempt.entity';

export interface RecordAttemptParams {
  chatId: number;
  tenantId: string;
  trigger: ScribeAttemptTrigger;
  outcome: ScribeAttemptOutcome;
  phaseReached?: ScribePhaseReached | null;
  failureStage?: string | null;
  failureReason?: string | null;
  sttProviderAssigned?: string | null;
  sttProviderSucceeded?: string | null;
  sttAttempts?: ScribeSttAttempt[] | null;
  summaryModel?: string | null;
  startedAt?: Date | null;
  elapsedMs?: number | null;
  correlationId?: string | null;
}

/**
 * Records one row per summary-pipeline attempt into chat_summary_attempts and
 * maintains the write-once first-attempt columns on `chats`. Every method is
 * best-effort: recording analytics must NEVER throw into (and break) the
 * summary-delivery path, so all failures are caught and logged.
 */
@Injectable()
export class ChatSummaryAttemptService {
  private readonly logger = LoggerService.getInstance(
    ChatSummaryAttemptService.name,
  );

  constructor(
    @InjectRepository(ChatSummaryAttempt)
    private readonly attemptRepository: Repository<ChatSummaryAttempt>,
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
  ) {}

  /**
   * Maps an ally-ai failure `stage` (+ whether a transcript was saved) to the
   * furthest phase the session reached. A failure at `transcribe` means audio
   * was uploaded but transcription didn't complete → reached `audio-uploaded`;
   * a saved transcript means diarization completed → reached `diarized`; etc.
   */
  static phaseForFailureStage(
    stage: string | undefined | null,
    transcriptSaved: boolean,
  ): ScribePhaseReached {
    if (transcriptSaved) {
      // Transcript persisted → transcription + diarization completed; the
      // failure is at/after summarize.
      return ScribePhaseReached.DIARIZED;
    }
    switch (stage) {
      case 'transcribe':
      case 'transcribe-result':
        return ScribePhaseReached.AUDIO_UPLOADED;
      case 'diarize':
        return ScribePhaseReached.TRANSCRIBED;
      case 'summarize':
      case 'summary-timeout':
        return ScribePhaseReached.DIARIZED;
      default:
        return ScribePhaseReached.AUDIO_UPLOADED;
    }
  }

  async recordAttempt(params: RecordAttemptParams): Promise<void> {
    try {
      const attemptNo = await this.nextAttemptNo(params.chatId);
      const now = new Date();
      await this.attemptRepository.insert({
        tenantId: params.tenantId,
        chatId: params.chatId,
        attemptNo,
        trigger: params.trigger,
        outcome: params.outcome,
        phaseReached: params.phaseReached ?? null,
        failureStage: params.failureStage ?? null,
        failureReason: params.failureReason
          ? params.failureReason.slice(0, 2000)
          : null,
        sttProviderAssigned: params.sttProviderAssigned ?? null,
        sttProviderSucceeded: params.sttProviderSucceeded ?? null,
        sttAttempts: params.sttAttempts ?? null,
        summaryModel: params.summaryModel ?? null,
        startedAt: params.startedAt ?? null,
        endedAt: now,
        elapsedMs: params.elapsedMs ?? null,
        correlationId: params.correlationId ?? null,
      });

      // The initial run defines the first-attempt outcome; retries/reprocess
      // must never touch it.
      if (params.trigger === ScribeAttemptTrigger.INITIAL) {
        await this.setFirstAttemptOnce(
          params.chatId,
          params.outcome === ScribeAttemptOutcome.SUCCESS
            ? ChatSummaryStatus.SUCCESS
            : ChatSummaryStatus.FAILED,
          params.failureStage ?? null,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to record summary attempt for chat ${params.chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async nextAttemptNo(chatId: number): Promise<number> {
    const existing = await this.attemptRepository.count({ where: { chatId } });
    return existing + 1;
  }

  /**
   * Write-once: only sets the first-attempt columns when they are still NULL,
   * so re-runs of the initial attempt (should not happen, but be safe) or an
   * out-of-order insert can't clobber the true first outcome.
   */
  private async setFirstAttemptOnce(
    chatId: number,
    status: ChatSummaryStatus,
    failureStage: string | null,
  ): Promise<void> {
    await this.chatRepository
      .createQueryBuilder()
      .update(Chat)
      .set({
        firstAttemptStatus: status,
        firstFailureStage: failureStage ?? undefined,
      })
      .where('id = :chatId', { chatId })
      .andWhere('"firstAttemptStatus" IS NULL')
      .execute();
  }
}
