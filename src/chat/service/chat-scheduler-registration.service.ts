import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ChatService } from './chat.service';
import { CallDetailsService } from './call-details.service';

@Injectable()
export class ChatSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly chatService: ChatService,
    private readonly callDetailsService: CallDetailsService,
  ) {}

  onModuleInit(): void {
    // Fail fast: the chat summary TTL is 5min, so the reaper runs on the '5min'
    // bucket and a stuck chat surfaces within ~5-10min of creation. This is safe
    // because the transcript is stored before the summary (two-phase) and the
    // audio is kept until success, so failing fast loses nothing — a timed-out
    // chat is marked retryable for the auto-retry cron / manual retry.
    scheduledTaskRegistry.register('5min', 'chat-summary-timeout', () =>
      this.chatService.markStalePendingChatsAsFailed(),
    );

    // Auto-retry summaries for chats whose transcript was saved but whose
    // summary failed, up to a bounded number of attempts, then leave them for
    // a manual retry. Runs every 15min so a failed summary recovers faster.
    scheduledTaskRegistry.register('15min', 'chat-summary-retry', () =>
      this.callDetailsService.retryFailedSummaries(),
    );
  }
}
