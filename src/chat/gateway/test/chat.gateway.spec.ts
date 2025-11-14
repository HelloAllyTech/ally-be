import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from '../chat.gateway';
import { ChatService } from '../../service/chat.service';
import { TranscriptionService } from '../../../ai/service/transcription.service';
import { AppConfigService } from '../../../config/config.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import {
  UserChatSessionData,
  DeepgramTranscriptMetadata,
} from '../../type/chat.type';
import { ChatEvents } from '../../constants/chat.constants';
import { MessageType } from '../../entity/message.entity';
import { AudioChatProvider } from '../../../common/constants/chat.constants';
import { MessageBrokerChannel } from '../../../message-broker/constants/message-broker.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { UserRole } from '../../../common/constants/user.constants';
import { ChatStatus } from '../../entity/chat.entity';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockChatService: any;
  let mockTranscriptionService: any;
  let mockConfig: any;
  let mockPublisher: any;
  let mockJwtService: any;

  const mockSocket = {
    id: 'test-socket-id',
    handshake: {
      auth: {
        token: 'mock-jwt-token',
      },
    },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  };

  const mockServer = {
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
  };

  const mockSession: UserChatSessionData = {
    id: 'test-socket-id',
    type: 'user',
    userId: 1,
    user: {
      id: 1,
      username: 'testuser',
      role: UserRole.CLIENT,
      tenantId: 'test-tenant',
    },
    role: UserRole.CLIENT,
    room: 'user-1',
    chatId: 1,
    tenantId: 'test-tenant',
    provider: AudioChatProvider.WEBRTC,
  };

  const mockChat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    status: ChatStatus.ACTIVE,
    createdAt: new Date(),
  };

  const mockMessage = {
    id: 1,
    chatId: 1,
    senderId: 1,
    content: 'Test message',
    type: MessageType.TEXT,
    context: null,
    createdAt: new Date('2025-10-03T12:52:16.759Z'),
    tenantId: 'test-tenant',
  };

  beforeEach(async () => {
    // Create explicit mock objects
    mockChatService = {
      persistAndBroadcastMessage: jest.fn(),
      getChatById: jest.fn(),
      triggerNudge: jest.fn(),
      isChatPaused: jest.fn(),
      getMessageObject: jest.fn(),
      pauseOrResumeChat: jest.fn(),
      incrementWordCountByLanguage: jest.fn(),
      saveMessage: jest.fn(),
      save: jest.fn(),
    };

    mockTranscriptionService = {
      startLiveTranscription: jest.fn(),
      stopLiveTranscription: jest.fn(),
      sendAudio: jest.fn(),
      handleAudioChatMuted: jest.fn(),
    };

    mockConfig = {
      jwt: {
        accessToken: {
          secret: 'test-secret',
        },
      },
      ai: {
        sentenceCompletionRequired: true,
      },
    };

    mockPublisher = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    };

    mockJwtService = {
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: TranscriptionService,
          useValue: mockTranscriptionService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
        {
          provide: MessageBrokerService,
          useValue: mockPublisher,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);

    // Set up the server property
    (gateway as any).server = mockServer;

    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'setAuthContext').mockImplementation(() => {});

    // Set up default mocks for ChatService
    mockChatService.getChatById.mockResolvedValue({
      id: 1,
      clientId: 1,
      counselorId: 2,
      status: ChatStatus.ACTIVE,
    });
    mockChatService.getMessageObject.mockReturnValue({
      id: 1,
      chatId: 1,
      senderId: 1,
      content: 'Test message',
      type: MessageType.TEXT,
      context: null,
      tenantId: 'test-tenant',
      createdAt: new Date('2025-10-03T12:52:16.759Z'),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Re-setup the default mocks after clearing
    mockChatService.getChatById.mockResolvedValue({
      id: 1,
      clientId: 1,
      counselorId: 2,
      status: ChatStatus.ACTIVE,
    });
    mockChatService.getMessageObject.mockReturnValue({
      id: 1,
      chatId: 1,
      senderId: 1,
      content: 'Test message',
      type: MessageType.TEXT,
      context: null,
      tenantId: 'test-tenant',
      createdAt: new Date('2025-10-03T12:52:16.759Z'),
    });
  });

  describe('handleConnection', () => {
    it('should authenticate client and join room on successful connection', async () => {
      const mockPayload = {
        sub: '1',
        username: 'testuser',
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      };

      mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockSocket as any);

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        'mock-jwt-token',
        {
          secret: 'test-secret',
        },
      );
      expect(mockSocket.join).toHaveBeenCalledWith('user-1');
      expect((gateway as any).sessions['test-socket-id']).toEqual({
        id: 'test-socket-id',
        userId: 1,
        user: {
          id: 1,
          username: 'testuser',
          role: UserRole.CLIENT,
          tenantId: 'test-tenant',
        },
        type: 'user',
        role: UserRole.CLIENT,
        room: 'user-1',
        chatId: -99,
        tenantId: 'test-tenant',
        provider: AudioChatProvider.WEBRTC,
      });
    });

    it('should disconnect client when no auth data provided', async () => {
      const socketWithoutAuth = {
        ...mockSocket,
        handshake: { auth: null },
      };

      await gateway.handleConnection(socketWithoutAuth as any);

      expect(socketWithoutAuth.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client when no token provided', async () => {
      const socketWithoutToken = {
        ...mockSocket,
        handshake: { auth: {} },
      };

      await gateway.handleConnection(socketWithoutToken as any);

      expect(socketWithoutToken.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client when JWT verification fails', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await gateway.handleConnection(mockSocket as any);

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should call handleDisconnect when client disconnects', async () => {
      const mockPayload = {
        sub: '1',
        username: 'testuser',
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      };

      mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

      // Mock handleDisconnect method
      const handleDisconnectSpy = jest
        .spyOn(gateway, 'handleDisconnect')
        .mockImplementation(() => Promise.resolve());

      await gateway.handleConnection(mockSocket as any);

      // Simulate the disconnect event
      const disconnectHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'disconnect',
      )?.[1];
      if (disconnectHandler) {
        disconnectHandler('client disconnected');
      }

      expect(handleDisconnectSpy).toHaveBeenCalledWith(mockSocket);
    });

    it('should handle connect_error event', async () => {
      const mockPayload = {
        sub: '1',
        username: 'testuser',
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      };

      mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockSocket as any);

      // Simulate the connect_error event
      const connectErrorHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect_error',
      )?.[1];
      if (connectErrorHandler) {
        connectErrorHandler(new Error('Connection failed'));
      }

      // Verify that the error handler was set up
      expect(mockSocket.on).toHaveBeenCalledWith(
        'connect_error',
        expect.any(Function),
      );
    });
  });

  describe('prepareMessage', () => {
    const mockSession: UserChatSessionData = {
      id: 'test-socket-id',
      type: 'user',
      userId: 1,
      user: {
        id: 1,
        username: 'testuser',
        role: UserRole.CLIENT,
        tenantId: 'test-tenant',
      },
      role: UserRole.CLIENT,
      room: 'user-1',
      chatId: 1,
      tenantId: 'test-tenant',
      provider: AudioChatProvider.WEBRTC,
    };

    const mockSendMessageData = {
      chatId: 1,
      content: 'Test message',
      context: 'Test context',
      messageType: MessageType.TEXT,
    };

    const mockBroadCastOptions = {
      event: ChatEvents.MESSAGE_RECEIVED,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return message data when chat is found', async () => {
      const mockMessage = {
        id: 1,
        chatId: 1,
        senderId: 1,
        content: 'Test message',
        type: MessageType.TEXT,
        context: 'Test context',
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: 'test-tenant',
      };

      mockChatService.getChatById.mockResolvedValue(mockChat as any);
      mockChatService.getMessageObject.mockResolvedValue(mockMessage as any);

      const result = await (gateway as any).prepareMessage(
        mockSession,
        mockSendMessageData,
        mockBroadCastOptions,
      );

      expect(mockChatService.getChatById).toHaveBeenCalledWith(1);
      expect(mockChatService.getMessageObject).toHaveBeenCalledWith(
        1,
        1,
        mockSendMessageData,
      );
      expect(result).toEqual({
        participants: [2, 1], // counselorId and clientId
        message: mockMessage,
        broadCastOptions: mockBroadCastOptions,
      });
    });

    it('should return undefined when chat is not found', async () => {
      mockChatService.getChatById.mockResolvedValue(null);
      mockChatService.getMessageObject.mockResolvedValue(mockMessage as any);

      const result = await (gateway as any).prepareMessage(
        mockSession,
        mockSendMessageData,
        mockBroadCastOptions,
      );

      expect(mockChatService.getChatById).toHaveBeenCalledWith(1);
      expect(mockChatService.getMessageObject).toHaveBeenCalledWith(
        1,
        1,
        mockSendMessageData,
      );
      expect(result).toBeUndefined();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle client disconnect and clean up session', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      (gateway as any).connectedUsers = new Set([1]);

      mockChatService.getChatById.mockResolvedValue(mockChat as any);
      mockTranscriptionService.stopLiveTranscription.mockResolvedValue(
        undefined,
      );
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.handleDisconnect(mockSocket as any);

      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).toHaveBeenCalledWith(mockSession);
      expect((gateway as any).connectedUsers.has(1)).toBe(false);
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
        {
          participants: [2],
          message: {
            content: 'User disconnected',
            messageType: MessageType.SYSTEM,
            userId: 1,
          },
          broadCastOptions: {
            event: ChatEvents.USER_DISCONNECTED,
          },
        },
      );
    });

    it('should handle disconnect when session not found', async () => {
      (gateway as any).sessions = {};

      await gateway.handleDisconnect(mockSocket as any);

      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).not.toHaveBeenCalled();
    });
  });

  describe('handleSendMessage', () => {
    it('should handle send message and trigger nudge', async () => {
      const messageData = {
        chatId: 1,
        content: 'Test message',
        context: 'Test context',
        messageType: MessageType.TEXT,
      };

      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.persistAndBroadcastMessage.mockResolvedValue(
        mockMessage as any,
      );
      mockChatService.triggerNudge.mockResolvedValue(undefined);

      await gateway.handleSendMessage(mockSocket as any, messageData);

      expect(mockChatService.persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        messageData,
      );
      expect(mockChatService.triggerNudge).toHaveBeenCalledWith(
        mockMessage,
        mockSession,
        1,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    });

    it('should handle send message when session not found', async () => {
      const messageData = {
        chatId: 1,
        content: 'Test message',
      };

      (gateway as any).sessions = {};

      await gateway.handleSendMessage(mockSocket as any, messageData);

      expect(mockChatService.persistAndBroadcastMessage).not.toHaveBeenCalled();
    });
  });

  describe('startAudioChat', () => {
    it('should start audio chat and live transcription', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(mockChat as any);
      mockTranscriptionService.startLiveTranscription.mockResolvedValue(
        undefined,
      );
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.startAudioChat(mockSocket as any, { chatId: 1 });

      expect(mockSession.chatId).toBe(1);
      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledWith(
        {
          session: mockSession,
          chatId: 1,
          chatCreatedAt: mockChat.createdAt,
        },
        expect.any(Function),
      );
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
        {
          participants: [2],
          message: {
            userId: 1,
            chatId: 1,
            content: 'User joined audio chat',
            messageType: MessageType.SYSTEM,
          },
          broadCastOptions: {
            event: ChatEvents.USER_JOINED,
          },
        },
      );
    });

    it('should handle start audio chat when session not found', async () => {
      (gateway as any).sessions = {};

      await gateway.startAudioChat(mockSocket as any, { chatId: 1 });

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).not.toHaveBeenCalled();
    });

    it('should handle error in startAudioChat catch block', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;

      // Mock getChatById to throw an error
      mockChatService.getChatById.mockRejectedValue(
        new Error('Database error'),
      );

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.startAudioChat(mockSocket as any, { chatId: 1 });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error sending audio to chatId 1:',
        expect.any(Error),
      );
    });

    it('should handle error when transcription service fails', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;

      mockChatService.getChatById.mockResolvedValue(mockChat as any);

      // Mock startLiveTranscription to throw an error
      mockTranscriptionService.startLiveTranscription.mockRejectedValue(
        new Error('Transcription service error'),
      );

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.startAudioChat(mockSocket as any, { chatId: 1 });

      // Should not throw error, but should log the transcription error
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error starting live transcription for chatId 1:',
        expect.any(Error),
      );
    });
  });

  describe('handleAudioMessage', () => {
    it('should handle audio message when chat is not paused', async () => {
      const audioData = 'base64-encoded-audio';
      const audioBuffer = Buffer.from(audioData, 'base64');

      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.getChatById.mockResolvedValue(mockChat as any);
      mockTranscriptionService.sendAudio.mockResolvedValue(undefined);
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.handleAudioMessage(mockSocket as any, {
        chatId: 1,
        audioData,
      });

      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledWith(
        mockSession,
        audioBuffer,
      );
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
        {
          participants: [2],
          message: {
            userId: 1,
            audioData,
            chatId: 1,
            content: 'Audio message',
          },
          broadCastOptions: {
            event: ChatEvents.AUDIO_STREAM,
          },
        },
      );
    });

    it('should not handle audio message when chat is paused', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.isChatPaused.mockResolvedValue(true);

      await gateway.handleAudioMessage(mockSocket as any, {
        chatId: 1,
        audioData: 'test',
      });

      expect(mockTranscriptionService.sendAudio).not.toHaveBeenCalled();
    });

    it('should handle audio message when session not found', async () => {
      (gateway as any).sessions = {};
      mockChatService.isChatPaused.mockResolvedValue(false);

      await gateway.handleAudioMessage(mockSocket as any, {
        chatId: 1,
        audioData: 'test',
      });

      expect(mockTranscriptionService.sendAudio).not.toHaveBeenCalled();
    });

    it('should handle error in handleAudioMessage catch block', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.isChatPaused.mockResolvedValue(false);

      // Mock getChatById to throw an error
      mockChatService.getChatById.mockRejectedValue(
        new Error('Database error'),
      );

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleAudioMessage(mockSocket as any, {
        chatId: 1,
        audioData: 'test',
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error sending audio to chatId 1:',
        expect.any(Error),
      );
    });

    it('should handle error when transcription service sendAudio fails', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.getChatById.mockResolvedValue(mockChat as any);

      // Mock sendAudio to throw an error
      mockTranscriptionService.sendAudio.mockRejectedValue(
        new Error('Transcription error'),
      );

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleAudioMessage(mockSocket as any, {
        chatId: 1,
        audioData: 'test',
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error sending audio to chatId 1:',
        expect.any(Error),
      );
    });
  });

  describe('handleAudioChatMuted', () => {
    it('should handle audio chat muted', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockTranscriptionService.handleAudioChatMuted.mockResolvedValue(
        undefined,
      );

      await gateway.handleAudioChatMuted(mockSocket as any, { chatId: 1 });

      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).toHaveBeenCalledWith(mockSession);
    });

    it('should handle audio chat muted when session not found', async () => {
      (gateway as any).sessions = {};

      await gateway.handleAudioChatMuted(mockSocket as any, { chatId: 1 });

      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).not.toHaveBeenCalled();
    });

    it('should handle error in handleAudioChatMuted catch block', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;

      // Mock handleAudioChatMuted to throw an error
      mockTranscriptionService.handleAudioChatMuted.mockRejectedValue(
        new Error('Transcription service error'),
      );

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleAudioChatMuted(mockSocket as any, { chatId: 1 });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error sending audio to chatId 1:',
        expect.any(Error),
      );
    });
  });

  describe('handleAudioChatPaused', () => {
    it('should pause chat', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.pauseOrResumeChat.mockResolvedValue(undefined);

      await gateway.handleAudioChatPaused(mockSocket as any, { chatId: 1 });

      expect(mockChatService.pauseOrResumeChat).toHaveBeenCalledWith(1, true);
    });

    it('should handle pause chat when session not found', async () => {
      (gateway as any).sessions = {};

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleAudioChatPaused(mockSocket as any, { chatId: 1 });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Session not found for client test-socket-id',
      );
      expect(mockChatService.pauseOrResumeChat).not.toHaveBeenCalled();
    });
  });

  describe('handleAudioChatResumed', () => {
    it('should resume chat', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.pauseOrResumeChat.mockResolvedValue(undefined);

      await gateway.handleAudioChatResumed(mockSocket as any, { chatId: 1 });

      expect(mockChatService.pauseOrResumeChat).toHaveBeenCalledWith(1, false);
    });

    it('should handle resume chat when session not found', async () => {
      (gateway as any).sessions = {};

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleAudioChatResumed(mockSocket as any, { chatId: 1 });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Session not found for client test-socket-id',
      );
      expect(mockChatService.pauseOrResumeChat).not.toHaveBeenCalled();
    });
  });

  describe('WebRTC Message Handling', () => {
    it('should handle WebRTC offer', async () => {
      const offerData = { chatId: 1, offer: 'test-offer' };
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(mockChat as any);

      await gateway.handleOffer(mockSocket as any, offerData);

      expect(mockServer.to).toHaveBeenCalledWith('user-2');
    });

    it('should handle WebRTC answer', async () => {
      const answerData = { chatId: 1, answer: 'test-answer' };
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(mockChat as any);

      await gateway.handleAnswer(mockSocket as any, answerData);

      expect(mockServer.to).toHaveBeenCalledWith('user-2');
    });

    it('should handle ICE candidate', async () => {
      const candidateData = { chatId: 1, candidate: 'test-candidate' };
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(mockChat as any);

      await gateway.handleIceCandidate(mockSocket as any, candidateData);

      expect(mockServer.to).toHaveBeenCalledWith('user-2');
    });

    it('should emit error when chat not found in WebRTC message', async () => {
      const offerData = { chatId: 1, offer: 'test-offer' };
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(null);

      await gateway.handleOffer(mockSocket as any, offerData);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', 'Chat not found');
    });

    it('should handle sendWebRTCMessage when session not found', async () => {
      (gateway as any).sessions = {};

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await (gateway as any).sendWebRTCMessage(
        mockSocket as any,
        { chatId: 1 },
        'test-event',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Session not found for client test-socket-id',
      );
    });

    it('should handle sendWebRTCMessage when chat not found', async () => {
      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(null);

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await (gateway as any).sendWebRTCMessage(
        mockSocket as any,
        { chatId: 1 },
        'test-event',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Chat not found for chatId: 1',
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('error', 'Chat not found');
    });
  });

  describe('handleDeepgramTranscript', () => {
    it('should handle transcript with utterance end', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Complete sentence',
        currentTranscriptCreatedAt: new Date(),
        isUtteranceEnd: true,
        wordCountByLanguage: { en: 2 },
      };

      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.getChatById.mockResolvedValue(mockChat as any);
      mockChatService.incrementWordCountByLanguage.mockResolvedValue(1);
      mockChatService.saveMessage.mockResolvedValue(mockMessage as any);
      mockChatService.triggerNudge.mockResolvedValue(undefined);
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.handleDeepgramTranscript(
        mockSession,
        1,
        'Complete sentence',
        metadata,
      );

      // Note: incrementWordCountByLanguage is not called when isUtteranceEnd is true
      // as the handleUtteranceEnd method doesn't call it
      expect(mockChatService.saveMessage).toHaveBeenCalledWith(1, 1, {
        content: 'Complete sentence',
        createdAt: metadata.currentTranscriptCreatedAt,
        startSeconds: metadata.currentTranscriptStart,
        endSeconds: metadata.currentTranscriptEnd,
      });
      expect(mockChatService.triggerNudge).toHaveBeenCalledWith(
        mockMessage,
        mockSession,
        1,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    });

    it('should handle transcript with sentence completion required', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Complete sentence',
        currentTranscriptCreatedAt: new Date(),
        isUtteranceEnd: false,
        wordCountByLanguage: { en: 2 },
      };

      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.incrementWordCountByLanguage.mockResolvedValue(1);
      mockChatService.saveMessage.mockResolvedValue(mockMessage as any);
      mockChatService.triggerNudge.mockResolvedValue(undefined);
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.handleDeepgramTranscript(
        mockSession,
        1,
        'Complete sentence',
        metadata,
      );

      expect(mockChatService.saveMessage).toHaveBeenCalledWith(1, 1, {
        content: 'Complete sentence',
        createdAt: metadata.currentTranscriptCreatedAt,
        startSeconds: metadata.currentTranscriptStart,
        endSeconds: metadata.currentTranscriptEnd,
      });
    });

    it('should handle transcript without sentence completion required', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: false,
        currentTranscriptBuffer: 'Incomplete sentence',
        currentTranscriptCreatedAt: new Date(),
        isUtteranceEnd: false,
        wordCountByLanguage: { en: 2 },
      };

      // Mock config to not require sentence completion
      (mockConfig as any).ai.sentenceCompletionRequired = false;

      (gateway as any).sessions['test-socket-id'] = mockSession;
      mockChatService.incrementWordCountByLanguage.mockResolvedValue(1);
      mockChatService.save.mockResolvedValue(mockMessage as any);
      mockChatService.triggerNudge.mockResolvedValue(undefined);
      mockPublisher.publish.mockResolvedValue(undefined);

      await gateway.handleDeepgramTranscript(
        mockSession,
        1,
        'Incomplete sentence',
        metadata,
      );

      expect(mockChatService.save).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle transcript with no content and no buffer', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: false,
        currentTranscriptBuffer: '',
        currentTranscriptCreatedAt: new Date(),
        isUtteranceEnd: false,
        wordCountByLanguage: {},
      };

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleDeepgramTranscript(mockSession, 1, '', metadata);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'No transcript or currentTranscriptBuffer found for chatId: 1',
      );
    });

    it('should handle transcript when prepareMessage returns no participants', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Test message',
        currentTranscriptCreatedAt: new Date(),
        isUtteranceEnd: false,
        wordCountByLanguage: { en: 2 },
      };

      // Mock prepareMessage to return undefined (no participants)
      jest.spyOn(gateway as any, 'prepareMessage').mockResolvedValue(undefined);

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await gateway.handleDeepgramTranscript(
        mockSession,
        1,
        'Test message',
        metadata,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'No participants or message found for chatId: 1',
      );
    });
  });

  describe('handleUtteranceEnd', () => {
    it('should handle utterance end with participants', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Complete utterance',
        currentTranscriptCreatedAt: new Date(),
        currentTranscriptStart: 0,
        currentTranscriptEnd: 5,
        isUtteranceEnd: false,
        wordCountByLanguage: {},
      };

      // Mock prepareMessage to return valid data
      jest.spyOn(gateway as any, 'prepareMessage').mockResolvedValue({
        participants: [1, 2],
        message: mockMessage,
        broadCastOptions: { event: ChatEvents.UTTERANCE_ENDED },
      });

      mockChatService.saveMessage.mockResolvedValue(mockMessage as any);
      mockChatService.triggerNudge.mockResolvedValue(undefined);
      mockPublisher.publish.mockResolvedValue(undefined);

      await (gateway as any).handleUtteranceEnd(
        mockSession,
        1,
        'Complete utterance',
        metadata,
      );

      expect(mockChatService.saveMessage).toHaveBeenCalledWith(1, 1, {
        content: 'Complete utterance',
        createdAt: metadata.currentTranscriptCreatedAt,
        startSeconds: metadata.currentTranscriptStart,
        endSeconds: metadata.currentTranscriptEnd,
      });
      expect(mockChatService.triggerNudge).toHaveBeenCalledWith(
        mockMessage,
        mockSession,
        1,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    });

    it('should handle utterance end when no participants', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: 'Complete utterance',
        currentTranscriptCreatedAt: new Date(),
        currentTranscriptStart: 0,
        currentTranscriptEnd: 5,
        isUtteranceEnd: false,
        wordCountByLanguage: {},
      };

      // Mock prepareMessage to return no participants
      jest.spyOn(gateway as any, 'prepareMessage').mockResolvedValue({
        participants: [],
        message: mockMessage,
        broadCastOptions: { event: ChatEvents.UTTERANCE_ENDED },
      });

      // Mock logger.error to verify it's called
      const loggerErrorSpy = jest
        .spyOn(gateway.logger, 'error')
        .mockImplementation(() => {});

      await (gateway as any).handleUtteranceEnd(
        mockSession,
        1,
        'Complete utterance',
        metadata,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'No participants or message found for chatId: 1',
      );
    });

    it('should handle utterance end without transcript buffer', async () => {
      const metadata: DeepgramTranscriptMetadata = {
        isFinal: true,
        isSentenceComplete: true,
        currentTranscriptBuffer: '',
        currentTranscriptCreatedAt: new Date(),
        currentTranscriptStart: 0,
        currentTranscriptEnd: 5,
        isUtteranceEnd: false,
        wordCountByLanguage: {},
      };

      // Mock prepareMessage to return valid data
      jest.spyOn(gateway as any, 'prepareMessage').mockResolvedValue({
        participants: [1, 2],
        message: mockMessage,
        broadCastOptions: { event: ChatEvents.UTTERANCE_ENDED },
      });

      mockPublisher.publish.mockResolvedValue(undefined);

      await (gateway as any).handleUtteranceEnd(
        mockSession,
        1,
        'Test transcript',
        metadata,
      );

      // Should not call saveMessage or triggerNudge when no transcript buffer
      expect(mockChatService.saveMessage).not.toHaveBeenCalled();
      expect(mockChatService.triggerNudge).not.toHaveBeenCalled();
    });
  });

  describe('sendMessagesToRoom', () => {
    it('should send message to room', () => {
      const payload = {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      };

      gateway.sendMessagesToRoom('user-1', payload);

      expect(mockServer.to).toHaveBeenCalledWith('user-1');
    });
  });

  describe('subscribeToWebRTCChatMessage', () => {
    it('should call sendMessageToParticipant when message is received', () => {
      const mockData = {
        participants: [1, 2],
        message: { content: 'Test message', type: MessageType.TEXT },
        broadCastOptions: { event: ChatEvents.MESSAGE_RECEIVED },
      };

      // Mock the subscribe method to capture the callback
      let capturedCallback: any;
      mockPublisher.subscribe.mockImplementation(
        async (channel: any, callback: any) => {
          capturedCallback = callback;
        },
      );

      // Call the method to set up the subscription
      gateway.subscribeToWebRTCChatMessage();

      // Verify subscription was set up
      expect(mockPublisher.subscribe).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
        expect.any(Function),
      );

      // Mock sendMessageToParticipant using private method access
      jest
        .spyOn(gateway as any, 'sendMessageToParticipant')
        .mockImplementation(() => {});

      // Execute the captured callback with mock data
      if (capturedCallback) {
        capturedCallback(mockData);
      }

      // Verify that sendMessageToParticipant was called with the correct parameters
      expect((gateway as any).sendMessageToParticipant).toHaveBeenCalledWith(
        mockData.participants,
        mockData.message,
        mockData.broadCastOptions,
      );
    });
  });

  describe('sendMessageToParticipant', () => {
    const mockMessage = {
      id: 1,
      chatId: 1,
      senderId: 1,
      content: 'Test message',
      type: MessageType.TEXT,
      context: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: 'test-tenant',
      parentMessageId: undefined,
      startSeconds: undefined,
      endSeconds: undefined,
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock the connectedUsers Set
      (gateway as any).connectedUsers = new Set([1, 2, 3]);
    });

    it('should send message to all participants when they are connected', () => {
      const participants = [1, 2];
      const broadCastOptions = { event: ChatEvents.MESSAGE_RECEIVED };

      // Mock sendMessagesToRoom
      jest.spyOn(gateway, 'sendMessagesToRoom').mockImplementation(() => {});

      // Call the private method
      (gateway as any).sendMessageToParticipant(
        participants,
        mockMessage,
        broadCastOptions,
      );

      // Verify sendMessagesToRoom was called for each participant
      expect(gateway.sendMessagesToRoom).toHaveBeenCalledTimes(2);
      expect(gateway.sendMessagesToRoom).toHaveBeenCalledWith('user-1', {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      });
      expect(gateway.sendMessagesToRoom).toHaveBeenCalledWith('user-2', {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      });
    });

    it('should send message with default event when broadCastOptions is not provided', () => {
      const participants = [1];

      // Mock sendMessagesToRoom
      jest.spyOn(gateway, 'sendMessagesToRoom').mockImplementation(() => {});

      // Call the private method without broadCastOptions
      (gateway as any).sendMessageToParticipant(participants, mockMessage);

      // Verify sendMessagesToRoom was called with default event
      expect(gateway.sendMessagesToRoom).toHaveBeenCalledWith('user-1', {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: mockMessage,
      });
    });

    it('should send message with custom event', () => {
      const participants = [1];
      const broadCastOptions = { event: ChatEvents.NUDGE };

      // Mock sendMessagesToRoom
      jest.spyOn(gateway, 'sendMessagesToRoom').mockImplementation(() => {});

      // Call the private method
      (gateway as any).sendMessageToParticipant(
        participants,
        mockMessage,
        broadCastOptions,
      );

      // Verify sendMessagesToRoom was called with custom event
      expect(gateway.sendMessagesToRoom).toHaveBeenCalledWith('user-1', {
        type: ChatEvents.NUDGE,
        payload: mockMessage,
      });
    });
  });

  describe('sendMessagesToRoomUsingPublish', () => {
    it('should send message to participants using publish', () => {
      const participants = [1, 2];
      const message = { content: 'Test message' };

      gateway.sendMessagesToRoomUsingPublish(
        ChatEvents.MESSAGE_RECEIVED,
        participants,
        message,
      );

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
        {
          participants,
          message,
          broadCastOptions: {
            event: ChatEvents.MESSAGE_RECEIVED,
          },
        },
      );
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context in ExecutionManager', () => {
      gateway.setAuthContext(mockSession);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '1',
        'test-tenant',
      );
    });
  });
});
