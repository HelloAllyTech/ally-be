import { Test, TestingModule } from '@nestjs/testing';
import { SqsService } from '../sqs.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
  SendMessageCommandOutput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sqs');
jest.mock('../../../logger/logger.service');

describe('SqsService', () => {
  let service: SqsService;
  let mockConfig: jest.Mocked<AppConfigService>;
  let mockSqsClient: {
    send: jest.Mock;
  };
  let mockLogger: jest.Mocked<LoggerService>;

  const originalEnv = process.env;

  beforeEach(async () => {
    // Reset environment variables
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    };

    // Mock SQSClient
    mockSqsClient = {
      send: jest.fn(),
    } as any;

    (SQSClient as jest.MockedClass<typeof SQSClient>).mockImplementation(
      () => mockSqsClient as any,
    );

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getInstance: jest.fn().mockReturnThis(),
    } as any;

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    // Mock configuration
    mockConfig = {
      aws: {
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        sessionToken: 'test-session-token',
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsService,
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<SqsService>(SqsService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should initialize SQS client with credentials', () => {
      expect(SQSClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
          sessionToken: 'test-session-token',
        },
      });
      expect(LoggerService.getInstance).toHaveBeenCalledWith('SqsService');
    });

    it('should initialize SQS client without credentials when not provided', async () => {
      process.env = {
        ...originalEnv,
        AWS_REGION: 'us-west-2',
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined,
      };

      const mockConfigWithoutCredentials = {
        aws: {
          region: 'us-west-2',
          accessKeyId: undefined,
          secretAccessKey: undefined,
          sessionToken: undefined,
        },
      } as any;

      await Test.createTestingModule({
        providers: [
          SqsService,
          {
            provide: AppConfigService,
            useValue: mockConfigWithoutCredentials,
          },
        ],
      }).compile();

      expect(SQSClient).toHaveBeenLastCalledWith({
        region: 'us-west-2',
      });
    });

    it('should warn and not initialize client when AWS_REGION is missing', async () => {
      process.env = {
        ...originalEnv,
        AWS_REGION: undefined,
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      };

      const mockConfigWithoutRegion = {
        aws: {
          region: undefined,
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          sessionToken: undefined,
        },
      } as any;

      await Test.createTestingModule({
        providers: [
          SqsService,
          {
            provide: AppConfigService,
            useValue: mockConfigWithoutRegion,
          },
        ],
      }).compile();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Missing AWS region. Consumer will not start.',
      );
    });

    it('should initialize without credentials when only access key provided', async () => {
      process.env = {
        ...originalEnv,
        AWS_REGION: 'eu-west-1',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: undefined,
      };

      const mockConfigWithPartialCredentials = {
        aws: {
          region: 'eu-west-1',
          accessKeyId: 'test-key',
          secretAccessKey: undefined,
          sessionToken: undefined,
        },
      } as any;

      await Test.createTestingModule({
        providers: [
          SqsService,
          {
            provide: AppConfigService,
            useValue: mockConfigWithPartialCredentials,
          },
        ],
      }).compile();

      expect(SQSClient).toHaveBeenLastCalledWith({
        region: 'eu-west-1',
      });
    });
  });

  describe('sendMessage', () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    it('should send message successfully', async () => {
      const message = { id: 1, content: 'test message' };
      const mockResponse: SendMessageCommandOutput = {
        MessageId: 'test-message-id',
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      await service.sendMessage(queueUrl, message);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(SendMessageCommand),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Message sent to SQS successfully',
      );
    });

    it('should send message with options', async () => {
      const message = { id: 2, content: 'test message with options' };
      const options = {
        DelaySeconds: 10,
        MessageAttributes: {
          priority: {
            StringValue: 'high',
            DataType: 'String',
          },
        },
      };
      const mockResponse: SendMessageCommandOutput = {
        MessageId: 'test-message-id-2',
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      await service.sendMessage(queueUrl, message, options);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(SendMessageCommand),
      );
    });

    it('should throw error when queue URL is empty', async () => {
      const message = { id: 3, content: 'test message' };

      await expect(service.sendMessage('', message)).rejects.toThrow(
        'SQS queue URL not configured',
      );
    });

    it('should throw error when queue URL is null', async () => {
      const message = { id: 4, content: 'test message' };

      await expect(service.sendMessage(null as any, message)).rejects.toThrow(
        'SQS queue URL not configured',
      );
    });

    it('should handle SQS send error', async () => {
      const message = { id: 5, content: 'test message' };
      const error = new Error('SQS send failed');

      mockSqsClient.send.mockRejectedValue(error);

      await expect(service.sendMessage(queueUrl, message)).rejects.toThrow(
        error,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to send message to SQS queue: ${queueUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
    });

    it('should send complex message object', async () => {
      const complexMessage = {
        id: 6,
        content: 'complex message',
        metadata: {
          timestamp: new Date().toISOString(),
          userId: 'user-123',
          nested: {
            data: [1, 2, 3],
            flag: true,
          },
        },
      };
      const mockResponse: SendMessageCommandOutput = {
        MessageId: 'complex-message-id',
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      await service.sendMessage(queueUrl, complexMessage);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(SendMessageCommand),
      );
    });

    it('should handle error without message property', async () => {
      const message = { id: 7, content: 'test message' };
      const errorWithoutMessage = { code: 'UNKNOWN_ERROR' };

      mockSqsClient.send.mockRejectedValue(errorWithoutMessage);

      await expect(service.sendMessage(queueUrl, message)).rejects.toBe(
        errorWithoutMessage,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to send message to SQS queue: ${queueUrl} with error ${JSON.stringify(
          errorWithoutMessage,
        )}`,
      );
    });
  });

  describe('receiveMessage', () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    it('should receive messages successfully', async () => {
      const mockMessages: Message[] = [
        {
          MessageId: 'msg-1',
          ReceiptHandle: 'receipt-1',
          Body: JSON.stringify({ id: 1, content: 'message 1' }),
        },
        {
          MessageId: 'msg-2',
          ReceiptHandle: 'receipt-2',
          Body: JSON.stringify({ id: 2, content: 'message 2' }),
        },
      ];

      const mockResponse: ReceiveMessageCommandOutput = {
        Messages: mockMessages,
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      const result = await service.receiveMessage(queueUrl);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(ReceiveMessageCommand),
      );
      expect(result).toEqual(mockMessages);
    });

    it('should return empty array when no messages', async () => {
      const mockResponse: ReceiveMessageCommandOutput = {
        Messages: undefined,
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      const result = await service.receiveMessage(queueUrl);

      expect(result).toEqual([]);
    });

    it('should return empty array when Messages is empty', async () => {
      const mockResponse: ReceiveMessageCommandOutput = {
        Messages: [],
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      const result = await service.receiveMessage(queueUrl);

      expect(result).toEqual([]);
    });

    it('should throw error when queue URL is empty', async () => {
      await expect(service.receiveMessage('')).rejects.toThrow(
        'SQS queue URL not configured',
      );
    });

    it('should throw error when queue URL is null', async () => {
      await expect(service.receiveMessage(null as any)).rejects.toThrow(
        'SQS queue URL not configured',
      );
    });

    it('should handle SQS receive error', async () => {
      const error = new Error('SQS receive failed');

      mockSqsClient.send.mockRejectedValue(error);

      await expect(service.receiveMessage(queueUrl)).rejects.toThrow(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to receive response message from SQS queue: ${queueUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
    });

    it('should use correct receive message parameters', async () => {
      const mockResponse: ReceiveMessageCommandOutput = {
        Messages: [],
        $metadata: {},
      };

      mockSqsClient.send.mockResolvedValue(mockResponse);

      await service.receiveMessage(queueUrl);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(ReceiveMessageCommand),
      );
    });
  });

  describe('deleteMessage', () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    it('should delete message successfully', async () => {
      const message: Message = {
        MessageId: 'msg-to-delete',
        ReceiptHandle: 'receipt-handle-123',
        Body: JSON.stringify({ id: 1, content: 'message to delete' }),
      };

      mockSqsClient.send.mockResolvedValue({});

      await service.deleteMessage(queueUrl, message);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(DeleteMessageCommand),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Deleted message msg-to-delete',
      );
    });

    it('should not delete when sqsClient is not initialized', async () => {
      // Create service without initializing sqsClient
      process.env = {
        ...originalEnv,
        AWS_REGION: undefined,
      };

      const mockConfigWithoutRegion = {
        aws: {
          region: undefined,
          accessKeyId: undefined,
          secretAccessKey: undefined,
          sessionToken: undefined,
        },
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SqsService,
          {
            provide: AppConfigService,
            useValue: mockConfigWithoutRegion,
          },
        ],
      }).compile();

      const serviceWithoutClient = module.get<SqsService>(SqsService);

      const message: Message = {
        MessageId: 'msg-to-delete',
        ReceiptHandle: 'receipt-handle-123',
        Body: JSON.stringify({ id: 1, content: 'message to delete' }),
      };

      await serviceWithoutClient.deleteMessage(queueUrl, message);

      expect(mockSqsClient.send).not.toHaveBeenCalled();
    });

    it('should not delete when queue URL is empty', async () => {
      const message: Message = {
        MessageId: 'msg-to-delete',
        ReceiptHandle: 'receipt-handle-123',
        Body: JSON.stringify({ id: 1, content: 'message to delete' }),
      };

      await service.deleteMessage('', message);

      expect(mockSqsClient.send).not.toHaveBeenCalled();
    });

    it('should not delete when message has no ReceiptHandle', async () => {
      const message: Message = {
        MessageId: 'msg-without-receipt',
        Body: JSON.stringify({ id: 1, content: 'message without receipt' }),
      };

      await service.deleteMessage(queueUrl, message);

      expect(mockSqsClient.send).not.toHaveBeenCalled();
    });

    it('should handle delete error gracefully', async () => {
      const message: Message = {
        MessageId: 'msg-delete-error',
        ReceiptHandle: 'receipt-handle-error',
        Body: JSON.stringify({ id: 1, content: 'message with delete error' }),
      };

      const error = new Error('Delete failed');
      mockSqsClient.send.mockRejectedValue(error);

      // Should not throw error, just log it
      await service.deleteMessage(queueUrl, message);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to delete message msg-delete-error with error ${JSON.stringify(
          error,
        )}`,
      );
    });

    it('should handle delete error without message property', async () => {
      const message: Message = {
        MessageId: 'msg-delete-error-no-msg',
        ReceiptHandle: 'receipt-handle-error-no-msg',
        Body: JSON.stringify({ id: 1, content: 'message with delete error' }),
      };

      const errorWithoutMessage = { code: 'DELETE_ERROR' };
      mockSqsClient.send.mockRejectedValue(errorWithoutMessage);

      await service.deleteMessage(queueUrl, message);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to delete message msg-delete-error-no-msg with error ${JSON.stringify(
          errorWithoutMessage,
        )}`,
      );
    });

    it('should use correct delete message parameters', async () => {
      const message: Message = {
        MessageId: 'msg-params-test',
        ReceiptHandle: 'receipt-handle-params',
        Body: JSON.stringify({ id: 1, content: 'params test message' }),
      };

      mockSqsClient.send.mockResolvedValue({});

      await service.deleteMessage(queueUrl, message);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(DeleteMessageCommand),
      );
    });
  });

  describe('edge cases and integration scenarios', () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    it('should handle complete message lifecycle', async () => {
      // Send message
      const message = { id: 100, content: 'lifecycle test message' };
      const sendResponse: SendMessageCommandOutput = {
        MessageId: 'lifecycle-msg-id',
        $metadata: {},
      };

      // Receive message
      const receivedMessage: Message = {
        MessageId: 'lifecycle-msg-id',
        ReceiptHandle: 'lifecycle-receipt',
        Body: JSON.stringify(message),
      };
      const receiveResponse: ReceiveMessageCommandOutput = {
        Messages: [receivedMessage],
        $metadata: {},
      };

      mockSqsClient.send
        .mockResolvedValueOnce(sendResponse) // send
        .mockResolvedValueOnce(receiveResponse) // receive
        .mockResolvedValueOnce({}); // delete

      // Execute lifecycle
      await service.sendMessage(queueUrl, message);
      const messages = await service.receiveMessage(queueUrl);
      await service.deleteMessage(queueUrl, messages[0]);

      expect(mockSqsClient.send).toHaveBeenCalledTimes(3);
      expect(messages).toHaveLength(1);
      expect(messages[0].MessageId).toBe('lifecycle-msg-id');
    });

    it('should handle message with all optional properties', async () => {
      const message: Message = {
        MessageId: 'full-message-id',
        ReceiptHandle: 'full-receipt-handle',
        Body: JSON.stringify({ id: 200, content: 'full message' }),
        MD5OfBody: 'md5-hash',
        Attributes: {
          SentTimestamp: '1234567890',
          ApproximateReceiveCount: '1',
        },
        MessageAttributes: {
          priority: {
            StringValue: 'high',
            DataType: 'String',
          },
        },
      };

      mockSqsClient.send.mockResolvedValue({});

      await service.deleteMessage(queueUrl, message);

      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.any(DeleteMessageCommand),
      );
    });

    it('should handle concurrent operations', async () => {
      const messages = [
        { id: 301, content: 'concurrent message 1' },
        { id: 302, content: 'concurrent message 2' },
        { id: 303, content: 'concurrent message 3' },
      ];

      mockSqsClient.send.mockResolvedValue({
        MessageId: 'concurrent-msg-id',
        $metadata: {},
      });

      const promises = messages.map((msg) =>
        service.sendMessage(queueUrl, msg),
      );
      await Promise.all(promises);

      expect(mockSqsClient.send).toHaveBeenCalledTimes(3);
      expect(mockLogger.debug).toHaveBeenCalledTimes(3);
    });
  });
});
