import { Test, TestingModule } from '@nestjs/testing';
import * as WebSocket from 'ws';
import { AudioIngestService } from '../audio-ingest.service';
import { AudioIngestInterface } from '../../interface/audio-ingest.interface';

describe('AudioIngestService', () => {
  let service: AudioIngestService;
  let audioIngestInterface: jest.Mocked<AudioIngestInterface>;

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

  const mockMessage = {
    type: 'start_call',
    clientId: 'client-123',
    data: {
      audioFormat: 'wav',
      sampleRate: 44100,
    },
  };

  const mockStreamEventData = {
    type: 'stream_event',
    event: 'audio_chunk',
    data: {
      chunk: 'base64-encoded-audio-data',
      timestamp: Date.now(),
    },
  };

  const mockConnectionAliveData = {
    type: 'ping',
    timestamp: Date.now(),
  };

  beforeEach(async () => {
    const mockAudioIngestInterface = {
      startCall: jest.fn(),
      handleAudioMessage: jest.fn(),
      endCall: jest.fn(),
      handleStreamEvent: jest.fn(),
      handleConnectionAlive: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioIngestService,
        {
          provide: 'AudioIngestInterface',
          useValue: mockAudioIngestInterface,
        },
      ],
    }).compile();

    service = module.get<AudioIngestService>(AudioIngestService);
    audioIngestInterface = module.get('AudioIngestInterface');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startCall', () => {
    it('should call audioIngestInterface.startCall with correct parameters', async () => {
      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(mockMessage, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        mockMessage,
        mockWebSocket,
      );
      expect(audioIngestInterface.startCall).toHaveBeenCalledTimes(1);
    });

    it('should handle startCall with different message types', async () => {
      const differentMessage = {
        type: 'initiate_call',
        clientId: 'client-456',
        data: {
          audioFormat: 'mp3',
          sampleRate: 48000,
        },
      };

      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(differentMessage, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        differentMessage,
        mockWebSocket,
      );
    });

    it('should handle startCall with minimal message data', async () => {
      const minimalMessage = {
        type: 'start_call',
        clientId: 'client-789',
      };

      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(minimalMessage, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        minimalMessage,
        mockWebSocket,
      );
    });

    it('should handle startCall with null message', async () => {
      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(null, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        null,
        mockWebSocket,
      );
    });

    it('should handle startCall with undefined message', async () => {
      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(undefined, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        undefined,
        mockWebSocket,
      );
    });

    it('should handle startCall with empty object message', async () => {
      const emptyMessage = {};
      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(emptyMessage, mockWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        emptyMessage,
        mockWebSocket,
      );
    });

    it('should propagate errors from audioIngestInterface.startCall', async () => {
      const error = new Error('Failed to start call');
      audioIngestInterface.startCall.mockRejectedValue(error);

      await expect(
        service.startCall(mockMessage, mockWebSocket),
      ).rejects.toThrow('Failed to start call');
    });

    it('should handle startCall with different WebSocket states', async () => {
      const closedWebSocket = {
        ...mockWebSocket,
        readyState: WebSocket.CLOSED,
      };

      audioIngestInterface.startCall.mockResolvedValue(undefined);

      await service.startCall(mockMessage, closedWebSocket);

      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        mockMessage,
        closedWebSocket,
      );
    });
  });

  describe('handleAudioMessage', () => {
    it('should call audioIngestInterface.handleAudioMessage with correct parameters', () => {
      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(mockMessage, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        mockMessage,
        mockWebSocket,
      );
      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle audio message with different message types', () => {
      const audioMessage = {
        type: 'audio_data',
        clientId: 'client-123',
        data: {
          audioChunk: 'base64-encoded-audio',
          sequenceNumber: 1,
          timestamp: Date.now(),
        },
      };

      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(audioMessage, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        audioMessage,
        mockWebSocket,
      );
    });

    it('should handle audio message with control commands', () => {
      const controlMessage = {
        type: 'control',
        command: 'pause',
        clientId: 'client-123',
      };

      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(controlMessage, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        controlMessage,
        mockWebSocket,
      );
    });

    it('should handle audio message with null data', () => {
      const messageWithNullData = {
        type: 'audio_data',
        clientId: 'client-123',
        data: null,
      };

      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(messageWithNullData, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        messageWithNullData,
        mockWebSocket,
      );
    });

    it('should handle audio message with undefined data', () => {
      const messageWithUndefinedData = {
        type: 'audio_data',
        clientId: 'client-123',
        data: undefined,
      };

      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(messageWithUndefinedData, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        messageWithUndefinedData,
        mockWebSocket,
      );
    });

    it('should handle audio message with large data payload', () => {
      const largeDataMessage = {
        type: 'audio_data',
        clientId: 'client-123',
        data: {
          audioChunk: 'a'.repeat(10000), // Large string
          metadata: {
            size: 10000,
            format: 'wav',
            duration: 5.5,
          },
        },
      };

      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      service.handleAudioMessage(largeDataMessage, mockWebSocket);

      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        largeDataMessage,
        mockWebSocket,
      );
    });

    it('should propagate errors from audioIngestInterface.handleAudioMessage', async () => {
      const error = new Error('Failed to handle audio message');
      audioIngestInterface.handleAudioMessage.mockRejectedValue(error);

      await expect(
        service.handleAudioMessage(mockMessage, mockWebSocket),
      ).rejects.toThrow('Failed to handle audio message');
    });
  });

  describe('endCall', () => {
    it('should call audioIngestInterface.endCall with correct clientId', async () => {
      const clientId = 'client-123';
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(clientId);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(clientId);
      expect(audioIngestInterface.endCall).toHaveBeenCalledTimes(1);
    });

    it('should handle endCall with different client IDs', async () => {
      const clientIds = [
        'client-456',
        'client-789',
        'user-123',
        'session-abc',
        'call-xyz',
      ];

      audioIngestInterface.endCall.mockResolvedValue(undefined);

      for (const clientId of clientIds) {
        await service.endCall(clientId);
        expect(audioIngestInterface.endCall).toHaveBeenCalledWith(clientId);
      }

      expect(audioIngestInterface.endCall).toHaveBeenCalledTimes(
        clientIds.length,
      );
    });

    it('should handle endCall with empty string clientId', async () => {
      const emptyClientId = '';
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(emptyClientId);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(emptyClientId);
    });

    it('should handle endCall with special characters in clientId', async () => {
      const specialClientId = 'client-123@domain.com#session';
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(specialClientId);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(
        specialClientId,
      );
    });

    it('should handle endCall with very long clientId', async () => {
      const longClientId = 'client-' + 'a'.repeat(1000);
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(longClientId);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(longClientId);
    });

    it('should propagate errors from audioIngestInterface.endCall', async () => {
      const clientId = 'client-123';
      const error = new Error('Failed to end call');
      audioIngestInterface.endCall.mockRejectedValue(error);

      await expect(service.endCall(clientId)).rejects.toThrow(
        'Failed to end call',
      );
    });

    it('should handle endCall with null clientId', async () => {
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(null as any);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(null);
    });

    it('should handle endCall with undefined clientId', async () => {
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      await service.endCall(undefined as any);

      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(undefined);
    });
  });

  describe('handleStreamEvent', () => {
    it('should call audioIngestInterface.handleStreamEvent with correct parameters', () => {
      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      service.handleStreamEvent(mockStreamEventData, mockWebSocket);

      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        mockStreamEventData,
        mockWebSocket,
      );
      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledTimes(1);
    });

    it('should handle stream event with different event types', () => {
      const eventTypes = [
        'audio_chunk',
        'stream_start',
        'stream_end',
        'stream_error',
        'quality_change',
        'bitrate_change',
      ];

      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      eventTypes.forEach((eventType) => {
        const eventData = {
          type: 'stream_event',
          event: eventType,
          data: { timestamp: Date.now() },
        };

        service.handleStreamEvent(eventData, mockWebSocket);

        expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
          eventData,
          mockWebSocket,
        );
      });
    });

    it('should handle stream event with metadata', () => {
      const eventWithMetadata = {
        type: 'stream_event',
        event: 'audio_chunk',
        data: {
          chunk: 'base64-data',
          timestamp: Date.now(),
          metadata: {
            bitrate: 128000,
            sampleRate: 44100,
            channels: 2,
            format: 'mp3',
          },
        },
      };

      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      service.handleStreamEvent(eventWithMetadata, mockWebSocket);

      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        eventWithMetadata,
        mockWebSocket,
      );
    });

    it('should handle stream event with error data', () => {
      const errorEvent = {
        type: 'stream_event',
        event: 'stream_error',
        data: {
          error: 'Connection lost',
          code: 'CONNECTION_ERROR',
          timestamp: Date.now(),
        },
      };

      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      service.handleStreamEvent(errorEvent, mockWebSocket);

      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        errorEvent,
        mockWebSocket,
      );
    });

    it('should handle stream event with null data', () => {
      const eventWithNullData = {
        type: 'stream_event',
        event: 'stream_end',
        data: null,
      };

      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      service.handleStreamEvent(eventWithNullData, mockWebSocket);

      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        eventWithNullData,
        mockWebSocket,
      );
    });

    it('should handle stream event with undefined data', () => {
      const eventWithUndefinedData = {
        type: 'stream_event',
        event: 'stream_start',
        data: undefined,
      };

      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);

      service.handleStreamEvent(eventWithUndefinedData, mockWebSocket);

      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        eventWithUndefinedData,
        mockWebSocket,
      );
    });

    it('should propagate errors from audioIngestInterface.handleStreamEvent', async () => {
      const error = new Error('Failed to handle stream event');
      audioIngestInterface.handleStreamEvent.mockRejectedValue(error);

      await expect(
        service.handleStreamEvent(mockStreamEventData, mockWebSocket),
      ).rejects.toThrow('Failed to handle stream event');
    });
  });

  describe('handleConnectionAlive', () => {
    it('should call audioIngestInterface.handleConnectionAlive with correct parameters', () => {
      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, mockConnectionAliveData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        mockConnectionAliveData,
      );
      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should handle connection alive with ping message', () => {
      const pingData = {
        type: 'ping',
        timestamp: Date.now(),
        clientId: 'client-123',
      };

      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, pingData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        pingData,
      );
    });

    it('should handle connection alive with pong message', () => {
      const pongData = {
        type: 'pong',
        timestamp: Date.now(),
        clientId: 'client-123',
      };

      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, pongData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        pongData,
      );
    });

    it('should handle connection alive with heartbeat message', () => {
      const heartbeatData = {
        type: 'heartbeat',
        timestamp: Date.now(),
        clientId: 'client-123',
        status: 'alive',
      };

      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, heartbeatData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        heartbeatData,
      );
    });

    it('should handle connection alive with null message data', () => {
      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, null);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        null,
      );
    });

    it('should handle connection alive with undefined message data', () => {
      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, undefined);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        undefined,
      );
    });

    it('should handle connection alive with empty object message data', () => {
      const emptyData = {};
      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(mockWebSocket, emptyData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        emptyData,
      );
    });

    it('should handle connection alive with different WebSocket states', () => {
      const connectingWebSocket = {
        ...mockWebSocket,
        readyState: WebSocket.CONNECTING,
      };

      const closingWebSocket = {
        ...mockWebSocket,
        readyState: WebSocket.CLOSING,
      };

      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);

      service.handleConnectionAlive(
        connectingWebSocket,
        mockConnectionAliveData,
      );
      service.handleConnectionAlive(closingWebSocket, mockConnectionAliveData);

      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        connectingWebSocket,
        mockConnectionAliveData,
      );
      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        closingWebSocket,
        mockConnectionAliveData,
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle multiple concurrent startCall operations', async () => {
      const messages = [
        { type: 'start_call', clientId: 'client-1' },
        { type: 'start_call', clientId: 'client-2' },
        { type: 'start_call', clientId: 'client-3' },
      ];

      audioIngestInterface.startCall.mockResolvedValue(undefined);

      const promises = messages.map((msg) =>
        service.startCall(msg, mockWebSocket),
      );

      await Promise.all(promises);

      expect(audioIngestInterface.startCall).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple concurrent endCall operations', async () => {
      const clientIds = ['client-1', 'client-2', 'client-3'];

      audioIngestInterface.endCall.mockResolvedValue(undefined);

      const promises = clientIds.map((clientId) => service.endCall(clientId));

      await Promise.all(promises);

      expect(audioIngestInterface.endCall).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed operations concurrently', async () => {
      audioIngestInterface.startCall.mockResolvedValue(undefined);
      audioIngestInterface.endCall.mockResolvedValue(undefined);
      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);

      const operations = [
        service.startCall(mockMessage, mockWebSocket),
        service.endCall('client-123'),
        service.handleAudioMessage(mockMessage, mockWebSocket),
      ];

      await Promise.all(operations);

      expect(audioIngestInterface.startCall).toHaveBeenCalledTimes(1);
      expect(audioIngestInterface.endCall).toHaveBeenCalledTimes(1);
      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete call lifecycle', async () => {
      const clientId = 'client-123';
      const startMessage = { type: 'start_call', clientId };
      const audioMessage = {
        type: 'audio_data',
        clientId,
        data: 'audio-chunk',
      };
      const streamEvent = { type: 'stream_event', event: 'audio_chunk' };
      const connectionAlive = { type: 'ping', clientId };

      audioIngestInterface.startCall.mockResolvedValue(undefined);
      audioIngestInterface.handleAudioMessage.mockResolvedValue(undefined);
      audioIngestInterface.handleStreamEvent.mockResolvedValue(undefined);
      audioIngestInterface.handleConnectionAlive.mockReturnValue(undefined);
      audioIngestInterface.endCall.mockResolvedValue(undefined);

      // Start call
      await service.startCall(startMessage, mockWebSocket);
      expect(audioIngestInterface.startCall).toHaveBeenCalledWith(
        startMessage,
        mockWebSocket,
      );

      // Handle audio messages
      service.handleAudioMessage(audioMessage, mockWebSocket);
      expect(audioIngestInterface.handleAudioMessage).toHaveBeenCalledWith(
        audioMessage,
        mockWebSocket,
      );

      // Handle stream events
      service.handleStreamEvent(streamEvent, mockWebSocket);
      expect(audioIngestInterface.handleStreamEvent).toHaveBeenCalledWith(
        streamEvent,
        mockWebSocket,
      );

      // Handle connection alive
      service.handleConnectionAlive(mockWebSocket, connectionAlive);
      expect(audioIngestInterface.handleConnectionAlive).toHaveBeenCalledWith(
        mockWebSocket,
        connectionAlive,
      );

      // End call
      await service.endCall(clientId);
      expect(audioIngestInterface.endCall).toHaveBeenCalledWith(clientId);
    });
  });
});
