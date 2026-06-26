import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { TranscriptionRequestDlqConsumer } from '../transcription-request-dlq.consumer';
import { ChatService } from '../../../chat/service/chat.service';
import { LoggerService } from '../../../logger/logger.service';
import { ChatSummaryStatus } from '../../../chat/entity/chat.entity';

describe('TranscriptionRequestDlqConsumer', () => {
  let consumer: TranscriptionRequestDlqConsumer;
  let chatService: jest.Mocked<ChatService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockDlqMessage = {
    message_type: 'transcribe_and_summarize_request',
    chat_id: 'chat-123',
    audio_url: 'https://example.com/audio.wav',
    user_id: 'user-456',
    session_id: 'session-789',
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
        TranscriptionRequestDlqConsumer,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    consumer = module.get<TranscriptionRequestDlqConsumer>(
      TranscriptionRequestDlqConsumer,
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
        'TranscriptionRequestDlqConsumer',
      );
    });
  });

  describe('handleTranscriptionRequestDlq', () => {
    it('should process DLQ message successfully', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-123',
        Body: JSON.stringify(mockDlqMessage),
        ReceiptHandle: 'dlq-receipt-123',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing transcription request DLQ message: ${mockDlqMessage.message_type} for chat ${mockDlqMessage.chat_id}`,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockDlqMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: mockDlqMessage,
            stage: 'transcription-request-dlq',
            error: 'Transcription request dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should return early when message body is undefined', async () => {
      const messageWithoutBody: Message = {
        MessageId: 'dlq-msg-no-body',
        Body: undefined,
        ReceiptHandle: 'dlq-receipt-no-body',
      };

      await consumer.handleTranscriptionRequestDlq(messageWithoutBody);

      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should return early when message body is empty string', async () => {
      const messageWithEmptyBody: Message = {
        MessageId: 'dlq-msg-empty',
        Body: '',
        ReceiptHandle: 'dlq-receipt-empty',
      };

      await consumer.handleTranscriptionRequestDlq(messageWithEmptyBody);

      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should handle JSON parsing error and re-throw', async () => {
      const messageWithInvalidJson: Message = {
        MessageId: 'dlq-msg-invalid',
        Body: 'invalid-json-content',
        ReceiptHandle: 'dlq-receipt-invalid',
      };

      await expect(
        consumer.handleTranscriptionRequestDlq(messageWithInvalidJson),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process message dlq-msg-invalid:'),
      );
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle chat service error and re-throw', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-chat-error',
        Body: JSON.stringify(mockDlqMessage),
        ReceiptHandle: 'dlq-receipt-chat-error',
      };

      const chatError = new Error('Chat service failed');
      chatService.updateChat.mockRejectedValue(chatError);

      await expect(
        consumer.handleTranscriptionRequestDlq(message),
      ).rejects.toThrow('Chat service failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message dlq-msg-chat-error: with error ${JSON.stringify(chatError)}`,
      );
    });

    it('should handle message without chat_id', async () => {
      const messageWithoutChatId = {
        ...mockDlqMessage,
        chat_id: undefined,
      };

      const message: Message = {
        MessageId: 'dlq-msg-no-chat-id',
        Body: JSON.stringify(messageWithoutChatId),
        ReceiptHandle: 'dlq-receipt-no-chat-id',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(undefined, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: messageWithoutChatId,
          stage: 'transcription-request-dlq',
          error: 'Transcription request dead-lettered (exhausted retries)',
        },
      });
    });

    it('should handle message with different message type', async () => {
      const differentMessage = {
        ...mockDlqMessage,
        message_type: 'different_type',
      };

      const message: Message = {
        MessageId: 'dlq-msg-different',
        Body: JSON.stringify(differentMessage),
        ReceiptHandle: 'dlq-receipt-different',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing transcription request DLQ message: different_type for chat ${differentMessage.chat_id}`,
      );
    });

    it('should handle message with minimal fields', async () => {
      const minimalMessage = {
        message_type: 'transcribe_request',
        chat_id: 'chat-minimal',
      };

      const message: Message = {
        MessageId: 'dlq-msg-minimal',
        Body: JSON.stringify(minimalMessage),
        ReceiptHandle: 'dlq-receipt-minimal',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        minimalMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: minimalMessage,
            stage: 'transcription-request-dlq',
            error: 'Transcription request dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle message with additional fields', async () => {
      const messageWithExtraFields = {
        ...mockDlqMessage,
        extra_field: 'extra_value',
        timestamp: Date.now(),
      };

      const message: Message = {
        MessageId: 'dlq-msg-extra',
        Body: JSON.stringify(messageWithExtraFields),
        ReceiptHandle: 'dlq-receipt-extra',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        messageWithExtraFields.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: messageWithExtraFields,
            stage: 'transcription-request-dlq',
            error: 'Transcription request dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle message without MessageId', async () => {
      const messageWithoutId: Message = {
        Body: JSON.stringify(mockDlqMessage),
        ReceiptHandle: 'dlq-receipt-no-id',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(messageWithoutId);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockDlqMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: mockDlqMessage,
            stage: 'transcription-request-dlq',
            error: 'Transcription request dead-lettered (exhausted retries)',
          },
        },
      );
    });

    it('should handle concurrent DLQ message processing', async () => {
      const message1: Message = {
        MessageId: 'dlq-msg-1',
        Body: JSON.stringify({ ...mockDlqMessage, chat_id: 'chat-1' }),
        ReceiptHandle: 'dlq-receipt-1',
      };

      const message2: Message = {
        MessageId: 'dlq-msg-2',
        Body: JSON.stringify({ ...mockDlqMessage, chat_id: 'chat-2' }),
        ReceiptHandle: 'dlq-receipt-2',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await Promise.all([
        consumer.handleTranscriptionRequestDlq(message1),
        consumer.handleTranscriptionRequestDlq(message2),
      ]);

      expect(chatService.updateChat).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should handle empty JSON object', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-empty-json',
        Body: '{}',
        ReceiptHandle: 'dlq-receipt-empty-json',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(undefined, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: {},
          stage: 'transcription-request-dlq',
          error: 'Transcription request dead-lettered (exhausted retries)',
        },
      });
    });

    it('should handle JSON with null values', async () => {
      const messageWithNulls = {
        message_type: null,
        chat_id: null,
        audio_url: null,
      };

      const message: Message = {
        MessageId: 'dlq-msg-nulls',
        Body: JSON.stringify(messageWithNulls),
        ReceiptHandle: 'dlq-receipt-nulls',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(null, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: messageWithNulls,
          stage: 'transcription-request-dlq',
          error: 'Transcription request dead-lettered (exhausted retries)',
        },
      });
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should re-throw JSON parsing errors to prevent message deletion', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-json-error',
        Body: '{"invalid": json}',
        ReceiptHandle: 'dlq-receipt-json-error',
      };

      await expect(
        consumer.handleTranscriptionRequestDlq(message),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should re-throw chat service errors to prevent message deletion', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-service-error',
        Body: JSON.stringify(mockDlqMessage),
        ReceiptHandle: 'dlq-receipt-service-error',
      };

      const serviceError = new Error('Service unavailable');
      chatService.updateChat.mockRejectedValue(serviceError);

      await expect(
        consumer.handleTranscriptionRequestDlq(message),
      ).rejects.toThrow('Service unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to process message dlq-msg-service-error: with error ${JSON.stringify(serviceError)}`,
      );
    });

    it('should handle circular reference in error object', async () => {
      const message: Message = {
        MessageId: 'dlq-msg-circular',
        Body: JSON.stringify(mockDlqMessage),
        ReceiptHandle: 'dlq-receipt-circular',
      };

      const circularError: any = new Error('Circular error');
      circularError.self = circularError;
      chatService.updateChat.mockRejectedValue(circularError);

      await expect(
        consumer.handleTranscriptionRequestDlq(message),
      ).rejects.toThrow(); // Will throw due to JSON.stringify circular reference

      // Logger is not called because JSON.stringify throws first
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle very large DLQ message bodies', async () => {
      const largeMessage = {
        ...mockDlqMessage,
        large_field: 'A'.repeat(10000), // 10KB string
      };

      const message: Message = {
        MessageId: 'dlq-msg-large',
        Body: JSON.stringify(largeMessage),
        ReceiptHandle: 'dlq-receipt-large',
      };

      chatService.updateChat.mockResolvedValue({} as any);

      await consumer.handleTranscriptionRequestDlq(message);

      expect(chatService.updateChat).toHaveBeenCalledWith(
        largeMessage.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: {
            dlq_message: largeMessage,
            stage: 'transcription-request-dlq',
            error: 'Transcription request dead-lettered (exhausted retries)',
          },
        },
      );
    });
  });
});
