import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ChatService } from './chat.service';

@Injectable()
export class ChatSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly chatService: ChatService) {}

  onModuleInit(): void {
    // The scheduler runner currently fires the '30min' bucket; the chat summary
    // TTL is also 30min, so a stuck chat is reaped within ~30-60min of creation.
    scheduledTaskRegistry.register('30min', 'chat-summary-timeout', () =>
      this.chatService.markStalePendingChatsAsFailed(),
    );
  }
}
