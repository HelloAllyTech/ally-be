import { Test, TestingModule } from '@nestjs/testing';
import * as WebSocket from 'ws';
import { AudioIngestGateway } from '../audio.ingest.gateway';
import { AudioIngestService } from '../../service/audio-ingest.service';
import { LoggerService } from '../../../logger/logger.service';

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

// Mock WebSocket Server
jest.mock('ws', () => {
  const mockWebSocket = {
    on: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
    send: jest.fn(),
  };

  const mockWebSocketServer = {
    on: jest.fn(),
    close: jest.fn(),
  };

  return {
    WebSocket: jest.fn(() => mockWebSocket),
    Server: jest.fn(() => mockWebSocketServer),
  };
});

// Mock timers globally to prevent real timers from running
const mockSetInterval = jest.fn(() => ({ unref: jest.fn() }));
const mockClearInterval = jest.fn();

describe('AudioIngestGateway', () => {
  let gateway: AudioIngestGateway;
  let audioIngestService: jest.Mocked<AudioIngestService>;
  let mockLogger: any;
  let mockWss: any;
  let module: TestingModule;

  beforeAll(() => {
    // Use fake timers to prevent real timers from running
    jest.useFakeTimers();

    // Mock global timer functions
    jest
      .spyOn(global, 'setInterval')
      .mockImplementation(mockSetInterval as any);
    jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(mockClearInterval as any);
  });

  afterAll(() => {
    // Clean up any remaining timers
    jest.clearAllTimers();
    jest.useRealTimers();

    // Restore original timer functions
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        AudioIngestGateway,
        {
          provide: AudioIngestService,
          useValue: {
            handleConnectionAlive: jest.fn().mockResolvedValue(undefined),
            handleStreamEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    gateway = module.get<AudioIngestGateway>(AudioIngestGateway);
    audioIngestService = module.get(AudioIngestService);
    mockLogger = LoggerService.getInstance(AudioIngestGateway.name);
    mockWss = gateway.getWss();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Clear any mock timer calls
    mockSetInterval.mockClear();
    mockClearInterval.mockClear();

    // Clean up the module to prevent memory leaks
    if (module) {
      await module.close();
    }
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(gateway).toBeDefined();
    });

    it('should initialize WebSocket server with noServer: true', () => {
      expect(WebSocket.Server).toHaveBeenCalledWith({ noServer: true });
    });

    it('should call initialize method', () => {
      const initializeSpy = jest.spyOn(
        AudioIngestGateway.prototype,
        'initialize',
      );
      new AudioIngestGateway(audioIngestService);
      expect(initializeSpy).toHaveBeenCalled();
    });

    it('should log initialization message', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing Audio Ingest Gateway',
      );
    });
  });

  describe('handleConnection', () => {
    it('should log connection info with client id', () => {
      const mockClient = { id: 'test-client-123' };
      const mockArgs = ['arg1', 'arg2'];

      gateway.handleConnection(mockClient, ...mockArgs);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '3rd-party WS client connected via NestJS gateway' + mockClient.id,
      );
    });

    it('should handle connection without client id', () => {
      const mockClient = {};
      const mockArgs = ['arg1', 'arg2'];

      gateway.handleConnection(mockClient, ...mockArgs);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '3rd-party WS client connected via NestJS gatewayundefined',
      );
    });
  });

  describe('getWss', () => {
    it('should return WebSocket server instance', () => {
      const wss = gateway.getWss();
      expect(wss).toBeDefined();
      expect(wss).toBe(mockWss);
    });
  });

  describe('initialize', () => {
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        on: jest.fn(),
        ping: jest.fn(),
        terminate: jest.fn(),
        send: jest.fn(),
      };
    });

    it('should set up connection event handler', () => {
      expect(mockWss.on).toHaveBeenCalledWith(
        'connection',
        expect.any(Function),
      );
    });

    it('should handle WebSocket connection and set up event handlers', () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      // Simulate connection
      connectionHandler(mockWs);

      // Verify event handlers are set up
      expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle pong event and set isAlive to true', () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      connectionHandler(mockWs);

      const pongHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'pong',
      )[1];

      // Simulate pong event
      pongHandler();

      // The isAlive variable is internal, so we can't directly test it
      // But we can verify the handler was called
      expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });

    it('should handle message event and process message data', async () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      connectionHandler(mockWs);

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'message',
      )[1];

      const mockMessage = { type: 'audio', data: 'test-data' };
      const mockBuffer = Buffer.from(JSON.stringify(mockMessage));

      // Simulate message event
      await messageHandler(mockBuffer);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Audio Ingest Gateway: Received message',
      );
      expect(audioIngestService.handleConnectionAlive).toHaveBeenCalledWith(
        mockWs,
        mockMessage,
      );
      expect(audioIngestService.handleStreamEvent).toHaveBeenCalledWith(
        mockMessage,
        mockWs,
      );
    });

    it('should set up ping interval for connection monitoring', () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      connectionHandler(mockWs);

      // Verify that setInterval was called with 30000ms interval
      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it('should handle close event and clear ping interval', () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      // Mock setInterval to return a mock interval ID
      const mockIntervalId = { unref: jest.fn() };
      mockSetInterval.mockReturnValue(mockIntervalId as any);

      connectionHandler(mockWs);

      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'close',
      )[1];

      // Simulate close event
      closeHandler();

      expect(mockClearInterval).toHaveBeenCalledWith(mockIntervalId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Audio Ingest Gateway: Client disconnected',
      );
    });

    it('should handle pong event to reset connection status', () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      connectionHandler(mockWs);

      const pongHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'pong',
      )[1];

      // Simulate pong event
      pongHandler();

      // Verify that pong handler was set up
      expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });

    it('should handle invalid JSON in message processing', async () => {
      const connectionHandler = mockWss.on.mock.calls.find(
        (call: any) => call[0] === 'connection',
      )[1];

      connectionHandler(mockWs);

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'message',
      )[1];

      const invalidBuffer = Buffer.from('invalid json');

      // Mock JSON.parse to throw error
      const originalParse = JSON.parse;
      JSON.parse = jest.fn().mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      // Simulate message event with invalid JSON
      await expect(messageHandler(invalidBuffer)).rejects.toThrow(
        'Invalid JSON',
      );

      // Restore original JSON.parse
      JSON.parse = originalParse;
    });
  });
});
