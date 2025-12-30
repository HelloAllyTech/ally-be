import { Test, TestingModule } from '@nestjs/testing';
import { AudioRetryProducer } from '../audio-retry.producer';
import { SqsService } from '../../../aws/service/sqs.service';
import { AppConfigService } from '../../../config/config.service';
import { AudioRetryMessage } from '../../type/audio.retry.type';
import { MAX_RETRY_DELAY_SECONDS } from '../../constants/audio-retry-constants';

describe('AudioRetryProducer', () => {
  let producer: AudioRetryProducer;
  let sqsService: jest.Mocked<SqsService>;
  let configService: jest.Mocked<AppConfigService>;

  const mockAudioRetryMessage: AudioRetryMessage = {
    audioUrl: 'https://example.com/audio.mp3',
    chatId: 12345,
    retryCount: 2,
  };

  const mockQueueUrl =
    'https://sqs.us-east-1.amazonaws.com/123456789012/audio-retry-queue';

  beforeEach(async () => {
    const mockSqsService = {
      sendMessage: jest.fn(),
    };

    const mockConfigService = {
      sqs: {
        audioFile: {
          retryQueueUrl: mockQueueUrl,
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioRetryProducer,
        {
          provide: SqsService,
          useValue: mockSqsService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    producer = module.get<AudioRetryProducer>(AudioRetryProducer);
    sqsService = module.get(SqsService);
    configService = module.get(AppConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendAudioFileRetryMessage', () => {
    it('should send message to SQS with correct parameters', async () => {
      // Act
      await producer.sendAudioFileRetryMessage(mockAudioRetryMessage);

      // Assert
      expect(sqsService.sendMessage).toHaveBeenCalledTimes(1);
      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        mockAudioRetryMessage,
        {
          DelaySeconds: 480, // 2^(2+1) * 60 = 8 * 60 = 480 seconds
        },
      );
    });

    it('should calculate delay correctly for various retry counts', async () => {
      // Test retry count 0
      const messageWithRetryCount0 = {
        ...mockAudioRetryMessage,
        retryCount: 0,
      };

      await producer.sendAudioFileRetryMessage(messageWithRetryCount0);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithRetryCount0,
        {
          DelaySeconds: 120, // 2^(0+1) * 60 = 2 * 60 = 120 seconds
        },
      );

      // Reset mock
      sqsService.sendMessage.mockClear();

      // Test retry count 1
      const messageWithRetryCount1 = {
        ...mockAudioRetryMessage,
        retryCount: 1,
      };

      await producer.sendAudioFileRetryMessage(messageWithRetryCount1);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithRetryCount1,
        {
          DelaySeconds: 240, // 2^(1+1) * 60 = 4 * 60 = 240 seconds
        },
      );
    });

    it('should cap delay at MAX_RETRY_DELAY_SECONDS for high retry counts', async () => {
      // Arrange
      const messageWithHighRetryCount = {
        ...mockAudioRetryMessage,
        retryCount: 10,
      };

      // Act
      await producer.sendAudioFileRetryMessage(messageWithHighRetryCount);

      // Assert
      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithHighRetryCount,
        {
          DelaySeconds: MAX_RETRY_DELAY_SECONDS, // 900 seconds (15 minutes)
        },
      );
    });

    it('should handle retry count that would exceed max delay', async () => {
      // Arrange
      const messageWithExcessiveRetryCount = {
        ...mockAudioRetryMessage,
        retryCount: 5,
      };
      // 2^(5+1) * 60 = 64 * 60 = 3840 seconds, which exceeds MAX_RETRY_DELAY_SECONDS (900)

      // Act
      await producer.sendAudioFileRetryMessage(messageWithExcessiveRetryCount);

      // Assert
      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithExcessiveRetryCount,
        {
          DelaySeconds: MAX_RETRY_DELAY_SECONDS, // Should be capped at 900 seconds
        },
      );
    });

    it('should handle various queue URL configuration errors', async () => {
      // Test undefined URL
      configService.sqs.audioFile.retryQueueUrl = undefined;

      await expect(
        producer.sendAudioFileRetryMessage(mockAudioRetryMessage),
      ).rejects.toThrow('Audio file retry queue URL is not configured');

      // Test empty string URL
      configService.sqs.audioFile.retryQueueUrl = '';

      await expect(
        producer.sendAudioFileRetryMessage(mockAudioRetryMessage),
      ).rejects.toThrow('Audio file retry queue URL is not configured');
    });

    it('should propagate SQS service errors', async () => {
      // Arrange
      const sqsError = new Error('SQS service error');
      sqsService.sendMessage.mockRejectedValueOnce(sqsError);

      // Act & Assert
      await expect(
        producer.sendAudioFileRetryMessage(mockAudioRetryMessage),
      ).rejects.toThrow('SQS service error');
    });

    it('should handle different message properties correctly', async () => {
      // Arrange
      const customMessage: AudioRetryMessage = {
        audioUrl: 'https://different-url.com/audio.wav',
        chatId: 99999,
        retryCount: 3,
      };

      // Act
      await producer.sendAudioFileRetryMessage(customMessage);

      // Assert
      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        customMessage,
        {
          DelaySeconds: 900, // 2^(3+1) * 60 = 16 * 60 = 960 seconds, but capped at MAX_RETRY_DELAY_SECONDS
        },
      );
    });
  });

  describe('delay calculation edge cases', () => {
    it('should handle retry count edge cases correctly', async () => {
      // Test retry count that results in delay just under MAX_RETRY_DELAY_SECONDS
      const messageJustUnderMax = {
        ...mockAudioRetryMessage,
        retryCount: 2,
      };

      await producer.sendAudioFileRetryMessage(messageJustUnderMax);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageJustUnderMax,
        {
          DelaySeconds: 480, // Should not be capped
        },
      );

      // Reset mock
      sqsService.sendMessage.mockClear();

      // Test negative retry count
      const messageWithNegativeRetryCount = {
        ...mockAudioRetryMessage,
        retryCount: -1,
      };

      await producer.sendAudioFileRetryMessage(messageWithNegativeRetryCount);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithNegativeRetryCount,
        {
          DelaySeconds: 60, // 2^(-1+1) * 60 = 2^0 * 60 = 1 * 60 = 60 seconds
        },
      );

      // Reset mock
      sqsService.sendMessage.mockClear();

      // Test very large retry count
      const messageWithLargeRetryCount = {
        ...mockAudioRetryMessage,
        retryCount: 100,
      };

      await producer.sendAudioFileRetryMessage(messageWithLargeRetryCount);

      expect(sqsService.sendMessage).toHaveBeenCalledWith(
        mockQueueUrl,
        messageWithLargeRetryCount,
        {
          DelaySeconds: MAX_RETRY_DELAY_SECONDS, // Should be capped at 900 seconds
        },
      );
    });
  });

  describe('constructor and dependencies', () => {
    it('should be defined', () => {
      expect(producer).toBeDefined();
    });

    it('should have required dependencies injected', () => {
      expect(producer['sqsService']).toBeDefined();
      expect(producer['configService']).toBeDefined();
    });
  });
});
