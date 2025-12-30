import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { AiEventConsumer } from '../ai-event.consumer';
import { ProcessorRegistry } from '../../processors/processor-registry';
import { LoggerService } from '../../../logger/logger.service';
import { TranscribeAndSummarizeResponseMessage } from '../../dto/transcribe-and-summarize-response.model';

describe('AiEventConsumer', () => {
  let consumer: AiEventConsumer;
  let processorRegistry: jest.Mocked<ProcessorRegistry>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockTranscribeResponse: TranscribeAndSummarizeResponseMessage = {
    message_type: 'transcribe_and_summarize_response',
    timestamp: Date.now(),
    chat_id: 123,
  };

  beforeEach(async () => {
    // Mock LoggerService
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);

    const mockProcessorRegistry = {
      processEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEventConsumer,
        {
          provide: ProcessorRegistry,
          useValue: mockProcessorRegistry,
        },
      ],
    }).compile();

    consumer = module.get<AiEventConsumer>(AiEventConsumer);
    processorRegistry = module.get(ProcessorRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(consumer).toBeDefined();
    });

    it('should initialize logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith('AiEventConsumer');
    });
  });

  describe('handleTranscribeAndSummarizeResponse', () => {
    it('should process valid message successfully', async () => {
      const message: Message = {
        MessageId: 'msg-123',
        Body: JSON.stringify(mockTranscribeResponse),
        ReceiptHandle: 'receipt-handle-123',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing AI event: ${mockTranscribeResponse.message_type}`,
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        mockTranscribeResponse.message_type,
        mockTranscribeResponse,
      );
    });

    it('should return early when message body is undefined', async () => {
      const messageWithoutBody: Message = {
        MessageId: 'msg-123',
        Body: undefined,
        ReceiptHandle: 'receipt-handle-123',
      };

      await consumer.handleTranscribeAndSummarizeResponse(messageWithoutBody);

      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should return early when message body is empty string', async () => {
      const messageWithEmptyBody: Message = {
        MessageId: 'msg-123',
        Body: '',
        ReceiptHandle: 'receipt-handle-123',
      };

      await consumer.handleTranscribeAndSummarizeResponse(messageWithEmptyBody);

      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should handle JSON parsing error', async () => {
      const messageWithInvalidJson: Message = {
        MessageId: 'msg-123',
        Body: 'invalid-json-content',
        ReceiptHandle: 'receipt-handle-123',
      };

      await expect(
        consumer.handleTranscribeAndSummarizeResponse(messageWithInvalidJson),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process message msg-123:'),
      );
      expect(processorRegistry.processEvent).not.toHaveBeenCalled();
    });

    it('should handle processor registry error', async () => {
      const message: Message = {
        MessageId: 'msg-123',
        Body: JSON.stringify(mockTranscribeResponse),
        ReceiptHandle: 'receipt-handle-123',
      };

      const processorError = new Error('Processor failed');
      processorRegistry.processEvent.mockRejectedValue(processorError);

      await expect(
        consumer.handleTranscribeAndSummarizeResponse(message),
      ).rejects.toThrow('Processor failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message msg-123: ${JSON.stringify(processorError)}`,
      );
    });

    it('should handle different message types', async () => {
      const differentResponse = {
        ...mockTranscribeResponse,
        message_type: 'different_message_type' as any,
      };

      const message: Message = {
        MessageId: 'msg-456',
        Body: JSON.stringify(differentResponse),
        ReceiptHandle: 'receipt-handle-456',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing AI event: different_message_type',
      );
      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        'different_message_type',
        differentResponse,
      );
    });

    it('should handle message with minimal required fields', async () => {
      const minimalResponse = {
        message_type: 'transcribe_and_summarize_response',
        chat_id: 123,
      };

      const message: Message = {
        MessageId: 'msg-789',
        Body: JSON.stringify(minimalResponse),
        ReceiptHandle: 'receipt-handle-789',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        minimalResponse.message_type,
        minimalResponse,
      );
    });

    it('should handle message with additional unexpected fields', async () => {
      const responseWithExtraFields = {
        ...mockTranscribeResponse,
        extra_field: 'unexpected_value',
        another_field: 123,
      };

      const message: Message = {
        MessageId: 'msg-extra',
        Body: JSON.stringify(responseWithExtraFields),
        ReceiptHandle: 'receipt-handle-extra',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        responseWithExtraFields.message_type,
        responseWithExtraFields,
      );
    });

    it('should handle message without MessageId', async () => {
      const messageWithoutId: Message = {
        Body: JSON.stringify(mockTranscribeResponse),
        ReceiptHandle: 'receipt-handle-no-id',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(messageWithoutId);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        mockTranscribeResponse.message_type,
        mockTranscribeResponse,
      );
    });

    it('should handle concurrent message processing', async () => {
      const message1: Message = {
        MessageId: 'msg-1',
        Body: JSON.stringify({ ...mockTranscribeResponse, chat_id: 'chat-1' }),
        ReceiptHandle: 'receipt-1',
      };

      const message2: Message = {
        MessageId: 'msg-2',
        Body: JSON.stringify({ ...mockTranscribeResponse, chat_id: 'chat-2' }),
        ReceiptHandle: 'receipt-2',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await Promise.all([
        consumer.handleTranscribeAndSummarizeResponse(message1),
        consumer.handleTranscribeAndSummarizeResponse(message2),
      ]);

      expect(processorRegistry.processEvent).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should handle malformed JSON with special characters', async () => {
      const messageWithSpecialChars: Message = {
        MessageId: 'msg-special',
        Body: '{"message_type": "test", "invalid": }',
        ReceiptHandle: 'receipt-special',
      };

      await expect(
        consumer.handleTranscribeAndSummarizeResponse(messageWithSpecialChars),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process message msg-special:'),
      );
    });

    it('should handle empty JSON object', async () => {
      const messageWithEmptyJson: Message = {
        MessageId: 'msg-empty',
        Body: '{}',
        ReceiptHandle: 'receipt-empty',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(messageWithEmptyJson);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        undefined,
        {},
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing AI event: undefined',
      );
    });

    it('should handle JSON with null values', async () => {
      const responseWithNulls = {
        message_type: 'transcribe_and_summarize_response',
        chat_id: null,
        status: null,
        transcript: null,
        summary: null,
      };

      const message: Message = {
        MessageId: 'msg-nulls',
        Body: JSON.stringify(responseWithNulls),
        ReceiptHandle: 'receipt-nulls',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        responseWithNulls.message_type,
        responseWithNulls,
      );
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should re-throw processor registry errors', async () => {
      const message: Message = {
        MessageId: 'msg-error',
        Body: JSON.stringify(mockTranscribeResponse),
        ReceiptHandle: 'receipt-error',
      };

      const customError = new Error('Custom processor error');
      customError.name = 'CustomProcessorError';
      processorRegistry.processEvent.mockRejectedValue(customError);

      await expect(
        consumer.handleTranscribeAndSummarizeResponse(message),
      ).rejects.toThrow('Custom processor error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message msg-error: ${JSON.stringify(customError)}`,
      );
    });

    it('should handle circular reference in error object', async () => {
      const message: Message = {
        MessageId: 'msg-circular',
        Body: JSON.stringify(mockTranscribeResponse),
        ReceiptHandle: 'receipt-circular',
      };

      const circularError: any = new Error('Circular error');
      circularError.self = circularError; // Create circular reference
      processorRegistry.processEvent.mockRejectedValue(circularError);

      await expect(
        consumer.handleTranscribeAndSummarizeResponse(message),
      ).rejects.toThrow('Converting circular structure to JSON');

      // Logger is not called because JSON.stringify throws before the logger call
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle very large message bodies', async () => {
      const largeTranscript = 'A'.repeat(10000); // 10KB string
      const largeResponse = {
        ...mockTranscribeResponse,
        transcript: largeTranscript,
      };

      const message: Message = {
        MessageId: 'msg-large',
        Body: JSON.stringify(largeResponse),
        ReceiptHandle: 'receipt-large',
      };

      processorRegistry.processEvent.mockResolvedValue(undefined);

      await consumer.handleTranscribeAndSummarizeResponse(message);

      expect(processorRegistry.processEvent).toHaveBeenCalledWith(
        largeResponse.message_type,
        largeResponse,
      );
    });
  });
});
