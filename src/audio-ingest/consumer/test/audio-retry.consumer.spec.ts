import { Test, TestingModule } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { AudioRetryConsumer } from '../audio-retry.consumer';
import { AudioRetryProducer } from '../../producer/audio-retry.producer';
import { AiEventService } from '../../../ai/service/ai-event.service';
import { ChatService } from '../../../chat/service/chat.service';
import { ChatSummaryStatus } from '../../../common/entities/chat.entity';
import { LoggerService } from '../../../logger/logger.service';
import { checkAudioFileReady } from '../../../common/util/audio.util';
import { MAX_RETRY_COUNT } from '../../constants/audio-retry-constants';

// Mock the audio util function
jest.mock('../../../common/util/audio.util', () => ({
  checkAudioFileReady: jest.fn(),
}));

describe('AudioRetryConsumer', () => {
  let consumer: AudioRetryConsumer;
  let audioRetryProducer: jest.Mocked<AudioRetryProducer>;
  let aiEventService: jest.Mocked<AiEventService>;
  let chatService: jest.Mocked<ChatService>;
  let mockCheckAudioFileReady: jest.MockedFunction<typeof checkAudioFileReady>;

  const mockChatId = 12345;
  const mockAudioUrl = 'https://example.com/audio.mp3';
  const mockMessageId = 'test-message-id-123';

  beforeEach(async () => {
    const mockAudioRetryProducer = {
      sendAudioFileRetryMessage: jest.fn(),
    };

    const mockAiEventService = {
      publishTranscribeAudioEvent: jest.fn(),
    };

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
        AudioRetryConsumer,
        {
          provide: AudioRetryProducer,
          useValue: mockAudioRetryProducer,
        },
        {
          provide: AiEventService,
          useValue: mockAiEventService,
        },
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

    consumer = module.get<AudioRetryConsumer>(AudioRetryConsumer);
    audioRetryProducer = module.get(AudioRetryProducer);
    aiEventService = module.get(AiEventService);
    chatService = module.get(ChatService);
    mockCheckAudioFileReady = checkAudioFileReady as jest.MockedFunction<
      typeof checkAudioFileReady
    >;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleAudioFileRetry', () => {
    it('should return early if message body is empty', async () => {
      const message: Message = {
        MessageId: mockMessageId,
        Body: undefined,
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
    });

    it('should return early if chatId is missing', async () => {
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          audioUrl: mockAudioUrl,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
    });

    it('should return early if audioUrl is missing', async () => {
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
    });

    it('should process audio file when ready and publish transcribe event', async () => {
      mockCheckAudioFileReady.mockResolvedValue(true);

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalledWith({
        message_type: 'transcribe_and_summarize_request',
        timestamp: expect.any(Number),
        audio_url: mockAudioUrl,
        chat_id: mockChatId,
      });
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should retry when audio file is not ready and retry count is below max', async () => {
      mockCheckAudioFileReady.mockResolvedValue(false);

      const retryCount = 2;
      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(audioRetryProducer.sendAudioFileRetryMessage).toHaveBeenCalledWith(
        {
          audioUrl: mockAudioUrl,
          chatId: mockChatId,
          retryCount: retryCount + 1,
        },
      );
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should update chat status to failed when max retry count is reached', async () => {
      mockCheckAudioFileReady.mockResolvedValue(false);

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: MAX_RETRY_COUNT,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          error: 'Audio file is not ready',
        },
      });
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON in message body', async () => {
      const message: Message = {
        MessageId: mockMessageId,
        Body: 'invalid json',
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error during audio file check', async () => {
      mockCheckAudioFileReady.mockRejectedValue(new Error('Network error'));

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error during AI event publishing', async () => {
      mockCheckAudioFileReady.mockResolvedValue(true);
      aiEventService.publishTranscribeAudioEvent.mockImplementation(() => {
        throw new Error('AI service error');
      });

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error during retry message sending', async () => {
      mockCheckAudioFileReady.mockResolvedValue(false);
      audioRetryProducer.sendAudioFileRetryMessage.mockImplementation(() => {
        throw new Error('Producer error');
      });

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: 0,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(audioRetryProducer.sendAudioFileRetryMessage).toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error during chat update', async () => {
      mockCheckAudioFileReady.mockResolvedValue(false);
      chatService.updateChat.mockRejectedValue(new Error('Database error'));

      const message: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: MAX_RETRY_COUNT,
        }),
      };

      await consumer.handleAudioFileRetry(message);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(chatService.updateChat).toHaveBeenCalled();
      expect(
        audioRetryProducer.sendAudioFileRetryMessage,
      ).not.toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });

    it('should handle various retry count scenarios', async () => {
      mockCheckAudioFileReady.mockResolvedValue(false);

      // Test missing retryCount (defaults to undefined)
      const messageWithoutRetryCount: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
        }),
      };

      await consumer.handleAudioFileRetry(messageWithoutRetryCount);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(chatService.updateChat).toHaveBeenCalledWith(mockChatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          error: 'Audio file is not ready',
        },
      });

      // Reset mocks
      jest.clearAllMocks();
      mockCheckAudioFileReady.mockResolvedValue(false);

      // Test null retryCount
      const messageWithNullRetryCount: Message = {
        MessageId: mockMessageId,
        Body: JSON.stringify({
          chatId: mockChatId,
          audioUrl: mockAudioUrl,
          retryCount: null,
        }),
      };

      await consumer.handleAudioFileRetry(messageWithNullRetryCount);

      expect(mockCheckAudioFileReady).toHaveBeenCalledWith(mockAudioUrl);
      expect(audioRetryProducer.sendAudioFileRetryMessage).toHaveBeenCalledWith(
        {
          audioUrl: mockAudioUrl,
          chatId: mockChatId,
          retryCount: 1, // null + 1 = 1
        },
      );
      expect(aiEventService.publishTranscribeAudioEvent).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });
  });
});
