import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { CloudTelephonyGateway } from '../cloud-telephony.gateway';
import { ChatService } from '../../../chat/service/chat.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { LoggerService } from '../../../logger/logger.service';
import { ChatEvents } from '../../../chat/constants/chat.constants';
import {
  UserRole,
  PLACEHOLDER_CHAT_ID,
} from '../../../common/constants/user.constants';
import { MessageBrokerChannel } from '../../../message-broker/constants/message-broker.constants';
import { Message } from '../../../chat/entity/message.entity';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { WebSocketAuthMiddleware } from '../../../auth/middlewares/ws-auth.middleware';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

// Mock ExecutionManager
jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
    getCurrentContext: jest.fn().mockReturnValue(null),
    runWithContext: jest.fn().mockImplementation((fn) => fn()),
  },
}));

describe('CloudTelephonyGateway', () => {
  let gateway: CloudTelephonyGateway;
  let chatService: jest.Mocked<ChatService>;
  let messageBrokerService: jest.Mocked<MessageBrokerService>;
  let broadcastMessageService: jest.Mocked<BroadcastMessageService>;
  let mockServer: jest.Mocked<Server>;
  let mockSocket: jest.Mocked<Socket>;
  let mockLogger: any;

  const mockWebSocketAuthMiddleware = {
    webSocketMiddleware: jest.fn().mockReturnValue(jest.fn()),
  } as any;

  const mockSession = {
    id: 'socket-123',
    userId: 123,
    user: null,
    type: 'user' as const,
    role: UserRole.COUNSELOR,
    room: 'user-123',
    chatId: PLACEHOLDER_CHAT_ID,
    tenantId: 'tenant-123',
  };

  const mockMessage: Message = {
    id: 123,
    chatId: 456,
    content: 'Test message',
    type: 'TEXT' as any,
    senderId: 123,
    tenantId: 'tenant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockChatService = {
      pauseOrResumeChat: jest.fn(),
    };

    const mockMessageBrokerService = {
      subscribe: jest.fn(),
    };

    const mockBroadcastMessageService = {
      broadcastUserDisconnectedMessage: jest.fn(),
    };

    mockSocket = {
      id: 'socket-123',
      handshake: {
        auth: {
          token: 'valid-jwt-token',
        },
      },
      data: {
        user: {
          id: 123,
          username: 'test-counselor',
          tenantId: 'tenant-123',
        },
      },
      join: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    } as any;

    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTelephonyGateway,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: MessageBrokerService,
          useValue: mockMessageBrokerService,
        },
        {
          provide: BroadcastMessageService,
          useValue: mockBroadcastMessageService,
        },
        {
          provide: WebSocketAuthMiddleware,
          useValue: mockWebSocketAuthMiddleware,
        },
      ],
    }).compile();

    gateway = module.get<CloudTelephonyGateway>(CloudTelephonyGateway);
    chatService = module.get(ChatService);
    messageBrokerService = module.get(MessageBrokerService);
    broadcastMessageService = module.get(BroadcastMessageService);
    mockLogger = LoggerService.getInstance(CloudTelephonyGateway.name);

    // Set up the WebSocket server mock
    gateway.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should authenticate client and set up session on successful connection', async () => {
      // Call handleConnection
      await gateway.handleConnection(mockSocket);

      // Verify socket joined the room
      expect(mockSocket.join).toHaveBeenCalledWith('user-123');

      // Verify session was created
      expect(gateway['sessions']['socket-123']).toEqual(mockSession);

      // Verify log messages
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Client connected to cloud telephony chat: socket-123',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Client socket-123 authenticated and joined room user-123',
      );
    });

    it('should disconnect client when no user data is found', async () => {
      mockSocket.data.user = null;

      await gateway.handleConnection(mockSocket);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'No user data found for authenticated client socket-123',
      );
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should set up event listeners for connect_error and disconnect', async () => {
      await gateway.handleConnection(mockSocket);

      expect(mockSocket.on).toHaveBeenCalledWith(
        'connect_error',
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'disconnect',
        expect.any(Function),
      );
    });
  });

  describe('handleDisconnect', () => {
    beforeEach(() => {
      gateway['sessions']['socket-123'] = mockSession;
    });

    it('should broadcast user disconnected message and remove session', async () => {
      await gateway.handleDisconnect(mockSocket);

      expect(
        broadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
        {
          participants: [123],
          userId: 123,
        },
      );
      expect(gateway['sessions']['socket-123']).toBeUndefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Client disconnected: socket-123',
      );
    });

    it('should handle disconnect when session is not found', async () => {
      delete gateway['sessions']['socket-123'];

      await gateway.handleDisconnect(mockSocket);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Session not found for client socket-123',
      );
      expect(
        broadcastMessageService.broadcastUserDisconnectedMessage,
      ).not.toHaveBeenCalled();
    });
  });

  describe('sendMessagesToRoom', () => {
    it('should send message to room with default event', () => {
      const payload = {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      };

      gateway.sendMessagesToRoom('user-123', payload);

      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.emit).toHaveBeenCalledWith(
        ChatEvents.MESSAGE_RECEIVED,
        payload,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending message to room: user-123 | event: "MESSAGE_RECEIVED"',
      );
    });

    it('should send message to room with custom event', () => {
      const payload = {
        type: ChatEvents.USER_TYPING,
        payload: mockMessage,
      };

      gateway.sendMessagesToRoom('user-123', payload);

      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.emit).toHaveBeenCalledWith(
        ChatEvents.USER_TYPING,
        payload,
      );
    });
  });

  describe('sendMessageToParticipant', () => {
    it('should send message to all participants', () => {
      const participants = [123, 456];
      const broadCastOptions = { event: ChatEvents.USER_TYPING };

      gateway['sendMessageToParticipant'](
        participants,
        mockMessage,
        broadCastOptions,
      );

      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.to).toHaveBeenCalledWith('user-456');
      expect(mockServer.emit).toHaveBeenCalledTimes(2);
    });

    it('should use default event when broadCastOptions is not provided', () => {
      const participants = [123];

      gateway['sendMessageToParticipant'](participants, mockMessage);

      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.emit).toHaveBeenCalledWith(
        ChatEvents.MESSAGE_RECEIVED,
        expect.objectContaining({
          type: ChatEvents.MESSAGE_RECEIVED,
          payload: mockMessage,
        }),
      );
    });

    it('should not send message when no participants are provided', () => {
      gateway['sendMessageToParticipant']([], mockMessage);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'No participants or message content found for chatId: 456 | message: Test message',
      );
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should not send message when message content is empty', () => {
      const emptyMessage = { ...mockMessage, content: '' };
      const participants = [123];

      gateway['sendMessageToParticipant'](participants, emptyMessage);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'No participants or message content found for chatId: 456 | message: ',
      );
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleAudioChatPaused', () => {
    beforeEach(() => {
      gateway['sessions']['socket-123'] = mockSession;
    });

    it('should pause chat when valid session exists', async () => {
      const chatId = 456;

      await gateway.handleAudioChatPaused(mockSocket, { chatId });

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '123',
        'tenant-123',
      );
      expect(chatService.pauseOrResumeChat).toHaveBeenCalledWith(chatId, true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Audio chat nudge paused for chatId 456',
      );
    });

    it('should handle pause when session is not found', async () => {
      delete gateway['sessions']['socket-123'];
      const chatId = 456;

      await gateway.handleAudioChatPaused(mockSocket, { chatId });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Audio chat paused event received but session not found for client socket-123',
      );
      expect(chatService.pauseOrResumeChat).not.toHaveBeenCalled();
    });
  });

  describe('handleAudioChatResumed', () => {
    beforeEach(() => {
      gateway['sessions']['socket-123'] = mockSession;
    });

    it('should resume chat when valid session exists', async () => {
      const chatId = 456;

      await gateway.handleAudioChatResumed(mockSocket, { chatId });

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '123',
        'tenant-123',
      );
      expect(chatService.pauseOrResumeChat).toHaveBeenCalledWith(chatId, false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Audio chat Nudge resumed for chatId 456',
      );
    });

    it('should handle resume when session is not found', async () => {
      delete gateway['sessions']['socket-123'];
      const chatId = 456;

      await gateway.handleAudioChatResumed(mockSocket, { chatId });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Audio chat resumed event received but session not found for client socket-123',
      );
      expect(chatService.pauseOrResumeChat).not.toHaveBeenCalled();
    });
  });

  describe('subscribeToCloudTelephonyChatMessage', () => {
    it('should subscribe to message broker channel', () => {
      gateway.subscribeToCloudTelephonyChatMessage();

      expect(messageBrokerService.subscribe).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
        expect.any(Function),
      );
    });

    it('should handle incoming messages from message broker', () => {
      const mockData = {
        participants: [123, 456],
        message: mockMessage,
        broadCastOptions: { event: ChatEvents.USER_TYPING },
      };

      gateway.subscribeToCloudTelephonyChatMessage();

      // Get the callback function that was passed to subscribe
      const subscribeCallback = messageBrokerService.subscribe.mock.calls[0][1];

      // Call the callback with mock data
      subscribeCallback(mockData);

      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.to).toHaveBeenCalledWith('user-456');
      expect(mockServer.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('setAuthContext', () => {
    it('should set authentication context using ExecutionManager', () => {
      gateway['setAuthContext'](mockSession);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '123',
        'tenant-123',
      );
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete connection lifecycle', async () => {
      // Handle connection
      await gateway.handleConnection(mockSocket);

      // Verify session is created
      expect(gateway['sessions']['socket-123']).toEqual(mockSession);

      // Handle pause event
      await gateway.handleAudioChatPaused(mockSocket, { chatId: 456 });
      expect(chatService.pauseOrResumeChat).toHaveBeenCalledWith(456, true);

      // Handle resume event
      await gateway.handleAudioChatResumed(mockSocket, { chatId: 456 });
      expect(chatService.pauseOrResumeChat).toHaveBeenCalledWith(456, false);

      // Handle disconnect
      await gateway.handleDisconnect(mockSocket);
      expect(
        broadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalled();
      expect(gateway['sessions']['socket-123']).toBeUndefined();
    });

    it('should handle message broadcasting flow', () => {
      const participants = [123, 456];
      const message = mockMessage;
      const broadCastOptions = { event: ChatEvents.USER_TYPING };

      // Subscribe to messages
      gateway.subscribeToCloudTelephonyChatMessage();

      // Simulate message from broker
      const subscribeCallback = messageBrokerService.subscribe.mock.calls[0][1];
      subscribeCallback({ participants, message, broadCastOptions });

      // Verify messages were sent to all participants
      expect(mockServer.to).toHaveBeenCalledWith('user-123');
      expect(mockServer.to).toHaveBeenCalledWith('user-456');
      expect(mockServer.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle chat service errors gracefully', async () => {
      // Test chat service error
      gateway['sessions']['socket-123'] = mockSession;
      chatService.pauseOrResumeChat.mockRejectedValue(
        new Error('Chat service error'),
      );

      await expect(
        gateway.handleAudioChatPaused(mockSocket, { chatId: 456 }),
      ).rejects.toThrow('Chat service error');
    });

    it('should handle broadcast service errors gracefully', async () => {
      gateway['sessions']['socket-123'] = mockSession;

      // Test broadcast service error
      broadcastMessageService.broadcastUserDisconnectedMessage.mockImplementation(
        () => {
          throw new Error('Broadcast service error');
        },
      );

      await expect(gateway.handleDisconnect(mockSocket)).rejects.toThrow(
        'Broadcast service error',
      );
    });
  });
});
