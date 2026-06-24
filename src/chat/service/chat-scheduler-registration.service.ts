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
    // The scheduler runner currently fires the '30min' bucket; the chat summary
    // TTL is also 30min, so a stuck chat is reaped within ~30-60min of creation.
    scheduledTaskRegistry.register('30min', 'chat-summary-timeout', () =>
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
