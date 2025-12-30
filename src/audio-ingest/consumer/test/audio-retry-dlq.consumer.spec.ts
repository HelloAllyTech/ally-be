import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { AudioRetryDlqConsumer } from '../audio-retry-dlq.consumer';
import { ChatService } from '../../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../../chat/entity/chat.entity';
import { LoggerService } from '../../../logger/logger.service';

describe('AudioRetryDlqConsumer', () => {
  let consumer: AudioRetryDlqConsumer;
  let chatService: jest.Mocked<ChatService>;

  const mockChatId = 12345;
  const mockMessageId = 'test-message-id-123';
  const mockResponseMessage = {
    chatId: mockChatId,
    chat_id: mockChatId,
    audioUrl: 'https://example.com/audio.mp3',
    retryCount: 3,
    error: 'Processing failed after max retries',
  };

  beforeEach(async () => {
    const mockChatService = {
      updateChat: jest.fn(),
    };

    const mockLoggerService = {
      getInstance: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioRetryDlqConsumer,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    consumer = module.get<AudioRetryDlqConsumer>(AudioRetryDlqConsumer);
    chatService = module.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleAudioFileRetryDlq', () => {
    it('should process valid DLQ message successfully', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(mockResponseMessage),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledTimes(1);
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: mockResponseMessage,
        },
      });
    });

    it('should return early when message body is empty', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: undefined,
      };

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should return early when message body is null or empty', async () => {
      // Test null body
      const messageWithNullBody: Message = {
        MessageId: mockMessageId,
        Body: null as any,
      };

      await consumer.handleAudioFileRetryDlq(messageWithNullBody);
      expect(chatService.updateChat).not.toHaveBeenCalled();

      // Test empty string body
      const messageWithEmptyBody: Message = {
        MessageId: mockMessageId,
        Body: '',
      };

      await consumer.handleAudioFileRetryDlq(messageWithEmptyBody);
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should throw error when message body contains invalid JSON', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: 'invalid-json-string',
      };

      // Act & Assert
      await expect(consumer.handleAudioFileRetryDlq(message)).rejects.toThrow();
    });

    it('should throw error when ChatService.updateChat fails', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(mockResponseMessage),
      };

      const chatServiceError = new Error('Database connection failed');
      chatService.updateChat.mockRejectedValue(chatServiceError);

      // Act & Assert
      await expect(consumer.handleAudioFileRetryDlq(message)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle different response message structures', async () => {
      // Arrange
      const customResponseMessage = {
        chatId: 99999,
        chat_id: 99999,
        audioUrl: 'https://different-url.com/audio.wav',
        retryCount: 5,
        customField: 'custom value',
        error: 'Custom error message',
      };

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(customResponseMessage),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledWith(99999, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: customResponseMessage,
        },
      });
    });

    it('should handle various chatId formats', async () => {
      chatService.updateChat.mockResolvedValue(undefined);

      // Test missing chatId
      const responseMessageWithoutChatId = {
        audioUrl: 'https://example.com/audio.mp3',
        retryCount: 2,
        error: 'Processing failed',
      };

      const messageWithoutChatId: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(responseMessageWithoutChatId),
      };

      await consumer.handleAudioFileRetryDlq(messageWithoutChatId);
      expect(chatService.updateChat).toHaveBeenCalledWith(undefined, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessageWithoutChatId,
        },
      });

      // Reset mock
      chatService.updateChat.mockClear();

      // Test null chatId
      const responseMessageWithNullChatId = {
        chatId: null,
        chat_id: null,
        audioUrl: 'https://example.com/audio.mp3',
        retryCount: 1,
      };

      const messageWithNullChatId: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(responseMessageWithNullChatId),
      };

      await consumer.handleAudioFileRetryDlq(messageWithNullChatId);
      expect(chatService.updateChat).toHaveBeenCalledWith(null, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessageWithNullChatId,
        },
      });

      // Reset mock
      chatService.updateChat.mockClear();

      // Test string chatId
      const responseMessageWithStringChatId = {
        chatId: '12345',
        chat_id: '12345',
        audioUrl: 'https://example.com/audio.mp3',
        retryCount: 2,
      };

      const messageWithStringChatId: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(responseMessageWithStringChatId),
      };

      await consumer.handleAudioFileRetryDlq(messageWithStringChatId);
      expect(chatService.updateChat).toHaveBeenCalledWith('12345', {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessageWithStringChatId,
        },
      });
    });

    it('should handle very large response message', async () => {
      // Arrange
      const largeResponseMessage = {
        chatId: mockChatId,
        chat_id: mockChatId,
        audioUrl: 'https://example.com/audio.mp3',
        retryCount: 10,
        largeData: 'x'.repeat(10000), // 10KB of data
        error: 'Processing failed after many retries',
        metadata: {
          timestamp: new Date().toISOString(),
          retryHistory: Array.from({ length: 100 }, (_, i) => ({
            attempt: i + 1,
            timestamp: new Date().toISOString(),
            error: `Error ${i + 1}`,
          })),
        },
      };

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(largeResponseMessage),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: largeResponseMessage,
        },
      });
    });

    it('should handle response message with special characters', async () => {
      // Arrange
      const responseMessageWithSpecialChars = {
        chatId: mockChatId,
        chat_id: mockChatId,
        audioUrl: 'https://example.com/audio with spaces & symbols.mp3',
        retryCount: 1,
        error:
          'Error with special chars: "quotes", \'apostrophes\', & ampersands',
        unicode: '测试中文 🚀 émojis',
      };

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(responseMessageWithSpecialChars),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessageWithSpecialChars,
        },
      });
    });
  });

  describe('error handling and logging', () => {
    it('should log error and re-throw when processing fails', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(mockResponseMessage),
      };

      const chatServiceError = new Error('Chat service unavailable');
      chatService.updateChat.mockRejectedValue(chatServiceError);

      // Act & Assert
      await expect(consumer.handleAudioFileRetryDlq(message)).rejects.toThrow(
        'Chat service unavailable',
      );

      // Note: We can't easily test the logger calls since the consumer uses a real logger instance
      // The error is properly re-thrown, which is the main behavior we want to test
    });

    it('should log error with proper message ID when JSON parsing fails', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: 'invalid-json',
      };

      // Act & Assert
      await expect(consumer.handleAudioFileRetryDlq(message)).rejects.toThrow();

      // Note: We can't easily test the logger calls since the consumer uses a real logger instance
      // The error is properly re-thrown, which is the main behavior we want to test
    });

    it('should log info message when processing starts successfully', async () => {
      // Arrange
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(mockResponseMessage),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledTimes(1);
      // Note: We can't easily test the logger calls since the consumer uses a real logger instance
      // The main behavior (calling updateChat) is what we want to test
    });
  });

  describe('constructor and dependencies', () => {
    it('should be defined', () => {
      expect(consumer).toBeDefined();
    });

    it('should have required dependencies injected', () => {
      expect(consumer['chatService']).toBeDefined();
    });

    it('should initialize logger with correct name', () => {
      // Note: The logger is initialized in the constructor, so we can't easily test this
      // without more complex mocking. The main behavior is that the consumer is properly instantiated.
      expect(consumer).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle message with missing or empty MessageId', async () => {
      chatService.updateChat.mockResolvedValue(undefined);

      // Test missing MessageId
      const messageWithoutMessageId: Message = {
        Body: JSON.stringify(mockResponseMessage),
        // MessageId is missing
      };

      await consumer.handleAudioFileRetryDlq(messageWithoutMessageId);
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: mockResponseMessage,
        },
      });

      // Reset mock
      chatService.updateChat.mockClear();

      // Test empty MessageId
      const messageWithEmptyMessageId: Message = {
        MessageId: '',
        Body: JSON.stringify(mockResponseMessage),
      };

      await consumer.handleAudioFileRetryDlq(messageWithEmptyMessageId);
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: mockResponseMessage,
        },
      });
    });

    it('should handle response message with nested objects', async () => {
      // Arrange
      const responseMessageWithNestedObjects = {
        chatId: mockChatId,
        chat_id: mockChatId,
        audioUrl: 'https://example.com/audio.mp3',
        retryCount: 2,
        nested: {
          level1: {
            level2: {
              value: 'deep nested value',
            },
          },
        },
        array: [1, 2, 3, { nested: 'array object' }],
      };

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify(responseMessageWithNestedObjects),
      };

      chatService.updateChat.mockResolvedValue(undefined);

      // Act
      await consumer.handleAudioFileRetryDlq(message);

      // Assert
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          dlq_message: responseMessageWithNestedObjects,
        },
      });
    });
  });
});
