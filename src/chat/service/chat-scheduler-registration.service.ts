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
    // Summary normally generates in 2-4 min. If nothing has come back past the
    // (5-min) TTL the session is marked FAILED fast — on the 5-min bucket — so
    // the user isn't left waiting. The transcript, when the AI delivered one,
    // is preserved separately and stays retryable; truly-dropped sessions can
    // be recovered via the manual reprocess endpoint.
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
