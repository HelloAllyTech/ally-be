import { Test, TestingModule } from '@nestjs/testing';
import { MicrophoneChatGateway } from '../microphone-chat.gateway';
import { ChatService } from '../../service/chat.service';
import { StreamFileProcessorService } from '../../../audio/service/stream-file-processor.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { WebSocketAuthMiddleware } from '../../../auth/middlewares/ws-auth.middleware';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../../common/constants/user.constants';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import { ChatEvents } from '../../constants/chat.constants';
import { MessageBrokerChannel } from '../../../message-broker/constants/message-broker.constants';
import { MessageType, Message } from '../../entity/message.entity';
import { UserChatSessionData } from '../../type/chat.type';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PermissionValidator } from '../../../authorization/service/permission-validator.service';

// Mock ExecutionManager
jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
    getCurrentContext: jest.fn(() => ({
      id: 'test-execution-id',
      userId: '1',
      role: 'COUNSELOR',
      tenantId: 'tenant123',
    })),
    getExecutionId: jest.fn(() => 'test-execution-id'),
    getUserId: jest.fn(() => '1'),
    getTenantId: jest.fn(() => 'tenant123'),
    getRole: jest.fn(() => 'COUNSELOR'),
    getRequestMetadata: jest.fn(() => ({
      ip: '127.0.0.1',
      method: 'POST',
      originalUrl: '/test',
      headers: { 'user-agent': 'test-agent' },
    })),
  },
}));

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Mock AuditLoggerService
jest.mock('../../../audit/service/audit-logger.service', () => ({
  AuditLoggerService: {
    getInstance: jest.fn(() => ({
      log: jest.fn(),
    })),
  },
}));

