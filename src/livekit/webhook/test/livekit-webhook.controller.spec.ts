import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { LivekitWebhookController } from '../livekit-webhook.controller';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantJoinedHandler } from '../handlers/participant-joined.handler';
import { RoomFinishedHandler } from '../handlers/room-finished.handler';
import { EgressStartedHandler } from '../handlers/egress-started.handler';
import { WebhookReceiver } from 'livekit-server-sdk';

// Mock livekit-server-sdk
jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({
    receive: jest.fn(),
  })),
}));

// Mock LoggerService
jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

describe('LivekitWebhookController', () => {
  let controller: LivekitWebhookController;
  let participantJoinedHandler: jest.Mocked<ParticipantJoinedHandler>;
  let roomFinishedHandler: jest.Mocked<RoomFinishedHandler>;
  let egressStartedHandler: jest.Mocked<EgressStartedHandler>;
  let mockLogger: jest.Mocked<any>;
  let mockWebhookReceiver: jest.Mocked<WebhookReceiver>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  const mockLiveKitConfig = {
    serverUrl: 'https://livekit.example.com',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  };

  beforeEach(async () => {
    const mockConfigService = {
      livekit: mockLiveKitConfig,
    };

    const mockParticipantJoinedHandler = {
      handle: jest.fn(),
    };

    const mockRoomFinishedHandler = {
      handle: jest.fn(),
    };

    const mockEgressStartedHandler = {
      handle: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    mockWebhookReceiver = {
      receive: jest.fn(),
    } as any;

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);
    (WebhookReceiver as jest.Mock).mockReturnValue(mockWebhookReceiver);

    // Mock request and response objects
    mockRequest = {
      headers: {
        authorization: 'Bearer test-token',
      },
      [Symbol.asyncIterator]: jest.fn().mockImplementation(async function* () {
        yield Buffer.from('{"event":"participant_joined"}');
      }),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LivekitWebhookController],
      providers: [
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ParticipantJoinedHandler,
          useValue: mockParticipantJoinedHandler,
        },
        {
          provide: RoomFinishedHandler,
          useValue: mockRoomFinishedHandler,
        },
        {
          provide: EgressStartedHandler,
          useValue: mockEgressStartedHandler,
        },
      ],
    }).compile();

    controller = module.get<LivekitWebhookController>(LivekitWebhookController);
    participantJoinedHandler = module.get(ParticipantJoinedHandler);
    roomFinishedHandler = module.get(RoomFinishedHandler);
    egressStartedHandler = module.get(EgressStartedHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should initialize webhook receiver with valid configuration', () => {
      expect(WebhookReceiver).toHaveBeenCalledWith(
        mockLiveKitConfig.apiKey,
        mockLiveKitConfig.apiSecret,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'LiveKit webhook receiver initialized',
      );
    });

    it('should warn when configuration is missing', () => {
      const incompleteConfig = {
        livekit: {
          serverUrl: 'https://test.com',
          apiKey: '',
          apiSecret: '',
        },
      };

      jest.clearAllMocks();

      new LivekitWebhookController(
        incompleteConfig as any,
        participantJoinedHandler,
        roomFinishedHandler,
        egressStartedHandler,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LiveKit webhook configuration missing. Webhook receiver will not be available.',
      );
    });
  });

  describe('handleWebhook', () => {
    it('should handle participant_joined event successfully', async () => {
      const mockEvent = {
        event: 'participant_joined',
        room: {
          name: 'test-room',
          sid: 'room-sid-123',
        },
        participant: {
          identity: 'user-123',
          name: 'John Doe',
        },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);
      participantJoinedHandler.handle.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith(
        '{"event":"participant_joined"}',
        'Bearer test-token',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Received LiveKit webhook event: participant_joined',
      );
      expect(participantJoinedHandler.handle).toHaveBeenCalledWith(mockEvent);
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle room_finished event successfully', async () => {
      const mockEvent = {
        event: 'room_finished',
        room: {
          name: 'test-room',
          sid: 'room-sid-123',
        },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);
      roomFinishedHandler.handle.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Received LiveKit webhook event: room_finished',
      );
      expect(roomFinishedHandler.handle).toHaveBeenCalledWith(mockEvent);
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle egress_started event successfully', async () => {
      const mockEvent = {
        event: 'egress_started',
        egressInfo: {
          egressId: 'eg_1',
          roomName: 'test-room',
          startedAt: 1700000000000000000n,
        },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);
      egressStartedHandler.handle.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Received LiveKit webhook event: egress_started',
      );
      expect(egressStartedHandler.handle).toHaveBeenCalledWith(mockEvent);
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle unknown event type', async () => {
      const mockEvent = {
        event: 'unknown_event',
        room: {
          name: 'test-room',
        },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Received LiveKit webhook event: unknown_event',
      );
      expect(participantJoinedHandler.handle).not.toHaveBeenCalled();
      expect(roomFinishedHandler.handle).not.toHaveBeenCalled();
      expect(egressStartedHandler.handle).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle webhook receiver not initialized', async () => {
      // Create controller with missing config
      const incompleteConfig = {
        livekit: {
          apiKey: '',
          apiSecret: '',
        },
      };

      const controllerWithoutReceiver = new LivekitWebhookController(
        incompleteConfig as any,
        participantJoinedHandler,
        roomFinishedHandler,
        egressStartedHandler,
      );

      await controllerWithoutReceiver.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Webhook receiver not initialized',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        'Webhook service unavailable',
      );
    });

    it('should handle webhook verification error', async () => {
      const error = new Error('Invalid webhook signature');
      mockWebhookReceiver.receive.mockRejectedValue(error);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing LiveKit webhook:',
        'Invalid webhook signature',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.send).toHaveBeenCalledWith('Invalid webhook');
    });

    it('should handle participant_joined handler error', async () => {
      const mockEvent = {
        event: 'participant_joined',
        room: {
          name: 'test-room',
        },
        participant: {
          identity: 'user-123',
        },
      };

      const handlerError = new Error('Handler processing failed');
      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);
      participantJoinedHandler.handle.mockRejectedValue(handlerError);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in participant_joined handler: Handler processing failed',
        handlerError.stack,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle room_finished handler error', async () => {
      const mockEvent = {
        event: 'room_finished',
        room: {
          name: 'test-room',
        },
      };

      const handlerError = new Error('Handler processing failed');
      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);
      roomFinishedHandler.handle.mockRejectedValue(handlerError);

      await controller.handleWebhook(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in room_finished handler: Handler processing failed',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith();
    });

    it('should handle empty request body', async () => {
      const emptyRequest = {
        headers: {
          authorization: 'Bearer test-token',
        },
        [Symbol.asyncIterator]: jest
          .fn()
          .mockImplementation(async function* () {
            // Empty body
          }),
      };

      const mockEvent = {
        event: 'participant_joined',
        room: { name: 'test-room' },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);

      await controller.handleWebhook(
        emptyRequest as any,
        mockResponse as Response,
      );

      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith(
        '',
        'Bearer test-token',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('should handle missing authorization header', async () => {
      const requestWithoutAuth = {
        headers: {},
        [Symbol.asyncIterator]: jest
          .fn()
          .mockImplementation(async function* () {
            yield Buffer.from('{"event":"participant_joined"}');
          }),
      };

      const mockEvent = {
        event: 'participant_joined',
        room: { name: 'test-room' },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);

      await controller.handleWebhook(
        requestWithoutAuth as any,
        mockResponse as Response,
      );

      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith(
        '{"event":"participant_joined"}',
        undefined,
      );
    });

    it('should handle large request body', async () => {
      const largeData = 'x'.repeat(10000);
      const largeRequest = {
        headers: {
          authorization: 'Bearer test-token',
        },
        [Symbol.asyncIterator]: jest
          .fn()
          .mockImplementation(async function* () {
            yield Buffer.from(largeData);
          }),
      };

      const mockEvent = {
        event: 'participant_joined',
        room: { name: 'test-room' },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);

      await controller.handleWebhook(
        largeRequest as any,
        mockResponse as Response,
      );

      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith(
        largeData,
        'Bearer test-token',
      );
    });

    it('should handle multiple chunks in request body', async () => {
      const multiChunkRequest = {
        headers: {
          authorization: 'Bearer test-token',
        },
        [Symbol.asyncIterator]: jest
          .fn()
          .mockImplementation(async function* () {
            yield Buffer.from('{"event":');
            yield Buffer.from('"participant_');
            yield Buffer.from('joined"}');
          }),
      };

      const mockEvent = {
        event: 'participant_joined',
        room: { name: 'test-room' },
      };

      mockWebhookReceiver.receive.mockResolvedValue(mockEvent as any);

      await controller.handleWebhook(
        multiChunkRequest as any,
        mockResponse as Response,
      );

      expect(mockWebhookReceiver.receive).toHaveBeenCalledWith(
        '{"event":"participant_joined"}',
        'Bearer test-token',
      );
    });
  });
});
