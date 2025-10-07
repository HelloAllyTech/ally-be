import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastMessageService } from '../broadcast-message.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../../common/constants/message-broker.constants';
import { MessageType } from '../../../common/entities/message.entity';
import { ChatEvents } from '../../../chat/constants/chat.constants';

describe('BroadcastMessageService', () => {
  let service: BroadcastMessageService;
  let messageBrokerService: jest.Mocked<MessageBrokerService>;

  beforeEach(async () => {
    const mockMessageBrokerService = {
      publish: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastMessageService,
        {
          provide: MessageBrokerService,
          useValue: mockMessageBrokerService,
        },
      ],
    }).compile();

    service = module.get<BroadcastMessageService>(BroadcastMessageService);
    messageBrokerService = module.get(MessageBrokerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('broadcastUserDisconnectedMessage', () => {
    it('should publish user disconnected message', () => {
      const channel = MessageBrokerChannel.CHAT_MESSAGE_WEBRTC;
      const data = { participants: [1, 2], userId: 123 };

      service.broadcastUserDisconnectedMessage(channel, data);

      expect(messageBrokerService.publish).toHaveBeenCalledWith(channel, {
        participants: [1, 2],
        message: {
          userId: 123,
          content: 'User disconnected',
          messageType: MessageType.SYSTEM,
        },
        broadCastOptions: {
          event: ChatEvents.USER_DISCONNECTED,
        },
      });
    });
  });

  describe('broadcastUserJoinedMessage', () => {
    it('should publish user joined message', () => {
      const channel = MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE;
      const data = { participants: [1, 2], userId: 123, chatId: 456 };

      service.broadcastUserJoinedMessage(channel, data);

      expect(messageBrokerService.publish).toHaveBeenCalledWith(channel, {
        participants: [1, 2],
        message: {
          userId: 123,
          chatId: 456,
          content: 'User joined audio chat',
          messageType: MessageType.SYSTEM,
        },
        broadCastOptions: {
          event: ChatEvents.USER_JOINED,
        },
      });
    });
  });

  describe('broadcastAudioStreamMessage', () => {
    it('should publish audio stream message', () => {
      const channel = MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY;
      const audioData = Buffer.from('test audio data');
      const data = {
        participants: [1, 2],
        userId: 123,
        audioData,
        chatId: 456,
      };

      service.broadcastAudioStreamMessage(channel, data);

      expect(messageBrokerService.publish).toHaveBeenCalledWith(channel, {
        participants: [1, 2],
        message: {
          userId: 123,
          audioData,
          chatId: 456,
          content: 'Audio message',
        },
        broadCastOptions: {
          event: ChatEvents.AUDIO_STREAM,
        },
      });
    });
  });

  describe('broadcastChatEndedEvent', () => {
    it('should publish chat ended event', () => {
      const channel = MessageBrokerChannel.CHAT_MESSAGE_WEBRTC;
      const data = { participants: [1, 2], chatId: 456 };

      service.broadcastChatEndedEvent(channel, data);

      expect(messageBrokerService.publish).toHaveBeenCalledWith(channel, {
        participants: [1, 2],
        message: {
          chatId: 456,
          content: 'Chat ended',
          messageType: MessageType.SYSTEM,
        },
        broadCastOptions: {
          event: ChatEvents.CHAT_ENDED,
        },
      });
    });
  });
});
