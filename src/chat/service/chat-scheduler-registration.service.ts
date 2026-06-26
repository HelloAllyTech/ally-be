import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ChatService } from './chat.service';
import { CallDetailsService } from './call-details.service';
import { AudioUploadService } from './audio-upload.service';

@Injectable()
export class ChatSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly chatService: ChatService,
    private readonly callDetailsService: CallDetailsService,
    private readonly audioUploadService: AudioUploadService,
  ) {}

  onModuleInit(): void {
    // Run the reaper frequently (every 5min) but it only fails chats older than
    // CHAT_SUMMARY_TIMEOUT_MINUTES (20min), set above the AI worker's 15min
    // processing budget so slow-but-healthy jobs aren't reaped mid-flight. Safe
    // because the transcript is stored before the summary (two-phase) and the
    // audio is kept until success — a timed-out chat with a transcript is marked
    // retryable for the auto-retry cron / manual retry.
    scheduledTaskRegistry.register('5min', 'chat-summary-timeout', () =>
      this.chatService.markStalePendingChatsAsFailed(),
    );

    // Auto-retry summaries for chats whose transcript was saved but whose
    // summary failed, up to a bounded number of attempts, then leave them for
    // a manual retry. Runs every 15min so a failed summary recovers faster.
    scheduledTaskRegistry.register('15min', 'chat-summary-retry', () =>
      this.callDetailsService.retryFailedSummaries(),
    );

    // Auto-recover chats that timed out with NO transcript (the summary-retry
    // cron can't help them — there's nothing to summarise from). This
    // re-transcribes from the still-stored audio. Hourly because each run
    // re-dispatches the full STT+summary pipeline (cost), and it's bounded by
    // the reprocess lookback window + MAX_STUCK_REPROCESS_ATTEMPTS and only
    // re-dispatches when the audio object still exists in S3.
    scheduledTaskRegistry.register('hourly', 'chat-reprocess-stuck', () =>
      this.audioUploadService.reprocessStuckChats().then(() => undefined),
    );
  }
}
