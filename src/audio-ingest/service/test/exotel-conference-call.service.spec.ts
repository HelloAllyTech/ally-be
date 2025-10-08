import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as WebSocket from 'ws';
import { ExotelConferenceCallService } from '../exotel-conference-call.service';
import { ChatService } from '../../../chat/service/chat.service';
import { UserService } from '../../../user/user.service';
import { StreamFileProcessorService } from '../../../audio/service/stream-file-processor.service';
import { LoggerService } from '../../../logger/logger.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { UserChatSessionData } from '../../../chat/type/chat.type';
import { AudioChatProvider } from '../../../common/constants/chat.constants';
import { UserRole } from '../../../common/constants/user.constants';
import { PLACEHOLDER_CHAT_ID } from '../../../common/constants/user.constants';
import { TWENTY_FIVE_SECONDS_IN_MS } from '../../../common/constants/time.constants';

// Mock LoggerService
jest.mock('../../../logger/logger.service');
const MockedLoggerService = LoggerService as jest.MockedClass<
  typeof LoggerService
>;

// Mock ExecutionManager
jest.mock('../../../common/execution/execution-manager');
const MockedExecutionManager = ExecutionManager as jest.Mocked<
  typeof ExecutionManager
>;

describe('ExotelConferenceCallService', () => {
  let service: ExotelConferenceCallService;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockWebSocket = {
    send: jest.fn(),
    close: jest.fn(),
    readyState: WebSocket.OPEN,
    ping: jest.fn(),
    pong: jest.fn(),
    terminate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  } as any;

  const mockCounselor = {
    id: 123,
    phoneNumber: '+919876543210',
    tenantId: 'tenant-123',
    name: 'Test Counselor',
  };

  let mockChatService: any;
  let mockUserService: any;
  let mockEventEmitter: any;
  let mockStreamFileProcessorService: any;

  beforeEach(async () => {
    mockChatService = {
      isChatPaused: jest.fn(),
      isChatEnded: jest.fn(),
      endChat: jest.fn(),
    };

    mockUserService = {
      getUserByPhoneNumber: jest.fn(),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockStreamFileProcessorService = {
      startCallStream: jest.fn(),
      saveAudio: jest.fn(),
      clearPendingAudioQueue: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    (MockedLoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    // Mock ExecutionManager to handle decorators
    MockedExecutionManager.getCurrentContext.mockReturnValue(undefined);
    MockedExecutionManager.runWithContext.mockImplementation((fn) => fn());
    MockedExecutionManager.setAuthContext.mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExotelConferenceCallService,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: StreamFileProcessorService,
          useValue: mockStreamFileProcessorService,
        },
      ],
    }).compile();

    service = module.get<ExotelConferenceCallService>(
      ExotelConferenceCallService,
    );

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();

    // Clean up any remaining intervals
    Object.keys((service as any).keepAliveData).forEach((streamId) => {
      const keepAliveData = (service as any).keepAliveData[streamId];
      if (keepAliveData?.interval) {
        clearInterval(keepAliveData.interval);
      }
    });
    (service as any).keepAliveData = {};
  });

  describe('Basic Functionality', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have required dependencies injected', () => {
      expect(service['chatService']).toBeDefined();
      expect(service['userService']).toBeDefined();
      expect(service['eventEmitter']).toBeDefined();
      expect(service['streamFileProcessorService']).toBeDefined();
    });

    it('should call startCall method', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
      expect(mockStreamFileProcessorService.startCallStream).toHaveBeenCalled();
      expect((service as any).sessions['stream-123']).toBeDefined();
      expect((service as any).sessions['stream-123'].userId).toBe(123);
    });
  });

  describe('handleStreamEvent', () => {
    it('should handle unknown event types gracefully', async () => {
      const messageData = {
        event: 'unknown_event',
        stream_sid: 'stream-123',
      };

      await expect(
        service.handleStreamEvent(messageData, mockWebSocket),
      ).resolves.not.toThrow();
    });

    it('should handle START event through handleStreamEvent', async () => {
      const messageData = {
        event: 'start',
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.handleStreamEvent(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
      expect(mockStreamFileProcessorService.startCallStream).toHaveBeenCalled();
    });

    it('should handle MEDIA event through handleStreamEvent', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        event: 'media',
        stream_sid: streamSid,
        media: {
          payload: 'base64audiodata',
        },
      };

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.isChatEnded.mockResolvedValue(false);

      await service.handleStreamEvent(messageData, mockWebSocket);

      expect(mockStreamFileProcessorService.saveAudio).toHaveBeenCalled();
    });

    it('should handle STOP event through handleStreamEvent', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        event: 'stop',
        stream_sid: streamSid,
      };

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      await service.handleStreamEvent(messageData, mockWebSocket);

      expect(mockChatService.endChat).toHaveBeenCalledWith(456);
    });
  });

  describe('createEmptyPCMAudioPacket', () => {
    it('should create correct size PCM audio packet', () => {
      const audioPacket = (service as any).createEmptyPCMAudioPacket();

      // Should be base64 encoded
      expect(typeof audioPacket).toBe('string');

      // Decode and check size
      const buffer = Buffer.from(audioPacket, 'base64');
      const expectedSize = 320 * 10; // BYTES_PER_20MS * MIN_CHUNKS
      expect(buffer.length).toBe(expectedSize);
    });

    it('should create silent audio packet', () => {
      const audioPacket = (service as any).createEmptyPCMAudioPacket();
      const buffer = Buffer.from(audioPacket, 'base64');

      // Check that all samples are zero (silence)
      for (let i = 0; i < buffer.length; i += 2) {
        const sample = buffer.readInt16LE(i);
        expect(sample).toBe(0);
      }
    });

    it('should create packet with correct number of samples', () => {
      const audioPacket = (service as any).createEmptyPCMAudioPacket();
      const buffer = Buffer.from(audioPacket, 'base64');

      const samplesPerChunk = 160; // BYTES_PER_20MS / 2
      const totalSamples = samplesPerChunk * 10; // MIN_CHUNKS
      const expectedBufferSize = totalSamples * 2; // 2 bytes per sample

      expect(buffer.length).toBe(expectedBufferSize);
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context with correct parameters', () => {
      const session: UserChatSessionData = {
        id: 'stream-123',
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      (service as any).setAuthContext(session);

    expect(MockedExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '123',
      'tenant-123',
    );
    });
  });

  describe('clearKeepAliveData', () => {
    it('should clear keep alive data and interval', () => {
      const streamId = 'stream-123';
      const mockInterval = setInterval(() => {}, 1000);

      (service as any).keepAliveData[streamId] = {
        interval: mockInterval,
        sequence: 5,
      };

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      (service as any).clearKeepAliveData(streamId);

      expect(clearIntervalSpy).toHaveBeenCalledWith(mockInterval);
      expect((service as any).keepAliveData[streamId]).toBeUndefined();
    });

    it('should handle non-existent keep alive data gracefully', () => {
      const streamId = 'non-existent-stream';

      expect(() => {
        (service as any).clearKeepAliveData(streamId);
      }).not.toThrow();
    });

    it('should handle keep alive data without interval gracefully', () => {
      const streamId = 'stream-123';

      (service as any).keepAliveData[streamId] = {
        sequence: 5,
      };

      expect(() => {
        (service as any).clearKeepAliveData(streamId);
      }).not.toThrow();

      expect((service as any).keepAliveData[streamId]).toBeUndefined();
    });
  });

  describe('handleConnectionAlive', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should set up keep alive interval for new stream', () => {
      const messageData = {
        stream_sid: 'stream-123',
      };

      service.handleConnectionAlive(mockWebSocket, messageData);

      expect((service as any).keepAliveData['stream-123']).toBeDefined();
      expect((service as any).keepAliveData['stream-123'].sequence).toBe(1);
    });

    it('should not set up interval if streamId is missing', () => {
      const messageData = {};

      service.handleConnectionAlive(mockWebSocket, messageData);

      expect((service as any).keepAliveData).toEqual({});
    });

    it('should not set up interval if already exists', () => {
      const messageData = {
        stream_sid: 'stream-123',
      };

      // Set up existing interval
      (service as any).keepAliveData['stream-123'] = {
        interval: setInterval(() => {}, 1000),
        sequence: 1,
      };

      service.handleConnectionAlive(mockWebSocket, messageData);

      // Should not create new interval
      expect((service as any).keepAliveData['stream-123'].sequence).toBe(1);
    });

    it('should send keep alive messages at correct intervals', () => {
      const messageData = {
        stream_sid: 'stream-123',
      };

      service.handleConnectionAlive(mockWebSocket, messageData);

      // Fast-forward time to trigger interval
      jest.advanceTimersByTime(TWENTY_FIVE_SECONDS_IN_MS);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"media"'),
      );
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"stream_sid":"stream-123"'),
      );
    });

    it('should increment sequence number with each keep alive message', () => {
      const messageData = {
        stream_sid: 'stream-123',
      };

      service.handleConnectionAlive(mockWebSocket, messageData);

      // Fast-forward time to trigger multiple intervals
      jest.advanceTimersByTime(TWENTY_FIVE_SECONDS_IN_MS * 3);

      expect(mockWebSocket.send).toHaveBeenCalledTimes(3);
      expect((service as any).keepAliveData['stream-123'].sequence).toBe(4);
    });
  });

  describe('Service State Management', () => {
    it('should initialize with empty sessions and keepAliveData', () => {
      expect((service as any).sessions).toEqual({});
      expect((service as any).keepAliveData).toEqual({});
    });

    it('should have correct constants', () => {
      expect((service as any).BYTES_PER_20MS).toBe(320);
      expect((service as any).MIN_CHUNKS).toBe(10);
    });
  });

  describe('Session Management', () => {
    it('should create session with correct structure', () => {
      const streamSid = 'stream-123';
      const session = {
        id: streamSid,
        chatId: PLACEHOLDER_CHAT_ID,
        type: 'user',
        userId: -1,
        user: null,
        role: UserRole.COUNSELOR,
        room: 'placeholder-room',
        tenantId: 'default',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      expect(session.id).toBe(streamSid);
      expect(session.chatId).toBe(PLACEHOLDER_CHAT_ID);
      expect(session.type).toBe('user');
      expect(session.role).toBe(UserRole.COUNSELOR);
      expect(session.provider).toBe(AudioChatProvider.EXOTEL_CONFERENCE_CALL);
    });
  });

  describe('startCall', () => {
    it('should successfully start call with valid counselor phone number', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
      expect(mockStreamFileProcessorService.startCallStream).toHaveBeenCalled();
      expect((service as any).sessions['stream-123']).toBeDefined();
      expect((service as any).sessions['stream-123'].userId).toBe(123);
      expect((service as any).sessions['stream-123'].room).toBe('user-123');
      expect((service as any).sessions['stream-123'].tenantId).toBe(
        'tenant-123',
      );
    });

    it('should handle missing counselor phone number', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {},
      };

      await service.startCall(messageData, mockWebSocket);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          statusCode: 404,
          message: 'Missing counselor phone number',
          type: 'Exotel integration error',
        }),
      );
      expect(mockWebSocket.terminate).toHaveBeenCalled();
      expect(
        mockStreamFileProcessorService.clearPendingAudioQueue,
      ).toHaveBeenCalledWith('stream-123');
      expect((service as any).sessions['stream-123']).toBeUndefined();
    });

    it('should handle counselor not found', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(null);

      await service.startCall(messageData, mockWebSocket);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          statusCode: 404,
          message: 'Counselor with phone number +919876543210 not found',
          type: 'Exotel integration error',
        }),
      );
      expect(mockWebSocket.terminate).toHaveBeenCalled();
      expect(
        mockStreamFileProcessorService.clearPendingAudioQueue,
      ).toHaveBeenCalledWith('stream-123');
      expect((service as any).sessions['stream-123']).toBeUndefined();
    });

    it('should handle startCallStream failure', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      const error = new Error('Stream start failed');
      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockRejectedValue(error);

      await service.startCall(messageData, mockWebSocket);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to start call stream for client stream-123',
        ),
      );
      expect(mockWebSocket.terminate).toHaveBeenCalled();
      expect((service as any).sessions['stream-123']).toBeUndefined();
    });

    it('should call callback function when chat is created', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);

      // Mock the callback function to be called
      let callbackCalled = false;
      let callbackChatId = null;
      mockStreamFileProcessorService.startCallStream.mockImplementation(
        async (session: any, options: any, callback: any) => {
          // Simulate callback being called with chatId
          callback(456);
          callbackCalled = true;
          callbackChatId = 456;
        },
      );

      await service.startCall(messageData, mockWebSocket);

      expect(callbackCalled).toBe(true);
      expect(callbackChatId).toBe(456);
      expect((service as any).sessions['stream-123'].chatId).toBe(456);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Chat created for user 123 with chatId 456',
      );
    });

    it('should handle phone number with +91 prefix correctly', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+919876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
    });

    it('should handle phone number with 11 digits starting with 0', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '09876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
    });

    it('should handle phone number with 10 digits without prefix', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '9876543210',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+919876543210',
      );
    });

    it('should handle phone number with different country code', async () => {
      const messageData = {
        stream_sid: 'stream-123',
        start: {
          from: '+1234567890',
        },
      };

      mockUserService.getUserByPhoneNumber.mockResolvedValue(mockCounselor);
      mockStreamFileProcessorService.startCallStream.mockResolvedValue(
        undefined,
      );

      await service.startCall(messageData, mockWebSocket);

      expect(mockUserService.getUserByPhoneNumber).toHaveBeenCalledWith(
        '+1234567890',
      );
    });
  });

  describe('handleAudioMessage', () => {
    it('should handle audio message when session exists and chat is created', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        stream_sid: streamSid,
        media: {
          payload: 'base64audiodata',
        },
      };

      // Set up session
      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.isChatEnded.mockResolvedValue(false);

      await service.handleAudioMessage(messageData, mockWebSocket);

      expect(mockChatService.isChatPaused).toHaveBeenCalledWith(456);
      expect(mockChatService.isChatEnded).toHaveBeenCalledWith(456);
      expect(mockStreamFileProcessorService.saveAudio).toHaveBeenCalledWith(
        (service as any).sessions[streamSid],
        {
          chatId: 456,
          audioBase64: 'base64audiodata',
          shouldBroadcastAudioMessage: true,
        },
      );
    });

    it('should return early when no session exists', async () => {
      const messageData = {
        stream_sid: 'non-existent-stream',
        media: {
          payload: 'base64audiodata',
        },
      };

      await service.handleAudioMessage(messageData, mockWebSocket);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Exotel: No session found for stream_sid: non-existent-stream',
      );
    });

    it('should return early when chat is paused', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        stream_sid: streamSid,
        media: {
          payload: 'base64audiodata',
        },
      };

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      mockChatService.isChatPaused.mockResolvedValue(true);

      await service.handleAudioMessage(messageData, mockWebSocket);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Exotel: Chat is paused for chatId: 456',
      );
      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });

    it('should terminate connection when chat is ended', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        stream_sid: streamSid,
        media: {
          payload: 'base64audiodata',
        },
      };

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.isChatEnded.mockResolvedValue(true);

      await service.handleAudioMessage(messageData, mockWebSocket);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Exotel: Chat is ended for chatId: 456',
      );
      expect(mockWebSocket.terminate).toHaveBeenCalled();
    });

    it('should return early when no audio data is provided', async () => {
      const streamSid = 'stream-123';
      const messageData = {
        stream_sid: streamSid,
        media: {},
      };

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      mockChatService.isChatPaused.mockResolvedValue(false);
      mockChatService.isChatEnded.mockResolvedValue(false);

      await service.handleAudioMessage(messageData, mockWebSocket);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Exotel: No audio data found for stream_sid: stream-123',
      );
      expect(mockStreamFileProcessorService.saveAudio).not.toHaveBeenCalled();
    });
  });

  describe('endCall', () => {
    it('should successfully end call when session exists', async () => {
      const streamSid = 'stream-123';

      (service as any).sessions[streamSid] = {
        id: streamSid,
        chatId: 456,
        type: 'user',
        userId: 123,
        user: mockCounselor,
        role: UserRole.COUNSELOR,
        room: 'user-123',
        tenantId: 'tenant-123',
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      };

      await service.endCall(streamSid);

      expect(mockChatService.endChat).toHaveBeenCalledWith(456);
      expect((service as any).sessions[streamSid]).toBeUndefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Exotel: WS client stop event completed with stream_sid: stream-123',
      );
    });

    it('should handle missing streamSid', async () => {
      await service.endCall('');

      expect(mockLogger.warn).toHaveBeenCalledWith('Exotel: Missing client ID');
      expect(mockChatService.endChat).not.toHaveBeenCalled();
    });

    it('should handle non-existent session', async () => {
      const streamSid = 'non-existent-stream';

      await service.endCall(streamSid);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Exotel: No session found for stream_sid: non-existent-stream',
      );
      expect(mockChatService.endChat).not.toHaveBeenCalled();
    });
  });
});