describe('MicrophoneChatGateway', () => {
  let gateway: MicrophoneChatGateway;
  let gatewayPrivate: any; // Access to private methods and properties
  let mockChatService: any;
  let mockStreamFileProcessorService: any;
  let mockPublisher: any;
  let mockWebSocketAuthMiddleware: any;
  let mockBroadcastMessageService: any;
  let mockPermissionsService: any;
  let mockPermissionValidator: any;
  let mockSocket: any;
  let mockServer: any;

  const mockSession: UserChatSessionData = {
    id: 'socket123',
    userId: 1,
    user: null,
    type: 'user',
    role: UserRole.COUNSELOR,
    room: 'user-1',
    provider: AudioChatProvider.MICROPHONE,
    chatId: PLACEHOLDER_CHAT_ID,
    tenantId: 'tenant123',
  };

  const mockMessage: Message = {
    id: 1,
    chatId: 1,
    content: 'Test message',
    messageType: MessageType.TEXT,
    senderId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    type: MessageType.TEXT,
    tenantId: 'tenant123',
  } as Message;

  beforeEach(async () => {
    mockSocket = {
      id: 'socket123',
      handshake: {
        auth: { token: 'valid-token' },
      },
      data: {
        user: {
          id: 1,
          username: 'testuser',
          role: UserRole.COUNSELOR,
          tenantId: 'tenant123',
        },
      },
      join: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
    };

    // Create explicit mock objects
    mockChatService = {
      getChatsByCouncilorId: jest.fn(),
      endChat: jest.fn(),
      getChatById: jest.fn(),
      isChatEnded: jest.fn(),
    };

    mockStreamFileProcessorService = {
      startCallStream: jest.fn(),
      saveAudio: jest.fn(),
    };

    mockPublisher = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    };

    mockWebSocketAuthMiddleware = {
      webSocketMiddleware: jest.fn().mockReturnValue(jest.fn()),
    };

    mockBroadcastMessageService = {
      broadcastUserDisconnectedMessage: jest.fn(),
    };

    mockPermissionsService = {
      getUserPermissions: jest.fn(),
    };

    mockPermissionValidator = {
      validatePermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MicrophoneChatGateway,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: StreamFileProcessorService,
          useValue: mockStreamFileProcessorService,
        },
        {
          provide: MessageBrokerService,
          useValue: mockPublisher,
        },
        {
          provide: WebSocketAuthMiddleware,
          useValue: mockWebSocketAuthMiddleware,
        },
        {
          provide: BroadcastMessageService,
          useValue: mockBroadcastMessageService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidator,
        },
      ],
    }).compile();

    gateway = module.get<MicrophoneChatGateway>(MicrophoneChatGateway);
    gatewayPrivate = gateway as any; // Create a reference for private access

    // Set the server property
    gatewayPrivate.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('afterInit', () => {
    it('should set up authentication middleware', () => {
      gateway.afterInit(mockServer);

      expect(
        mockWebSocketAuthMiddleware.webSocketMiddleware,
      ).toHaveBeenCalled();
      expect(mockServer.use).toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('should handle client connection with authenticated user and set up event listeners', async () => {
      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('user-1');
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
        expect.objectContaining({
          participants: [1],
        }),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'connect_error',
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'disconnect',
        expect.any(Function),
      );
      expect(gatewayPrivate.sessions[mockSocket.id]).toBeDefined();
    });

    it('should disconnect client when no user data is found', async () => {
      mockSocket.data.user = null;

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('should call handleDisconnect when disconnect event is triggered', async () => {
      gatewayPrivate.handleDisconnect = jest.fn().mockResolvedValue(undefined);

      await gateway.handleConnection(mockSocket);

      // Get the disconnect callback and call it
      const disconnectCallback = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'disconnect',
      )[1];
      disconnectCallback();

      expect(gatewayPrivate.handleDisconnect).toHaveBeenCalledWith(mockSocket);
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnect when session not found', async () => {
      await gateway.handleDisconnect(mockSocket);

      expect(mockChatService.endChat).not.toHaveBeenCalled();
    });

    it('should end chat when valid chatId exists', async () => {
      gatewayPrivate.sessions = {
        [mockSocket.id]: { ...mockSession, chatId: 1 },
      };
      mockChatService.endChat.mockResolvedValue(null);

      await gateway.handleDisconnect(mockSocket);

      expect(mockChatService.endChat).toHaveBeenCalledWith(1);
      expect(
        mockBroadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalled();
    });

    it('should skip ending chat when chatId is placeholder', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };

      await gateway.handleDisconnect(mockSocket);

      expect(mockChatService.endChat).not.toHaveBeenCalled();
      expect(
        mockBroadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalled();
    });

    it('should handle error when endChat fails', async () => {
      gatewayPrivate.sessions = {
        [mockSocket.id]: { ...mockSession, chatId: 1 },
      };
      mockChatService.endChat.mockRejectedValue(new Error('End chat failed'));

      await gateway.handleDisconnect(mockSocket);

      expect(mockChatService.endChat).toHaveBeenCalledWith(1);
      expect(
        mockBroadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalled();
    });
  });

  describe('sendMessagesToRoom', () => {
    it('should send message to room with default event', () => {
      const payload = {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      };

      gateway.sendMessagesToRoom('room1', payload);

      expect(mockServer.to).toHaveBeenCalledWith('room1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        ChatEvents.MESSAGE_RECEIVED,
        payload,
      );
    });

    it('should send message to room with custom event', () => {
      const payload = {
        type: ChatEvents.SESSION_CREATED,
        payload: mockMessage,
      };

      gateway.sendMessagesToRoom('room1', payload);

      expect(mockServer.to).toHaveBeenCalledWith('room1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        ChatEvents.SESSION_CREATED,
        payload,
      );
    });
  });

  describe('sendMessageToParticipant', () => {
    it('should return early when no participants or message content', async () => {
      await gatewayPrivate.sendMessageToParticipant([], mockMessage);

      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('should send message to all participants', async () => {
      const participants = [1, 2];
      const broadCastOptions = { event: ChatEvents.MESSAGE_RECEIVED };

      await gatewayPrivate.sendMessageToParticipant(
        participants,
        mockMessage,
        broadCastOptions,
      );

      expect(mockServer.to).toHaveBeenCalledWith('user-1');
      expect(mockServer.to).toHaveBeenCalledWith('user-2');
      expect(mockServer.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('startAudioChat', () => {
    it('should return early when session not found', async () => {
      gatewayPrivate.sessions = {};

      // Mock the logErrorAudioCallAuditEvent method to handle undefined session
      const logErrorSpy = jest
        .spyOn(gatewayPrivate, 'logErrorAudioCallAuditEvent')
        .mockImplementation(() => {});

      await gateway.startAudioChat(mockSocket, {
        platform: AudioChatPlatform.WEB,
        isLinear16Encoded: true,
        sampleRate: 16000,
      });

      expect(
        mockStreamFileProcessorService.startCallStream,
      ).not.toHaveBeenCalled();

      logErrorSpy.mockRestore();
    });

    it('should disconnect client when active chat exists', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatsByCouncilorId.mockResolvedValue({ id: 1 });

      await gateway.startAudioChat(mockSocket, {
        platform: AudioChatPlatform.WEB,
        isLinear16Encoded: true,
        sampleRate: 16000,
      });

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should start call stream successfully', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatsByCouncilorId.mockResolvedValue(null);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await gateway.startAudioChat(mockSocket, {
        platform: AudioChatPlatform.WEB,
        isLinear16Encoded: true,
        sampleRate: 16000,
      });

      expect(mockStreamFileProcessorService.startCallStream).toHaveBeenCalled();
    });

    it('should execute callback when chat is created', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatsByCouncilorId.mockResolvedValue(null);

      // Mock the callback execution
      let capturedCallback: ((chatId: number) => void) | undefined;
      mockStreamFileProcessorService.startCallStream.mockImplementation(
        async (session: any, options: any, callback: any) => {
          capturedCallback = callback;
          return undefined;
        },
      );

      await gateway.startAudioChat(mockSocket, {
        platform: AudioChatPlatform.WEB,
        isLinear16Encoded: true,
        sampleRate: 16000,
      });

      // Execute the callback with a test chatId
      if (capturedCallback) {
        capturedCallback(123);
      }

      // Verify the session was updated with the chatId
      expect(gatewayPrivate.sessions[mockSocket.id].chatId).toBe(123);
    });

    it('should disconnect client when stream start fails', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatsByCouncilorId.mockResolvedValue(null);
      mockStreamFileProcessorService.startCallStream.mockRejectedValue(
        new Error('Stream failed'),
      );

      await gateway.startAudioChat(mockSocket, {
        platform: AudioChatPlatform.WEB,
        isLinear16Encoded: true,
        sampleRate: 16000,
      });

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleAudioMessage', () => {
    it('should return early when session not found', async () => {
      gatewayPrivate.sessions = {};

      await gateway.handleAudioMessage(mockSocket, {
        audioData: 'base64data',
        chatId: 1,
      });

      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });

    it('should return early when chatId not provided', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };

      await gateway.handleAudioMessage(mockSocket, {
        audioData: 'base64data',
        chatId: null as any,
      });

      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });

    it('should return early when chat not found', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatById.mockResolvedValue(null);

      await gateway.handleAudioMessage(mockSocket, {
        audioData: 'base64data',
        chatId: 1,
      });

      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });

    it('should return early when chat is ended', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatById.mockResolvedValue({});
      mockChatService.isChatEnded.mockResolvedValue(true);

      await gateway.handleAudioMessage(mockSocket, {
        audioData: 'base64data',
        chatId: 1,
      });

      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });

    it('should save audio when all conditions are met', async () => {
      gatewayPrivate.sessions = { [mockSocket.id]: mockSession };
      mockChatService.getChatById.mockResolvedValue({});
      mockChatService.isChatEnded.mockResolvedValue(false);

      await gateway.handleAudioMessage(mockSocket, {
        audioData: 'base64data',
        chatId: 1,
      });

      expect(mockStreamFileProcessorService.saveAudio).toHaveBeenCalled();
    });
  });

  describe('subscribeToMicrophoneChatMessage', () => {
    it('should subscribe to microphone chat messages', () => {
      jest
        .spyOn(gatewayPrivate, 'sendMessageToParticipant')
        .mockResolvedValue(undefined);

      gateway.subscribeToMicrophoneChatMessage();

      expect(mockPublisher.subscribe).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
        expect.any(Function),
      );
    });

    it('should call sendMessageToParticipant when message is received', () => {
      const mockData = {
        participants: [1, 2],
        message: mockMessage,
        broadCastOptions: { event: ChatEvents.MESSAGE_RECEIVED },
      };

      let capturedCallback: ((data: any) => void) | undefined;
      mockPublisher.subscribe.mockImplementation(
        async (channel: any, callback: any) => {
          capturedCallback = callback;
        },
      );

      jest
        .spyOn(gatewayPrivate, 'sendMessageToParticipant')
        .mockResolvedValue(undefined);

      gateway.subscribeToMicrophoneChatMessage();

      if (capturedCallback) {
        capturedCallback(mockData);
      }

      expect(gatewayPrivate.sendMessageToParticipant).toHaveBeenCalledWith(
        mockData.participants,
        mockData.message,
        mockData.broadCastOptions,
      );
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context with session data', () => {
      gatewayPrivate.setAuthContext(mockSession);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '1',
        'tenant123',
      );
    });
  });
});
