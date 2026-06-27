import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { TranscriptionResponseDlqConsumer } from '../transcription-response-dlq.consumer';
import { ChatService } from '../../../chat/service/chat.service';
import { LoggerService } from '../../../logger/logger.service';
import { ChatSummaryStatus } from '../../../chat/entity/chat.entity';

describe('TranscriptionResponseDlqConsumer', () => {
  let consumer: TranscriptionResponseDlqConsumer;
  let chatService: jest.Mocked<ChatService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockDlqResponseMessage = {
    message_type: 'transcribe_and_summarize_response',
    chat_id: 'chat-123',
    status: 'failed',
    error: 'Transcription failed',
    transcript: null,
    summary: null,
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

    const mockChatService = {
      updateChat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionResponseDlqConsumer,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    consumer = module.get<TranscriptionResponseDlqConsumer>(
      TranscriptionResponseDlqConsumer,
    );
    chatService = module.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(consumer).toBeDefined();
    });

    it('should initialize logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith(
        'TranscriptionResponseDlqConsumer',
      );
    });
  });

  describe('handleTranscriptionResponseDlq', () => {
    it('should process DLQ response message successfully', async () => {
      const message: Message = {
        MessageId: 'dlq-response-123',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-123',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing transcription response DLQ message: ${mockDlqResponseMessage.message_type} for chat ${mockDlqResponseMessage.chat_id}`,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockDlqResponseMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: mockDlqResponseMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Updated chat ${mockDlqResponseMessage.chat_id} status to FAILED due to transcription response DLQ`,
      );
    });

    it('should return early when message body is undefined', async () => {
      const messageWithoutBody: Message = {
        MessageId: 'dlq-response-no-body',
        Body: undefined,
        ReceiptHandle: 'dlq-response-receipt-no-body',
      };

      await consumer.handleTranscriptionResponseDlq(messageWithoutBody);

      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should return early when message body is empty string', async () => {
      const messageWithEmptyBody: Message = {
        MessageId: 'dlq-response-empty',
        Body: '',
        ReceiptHandle: 'dlq-response-receipt-empty',
      };

      await consumer.handleTranscriptionResponseDlq(messageWithEmptyBody);

      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should handle JSON parsing error and re-throw', async () => {
      const messageWithInvalidJson: Message = {
        MessageId: 'dlq-response-invalid',
        Body: 'invalid-json-content',
        ReceiptHandle: 'dlq-response-receipt-invalid',
      };

      await expect(
        consumer.handleTranscriptionResponseDlq(messageWithInvalidJson),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to process message dlq-response-invalid:',
        ),
      );
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle chat service error and re-throw', async () => {
      const message: Message = {
        MessageId: 'dlq-response-chat-error',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-chat-error',
      };

      const chatError = new Error('Chat service failed');
      chatService.updateChat.mockRejectedValue(chatError);

      await expect(
        consumer.handleTranscriptionResponseDlq(message),
      ).rejects.toThrow('Chat service failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message dlq-response-chat-error: with error ${JSON.stringify(chatError)}`,
      );
    });

    it('should handle message without chat_id', async () => {
      const messageWithoutChatId = {
        ...mockDlqResponseMessage,
        chat_id: undefined,
      };

      const message: Message = {
        MessageId: 'dlq-response-no-chat-id',
        Body: JSON.stringify(messageWithoutChatId),
        ReceiptHandle: 'dlq-response-receipt-no-chat-id',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(undefined, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: messageWithoutChatId,
          stage: 'transcription-response-dlq',
          error:
            'Transcription result delivery dead-lettered (exhausted retries)',
        },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Updated chat undefined status to FAILED due to transcription response DLQ`,
      );
    });

    it('should handle message with different message type', async () => {
      const differentMessage = {
        ...mockDlqResponseMessage,
        message_type: 'different_response_type',
      };

      const message: Message = {
        MessageId: 'dlq-response-different',
        Body: JSON.stringify(differentMessage),
        ReceiptHandle: 'dlq-response-receipt-different',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing transcription response DLQ message: different_response_type for chat ${differentMessage.chat_id}`,
      );
    });

    it('should handle successful response message in DLQ', async () => {
      const successfulMessage = {
        ...mockDlqResponseMessage,
        status: 'completed',
        transcript: 'Successful transcript',
        summary: 'Successful summary',
      };

      const message: Message = {
        MessageId: 'dlq-response-success',
        Body: JSON.stringify(successfulMessage),
        ReceiptHandle: 'dlq-response-receipt-success',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        successfulMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: successfulMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle message with minimal fields', async () => {
      const minimalMessage = {
        message_type: 'transcribe_response',
        chat_id: 'chat-minimal',
      };

      const message: Message = {
        MessageId: 'dlq-response-minimal',
        Body: JSON.stringify(minimalMessage),
        ReceiptHandle: 'dlq-response-receipt-minimal',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        minimalMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: minimalMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle message with additional fields', async () => {
      const messageWithExtraFields = {
        ...mockDlqResponseMessage,
        extra_field: 'extra_value',
        retry_count: 3,
        original_timestamp: Date.now(),
      };

      const message: Message = {
        MessageId: 'dlq-response-extra',
        Body: JSON.stringify(messageWithExtraFields),
        ReceiptHandle: 'dlq-response-receipt-extra',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        messageWithExtraFields.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: messageWithExtraFields,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle message without MessageId', async () => {
      const messageWithoutId: Message = {
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-no-id',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(messageWithoutId);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockDlqResponseMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: mockDlqResponseMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle concurrent DLQ response message processing', async () => {
      const message1: Message = {
        MessageId: 'dlq-response-1',
        Body: JSON.stringify({ ...mockDlqResponseMessage, chat_id: 'chat-1' }),
        ReceiptHandle: 'dlq-response-receipt-1',
      };

      const message2: Message = {
        MessageId: 'dlq-response-2',
        Body: JSON.stringify({ ...mockDlqResponseMessage, chat_id: 'chat-2' }),
        ReceiptHandle: 'dlq-response-receipt-2',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await Promise.all([
        consumer.handleTranscriptionResponseDlq(message1),
        consumer.handleTranscriptionResponseDlq(message2),
      ]);

      expect(chatService.updateChat).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(4); // 2 processing + 2 update messages
    });

    it('should handle empty JSON object', async () => {
      const message: Message = {
        MessageId: 'dlq-response-empty-json',
        Body: '{}',
        ReceiptHandle: 'dlq-response-receipt-empty-json',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(undefined, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: {},
          stage: 'transcription-response-dlq',
          error:
            'Transcription result delivery dead-lettered (exhausted retries)',
        },
      });
    });

    it('should handle JSON with null values', async () => {
      const messageWithNulls = {
        message_type: null,
        chat_id: null,
        status: null,
        error: null,
      };

      const message: Message = {
        MessageId: 'dlq-response-nulls',
        Body: JSON.stringify(messageWithNulls),
        ReceiptHandle: 'dlq-response-receipt-nulls',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(null, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: messageWithNulls,
          stage: 'transcription-response-dlq',
          error:
            'Transcription result delivery dead-lettered (exhausted retries)',
        },
      });
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should re-throw JSON parsing errors to prevent message deletion', async () => {
      const message: Message = {
        MessageId: 'dlq-response-json-error',
        Body: '{"invalid": json}',
        ReceiptHandle: 'dlq-response-receipt-json-error',
      };

      await expect(
        consumer.handleTranscriptionResponseDlq(message),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should re-throw chat service errors to prevent message deletion', async () => {
      const message: Message = {
        MessageId: 'dlq-response-service-error',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-service-error',
      };

      const serviceError = new Error('Service unavailable');
      chatService.updateChat.mockRejectedValue(serviceError);

      await expect(
        consumer.handleTranscriptionResponseDlq(message),
      ).rejects.toThrow('Service unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message dlq-response-service-error: with error ${JSON.stringify(serviceError)}`,
      );
    });

    it('should handle circular reference in error object', async () => {
      const message: Message = {
        MessageId: 'dlq-response-circular',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-circular',
      };

      const circularError: any = new Error('Circular error');
      circularError.self = circularError;
      chatService.updateChat.mockRejectedValue(circularError);

      await expect(
        consumer.handleTranscriptionResponseDlq(message),
      ).rejects.toThrow('Converting circular structure to JSON');

      // Logger is not called because JSON.stringify throws first
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle timeout errors', async () => {
      const message: Message = {
        MessageId: 'dlq-response-timeout',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-timeout',
      };

      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      chatService.updateChat.mockRejectedValue(timeoutError);

      await expect(
        consumer.handleTranscriptionResponseDlq(message),
      ).rejects.toThrow('Request timeout');
    });

    it('should handle very large DLQ response message bodies', async () => {
      const largeMessage = {
        ...mockDlqResponseMessage,
        large_transcript: 'A'.repeat(10000), // 10KB string
        large_summary: 'B'.repeat(5000), // 5KB string
      };

      const message: Message = {
        MessageId: 'dlq-response-large',
        Body: JSON.stringify(largeMessage),
        ReceiptHandle: 'dlq-response-receipt-large',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        largeMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: largeMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        },
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete DLQ processing flow', async () => {
      const message: Message = {
        MessageId: 'dlq-response-complete',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-complete',
      };

      chatService.updateChat.mockResolvedValue({
        id: mockDlqResponseMessage.chat_id,
        summaryStatus: ChatSummaryStatus.FAILED,
      } as any);

      await consumer.handleTranscriptionResponseDlq(message);

      // Verify complete flow
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(chatService.updateChat).toHaveBeenCalled();
    });

    it('should maintain message data integrity', async () => {
      const originalMessage = { ...mockDlqResponseMessage };
      const message: Message = {
        MessageId: 'dlq-response-integrity',
        Body: JSON.stringify(mockDlqResponseMessage),
        ReceiptHandle: 'dlq-response-receipt-integrity',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionResponseDlq(message);

      // Verify message wasn't mutated
      expect(mockDlqResponseMessage).toEqual(originalMessage);
      expect(chatService.updateChat).toHaveBeenCalledWith(
        originalMessage.chat_id,
        expect.objectContaining({
          metadata: {
            dlq_message: originalMessage,
            stage: 'transcription-response-dlq',
            error:
              'Transcription result delivery dead-lettered (exhausted retries)',
          },
        }),
      );
    });
  });
});
