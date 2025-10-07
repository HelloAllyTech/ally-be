import { Test, TestingModule } from '@nestjs/testing';
import { AiEventService } from '../ai-event.service';
import { SqsService } from '../../../aws/service/sqs.service';
import { ChatService } from '../../../chat/service/chat.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { ChatSummaryStatus } from '../../../common/entities/chat.entity';
import { TranscribeAndSummarizeRequestMessage } from '../../dto/transcribe-and-summarize-request.model';

describe('AiEventService', () => {
  let service: AiEventService;
  let sqsService: jest.Mocked<SqsService>;
  let chatService: jest.Mocked<ChatService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockConfigService = {
    sqs: {
      transcription: {
        requestQueueUrl:
          'https://sqs.us-east-1.amazonaws.com/123456789/transcription-request-queue',
      },
    },
  };

  beforeEach(async () => {
    const mockSqsService = {
      sendMessage: jest.fn(),
    };

    const mockChatService = {
      updateChat: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEventService,
        {
          provide: SqsService,
          useValue: mockSqsService,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiEventService>(AiEventService);
    sqsService = module.get(SqsService);
    chatService = module.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize logger with correct name', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith('AiEventService');
    });
  });

  describe('publishTranscribeAudioEvent', () => {
    const mockEvent: TranscribeAndSummarizeRequestMessage = {
      message_type: 'transcribe_request',
      timestamp: Date.now(),
      chat_id: 123,
      audio_url: 'https://example.com/audio.wav',
      sample_rate: 44100,
    };

    it('should successfully publish transcribe audio event', async () => {
      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await service.publishTranscribeAudioEvent(mockEvent);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/transcription-request-queue',
        mockEvent,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(123, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Transcribe and summarize request published for chat 123',
      );
    });

    it('should handle empty queue URL gracefully', async () => {
      const serviceWithEmptyUrl = new AiEventService(sqsService, chatService, {
        sqs: {
          transcription: {
            requestQueueUrl: '',
          },
        },
      } as any);

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await serviceWithEmptyUrl.publishTranscribeAudioEvent(mockEvent);

      expect(sqsService.sendMessage).toHaveBeenCalledWith('', mockEvent);
    });

    it('should handle missing queue URL gracefully', async () => {
      const serviceWithoutUrl = new AiEventService(sqsService, chatService, {
        sqs: {
          transcription: {},
        },
      } as any);

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await serviceWithoutUrl.publishTranscribeAudioEvent(mockEvent);

      expect(sqsService.sendMessage).toHaveBeenCalledWith('', mockEvent);
    });

    it('should handle SQS service error and throw', async () => {
      const error = new Error('SQS send failed');
      sqsService.sendMessage.mockRejectedValue(error);

      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toThrow('SQS send failed');

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/transcription-request-queue',
        mockEvent,
      );
      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to publish transcribe and summarize request for chat 123 with error',
        ),
      );
    });

    it('should handle chat service error and throw', async () => {
      const error = new Error('Chat update failed');
      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockRejectedValue(error);

      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toThrow('Chat update failed');

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/transcription-request-queue',
        mockEvent,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(123, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to publish transcribe and summarize request for chat 123 with error',
        ),
      );
    });

    it('should handle different chat IDs', async () => {
      const eventWithDifferentId = { ...mockEvent, chat_id: 456 };
      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await service.publishTranscribeAudioEvent(eventWithDifferentId);

      expect(chatService.updateChat).toHaveBeenCalledWith(456, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Transcribe and summarize request published for chat 456',
      );
    });

    it('should handle event with different properties', async () => {
      const eventWithDifferentProps: TranscribeAndSummarizeRequestMessage = {
        message_type: 'transcribe_request',
        timestamp: Date.now(),
        chat_id: 789,
        audio_url: 'https://different.com/audio.mp3',
        sample_rate: 48000,
      };

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await service.publishTranscribeAudioEvent(eventWithDifferentProps);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/transcription-request-queue',
        eventWithDifferentProps,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(789, {
        summaryStatus: ChatSummaryStatus.IN_PROGRESS,
      });
    });

    it('should handle complex error objects', async () => {
      const complexError = {
        name: 'ComplexError',
        message: 'Complex error occurred',
        code: 'ERR_COMPLEX',
        details: { nested: 'value' },
      };
      sqsService.sendMessage.mockRejectedValue(complexError);

      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toEqual(complexError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to publish transcribe and summarize request for chat 123 with error',
        ),
      );
    });

    it('should handle null/undefined errors', async () => {
      sqsService.sendMessage.mockRejectedValue(null);

      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toBeNull();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to publish transcribe and summarize request for chat 123 with error',
        ),
      );
    });
  });

  describe('Error Handling Edge Cases', () => {
    const mockEvent: TranscribeAndSummarizeRequestMessage = {
      message_type: 'transcribe_request',
      timestamp: Date.now(),
      chat_id: 123,
      audio_url: 'https://example.com/audio.wav',
      sample_rate: 44100,
    };

    it('should handle logger errors gracefully', async () => {
      // Mock logger to throw error - but the service doesn't catch logger errors
      mockLogger.info.mockImplementation(() => {
        throw new Error('Logger failed');
      });

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      // Logger error will cause the method to throw
      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toThrow('Logger failed');
    });

    it('should handle circular reference in error objects', async () => {
      const circularError: any = { name: 'CircularError' };
      circularError.self = circularError;
      sqsService.sendMessage.mockRejectedValue(circularError);

      // The service will try to JSON.stringify the error in the logger call, which will throw a TypeError
      // This TypeError will be thrown instead of the original circular error
      await expect(
        service.publishTranscribeAudioEvent(mockEvent),
      ).rejects.toThrow('Converting circular structure to JSON');

      // The error logger will not be called because JSON.stringify throws first
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Scenarios', () => {
    it('should work with minimal configuration', async () => {
      const minimalConfigService = {
        sqs: {
          transcription: {
            requestQueueUrl: undefined,
          },
        },
      };

      const serviceWithMinimalConfig = new AiEventService(
        sqsService,
        chatService,
        minimalConfigService as any,
      );

      const mockEvent: TranscribeAndSummarizeRequestMessage = {
        message_type: 'transcribe_request',
        timestamp: Date.now(),
        chat_id: 123,
        audio_url: 'https://example.com/audio.wav',
        sample_rate: 44100,
      };

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await serviceWithMinimalConfig.publishTranscribeAudioEvent(mockEvent);

      expect(sqsService.sendMessage).toHaveBeenCalledWith('', mockEvent);
    });

    it('should work with null configuration', async () => {
      const nullConfigService = {
        sqs: {
          transcription: {
            requestQueueUrl: null,
          },
        },
      };

      const serviceWithNullConfig = new AiEventService(
        sqsService,
        chatService,
        nullConfigService as any,
      );

      const mockEvent: TranscribeAndSummarizeRequestMessage = {
        message_type: 'transcribe_request',
        timestamp: Date.now(),
        chat_id: 123,
        audio_url: 'https://example.com/audio.wav',
        sample_rate: 44100,
      };

      sqsService.sendMessage.mockResolvedValue(undefined);
      chatService.updateChat.mockResolvedValue({} as any);

      await serviceWithNullConfig.publishTranscribeAudioEvent(mockEvent);

      expect(sqsService.sendMessage).toHaveBeenCalledWith('', mockEvent);
    });
  });
});
