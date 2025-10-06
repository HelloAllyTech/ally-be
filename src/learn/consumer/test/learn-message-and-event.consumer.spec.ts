import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { LearnMessageAndEventConsumer } from '../learn-message-and-event.consumer';
import { ProcessorRegistry } from 'src/ai/processors/processor-registry';
import { LoggerService } from 'src/logger/logger.service';

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

describe('LearnMessageAndEventConsumer', () => {
  let consumer: LearnMessageAndEventConsumer;
  let processorRegistry: jest.Mocked<ProcessorRegistry>;
  let mockLogger: jest.Mocked<any>;

  const mockMessage: Message = {
    MessageId: 'test-message-id',
    Body: JSON.stringify({
      message_type: 'test_message',
      timestamp: Date.now(),
      room_id: 'room-123',
      data: {
        chat_message: {
          role: 'CLIENT',
          content: 'Test message',
        },
      },
    }),
    ReceiptHandle: 'test-receipt-handle',
  };

  beforeEach(async () => {
    const mockProcessorRegistry = {
      processEvent: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnMessageAndEventConsumer,
        {
          provide: ProcessorRegistry,
          useValue: mockProcessorRegistry,
        },
      ],
    }).compile();

    consumer = module.get<LearnMessageAndEventConsumer>(
      LearnMessageAndEventConsumer,
    );
    processorRegistry = module.get(ProcessorRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleLearnMessageAndEvent', () => {
    it('should return early when message body is empty', async () => {
      const messageWithoutBody: Message = {
        MessageId: 'test-message-id',
        Body: undefined,
        ReceiptHandle: 'test-receipt-handle',
      };

      await consumer.handleLearnMessageAndEvent(messageWithoutBody);

      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should return early when message body is null', async () => {
      const messageWithNullBody: Message = {
        MessageId: 'test-message-id',
        Body: undefined, // Use undefined instead of null
        ReceiptHandle: 'test-receipt-handle',
      };

      await consumer.handleLearnMessageAndEvent(messageWithNullBody);

      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should return early when message body is empty string', async () => {
      const messageWithEmptyBody: Message = {
        MessageId: 'test-message-id',
        Body: '',
        ReceiptHandle: 'test-receipt-handle',
      };

      await consumer.handleLearnMessageAndEvent(messageWithEmptyBody);

      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should successfully process valid message', async () => {
      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleLearnMessageAndEvent(mockMessage);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: test_message',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        'test_message',
        JSON.parse(mockMessage.Body!),
      );
    });

    it('should handle JSON parsing error', async () => {
      const invalidJsonMessage: Message = {
        MessageId: 'test-message-id',
        Body: 'invalid json',
        ReceiptHandle: 'test-receipt-handle',
      };

      await expect(
        consumer.handleLearnMessageAndEvent(invalidJsonMessage),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process message test-message-id:'),
      );
      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
    });

    it('should handle processor registry error', async () => {
      const processingError = new Error('Processing failed');
      processorRegistry.processEvent.mockRejectedValue(processingError);

      await expect(
        consumer.handleLearnMessageAndEvent(mockMessage),
      ).rejects.toThrow('Processing failed');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: test_message',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process message test-message-id: "Processing failed"',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        'test_message',
        JSON.parse(mockMessage.Body!),
      );
    });

    it('should handle message without MessageId', async () => {
      const messageWithoutId: Message = {
        Body: JSON.stringify({
          message_type: 'test_message',
          data: {},
        }),
        ReceiptHandle: 'test-receipt-handle',
      };

      const processingError = new Error('Processing failed');
      processorRegistry.processEvent.mockRejectedValue(processingError);

      await expect(
        consumer.handleLearnMessageAndEvent(messageWithoutId),
      ).rejects.toThrow('Processing failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process message undefined: "Processing failed"',
      );
    });

    it('should handle different message types', async () => {
      const eventMessage: Message = {
        MessageId: 'event-message-id',
        Body: JSON.stringify({
          message_type: 'event',
          timestamp: Date.now(),
          room_id: 'room-456',
          data: {
            event: {
              event_id: 'event-123',
              timestamp: new Date(),
            },
          },
        }),
        ReceiptHandle: 'test-receipt-handle',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleLearnMessageAndEvent(eventMessage);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: event',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        'event',
        JSON.parse(eventMessage.Body!),
      );
    });

    it('should handle complex message data', async () => {
      const complexMessage: Message = {
        MessageId: 'complex-message-id',
        Body: JSON.stringify({
          message_type: 'complex_message',
          timestamp: Date.now(),
          room_id: 'room-789',
          data: {
            chat_message: {
              role: 'COUNSELOR',
              content: 'Complex message with special characters: @#$%^&*()',
              start_time: 10.5,
              end_time: 15.2,
            },
            metadata: {
              source: 'test',
              version: '1.0',
            },
          },
        }),
        ReceiptHandle: 'test-receipt-handle',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleLearnMessageAndEvent(complexMessage);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: complex_message',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        'complex_message',
        JSON.parse(complexMessage.Body!),
      );
    });

    it('should handle processor registry throwing non-Error object', async () => {
      const nonErrorObject = 'String error';
      processorRegistry.processEvent.mockRejectedValue(nonErrorObject);

      await expect(
        consumer.handleLearnMessageAndEvent(mockMessage),
      ).rejects.toBe(nonErrorObject);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process message test-message-id: undefined',
      );
    });

    it('should handle empty message type', async () => {
      const messageWithEmptyType: Message = {
        MessageId: 'empty-type-message-id',
        Body: JSON.stringify({
          message_type: '',
          data: {},
        }),
        ReceiptHandle: 'test-receipt-handle',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleLearnMessageAndEvent(messageWithEmptyType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: ',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        '',
        JSON.parse(messageWithEmptyType.Body!),
      );
    });

    it('should handle message with null message_type', async () => {
      const messageWithNullType: Message = {
        MessageId: 'null-type-message-id',
        Body: JSON.stringify({
          message_type: null,
          data: {},
        }),
        ReceiptHandle: 'test-receipt-handle',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleLearnMessageAndEvent(messageWithNullType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing learn message and event: null',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        null,
        JSON.parse(messageWithNullType.Body!),
      );
    });
  });
});
