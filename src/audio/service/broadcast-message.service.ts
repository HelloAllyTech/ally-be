import { Injectable } from '@nestjs/common';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../message-broker/constants/message-broker.constants';
import { MessageType } from '../../chat/entity/message.entity';
import { ChatEvents } from '../../chat/constants/chat.constants';

@Injectable()
export class BroadcastMessageService {
  constructor(private publisher: MessageBrokerService) {}

  broadcastUserDisconnectedMessage(
    channel: MessageBrokerChannel,
    { participants, userId }: { participants: number[]; userId: number },
  ) {
    this.publisher.publish(channel, {
      participants,
      message: {
        userId,
        content: 'User disconnected',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_DISCONNECTED,
      },
    });
  }

  broadcastUserJoinedMessage(
    channel: MessageBrokerChannel,
    {
      participants,
      userId,
      chatId,
    }: {
      participants: number[];
      userId: number;
      chatId: number;
    },
  ) {
    this.publisher.publish(channel, {
      participants,
      message: {
        userId,
        chatId,
        content: 'User joined audio chat',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_JOINED,
      },
    });
  }

  broadcastAudioStreamMessage(
    channel: MessageBrokerChannel,
    {
      participants,
      userId,
      audioData,
      chatId,
    }: {
      participants: number[];
      userId: number;
      audioData: Buffer;
      chatId: number;
    },
  ) {
    this.publisher.publish(channel, {
      participants,
      message: {
        userId,
        audioData,
        chatId,
        content: 'Audio message',
      },
      broadCastOptions: {
        event: ChatEvents.AUDIO_STREAM,
      },
    });
  }

  broadcastChatEndedEvent(
    channel: MessageBrokerChannel,
    {
      participants,
      chatId,
    }: {
      participants: number[];
      chatId: number;
    },
  ) {
    const message = {
      chatId,
      content: 'Chat ended',
      messageType: MessageType.SYSTEM,
    };
    this.publisher.publish(channel, {
      participants,
      message,
      broadCastOptions: {
        event: ChatEvents.CHAT_ENDED,
      },
    });
  }
}
