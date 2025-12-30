import { Injectable } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { OnEvent } from '@nestjs/event-emitter';
import { Chat } from '../entity/chat.entity';
import { ChatEvents } from '../constants/chat.constants';

@Injectable()
export class ChatEventConsumer {
  constructor(private readonly chatService: ChatService) {}

  @OnEvent(ChatEvents.CHAT_ENDED, { async: true })
  async handleChatEnded(chat: Chat) {
    await this.chatService.handleChatEnded(chat);
  }
}
