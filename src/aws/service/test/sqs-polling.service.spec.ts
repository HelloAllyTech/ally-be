import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { SqsPollingService } from '../sqs-polling.service';
import { SqsService } from '../sqs.service';
import { LoggerService } from '../../../logger/logger.service';
import { Message } from '@aws-sdk/client-sqs';
import {
  sqsHandlerRegistry,
  SqsHandler,
} from '../../registry/sqs-handler.registry';

// Mock dependencies
jest.mock('../sqs.service');
jest.mock('../../../logger/logger.service');
jest.mock('../../registry/sqs-handler.registry');

describe('SqsPollingService', () => {
  let service: SqsPollingService;
  let mockSqsService: jest.Mocked<SqsService>;
  let mockModuleRef: jest.Mocked<ModuleRef>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockSqsHandlerRegistry: jest.Mocked<typeof sqsHandlerRegistry>;

  const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';
  const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

  beforeEach(async () => {
    // Mock SqsService
    mockSqsService = {
      receiveMessage: jest.fn(),
      deleteMessage: jest.fn(),
    } as any;

    // Mock ModuleRef
    mockModuleRef = {
      get: jest.fn(),
    } as any;

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getInstance: jest.fn().mockReturnThis(),
    } as any;

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    // Mock registry
    mockSqsHandlerRegistry = {
      getHandlers: jest.fn(),
    } as any;

    (sqsHandlerRegistry as any) = mockSqsHandlerRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsPollingService,
        {
          provide: SqsService,
          useValue: mockSqsService,
        },
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
        },
      ],
    }).compile();

    service = module.get<SqsPollingService>(SqsPollingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith(
        'SqsPollingService',
      );
    });
  });

  describe('onModuleInit', () => {
    it('should initialize and start pollers when handlers exist', async () => {
      const mockHandler1 = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService1' } },
        methodName: 'handleMessage1',
        targetConstructor: class TestService1 {},
      };

      const mockHandler2 = {
        queueUrl: queueUrl2,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService2' } },
        methodName: 'handleMessage2',
        targetConstructor: class TestService2 {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([
        mockHandler1,
        mockHandler2,
      ]);

      const mockInstance1 = { handleMessage1: jest.fn() };
      const mockInstance2 = { handleMessage2: jest.fn() };

      mockModuleRef.get
        .mockReturnValueOnce(mockInstance1)
        .mockReturnValueOnce(mockInstance2);

      await service.onModuleInit();

      expect(mockSqsHandlerRegistry.getHandlers).toHaveBeenCalled();
      expect(mockModuleRef.get).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Initialized poller for queue: ${queueUrl1} with 1 handler(s)`,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Initialized poller for queue: ${queueUrl2} with 1 handler(s)`,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Started polling for 2 queue(s)',
      );
    });

    it('should warn when no handlers are registered', async () => {
      mockSqsHandlerRegistry.getHandlers.mockReturnValue([]);

      await service.onModuleInit();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No SQS handlers registered',
      );
    });

    it('should handle handler resolution error', async () => {
      const mockHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService' } },
        methodName: 'handleMessage',
        targetConstructor: class TestService {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockHandler]);
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('Handler resolution failed');
      });

      await service.onModuleInit();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to resolve handler instance for TestService.handleMessage',
        ),
      );
    });

    it('should group multiple handlers for the same queue', async () => {
      const mockHandler1 = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService1' } },
        methodName: 'handleMessage1',
        targetConstructor: class TestService1 {},
      };

      const mockHandler2 = {
        queueUrl: queueUrl1, // Same queue URL
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService2' } },
        methodName: 'handleMessage2',
        targetConstructor: class TestService2 {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([
        mockHandler1,
        mockHandler2,
      ]);

      const mockInstance1 = { handleMessage1: jest.fn() };
      const mockInstance2 = { handleMessage2: jest.fn() };

      mockModuleRef.get
        .mockReturnValueOnce(mockInstance1)
        .mockReturnValueOnce(mockInstance2);

      await service.onModuleInit();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Initialized poller for queue: ${queueUrl1} with 2 handler(s)`,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Started polling for 1 queue(s)',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop all pollers', async () => {
      const mockHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService' } },
        methodName: 'handleMessage',
        targetConstructor: class TestService {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockHandler]);
      mockModuleRef.get.mockReturnValue({ handleMessage: jest.fn() });

      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Stopped all queue pollers',
      );
    });
  });

  describe('message processing', () => {
    let mockInstance: any;
    let mockHandler: SqsHandler;

    beforeEach(async () => {
      mockInstance = { handleMessage: jest.fn() };
      mockHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService' } },
        methodName: 'handleMessage',
        targetConstructor: class TestService {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockHandler]);
      mockModuleRef.get.mockReturnValue(mockInstance);

      await service.onModuleInit();
    });

    it('should process messages through pollMessages method', async () => {
      const mockMessages: Message[] = [
        {
          MessageId: 'msg-1',
          ReceiptHandle: 'receipt-1',
          Body: JSON.stringify({ id: 1, content: 'test message 1' }),
        },
        {
          MessageId: 'msg-2',
          ReceiptHandle: 'receipt-2',
          Body: JSON.stringify({ id: 2, content: 'test message 2' }),
        },
      ];

      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockInstance.handleMessage.mockResolvedValue(undefined);
      mockSqsService.deleteMessage.mockResolvedValue(undefined);

      // Access private method for testing
      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockSqsService.receiveMessage).toHaveBeenCalledWith(queueUrl1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Received 2 message(s) from queue: ${queueUrl1}`,
      );
      expect(mockInstance.handleMessage).toHaveBeenCalledTimes(2);
      expect(mockSqsService.deleteMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle messages without body', async () => {
      const mockMessages: Message[] = [
        {
          MessageId: 'msg-no-body',
          ReceiptHandle: 'receipt-no-body',
        },
      ];

      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Received message without body',
        { messageId: 'msg-no-body' },
      );
      expect(mockInstance.handleMessage).not.toHaveBeenCalled();
      expect(mockSqsService.deleteMessage).not.toHaveBeenCalled();
    });

    it('should handle handler processing error', async () => {
      const mockMessages: Message[] = [
        {
          MessageId: 'msg-error',
          ReceiptHandle: 'receipt-error',
          Body: JSON.stringify({ id: 1, content: 'error message' }),
        },
      ];

      const handlerError = new Error('Handler processing failed');
      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockInstance.handleMessage.mockRejectedValue(handlerError);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Handler TestService.handleMessage failed to process message msg-error',
        ),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No handler successfully processed message msg-error. Message will remain in queue.',
      );
      expect(mockSqsService.deleteMessage).not.toHaveBeenCalled();
    });

    it('should delete message when at least one handler succeeds', async () => {
      const mockHandler2 = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService2' } },
        methodName: 'handleMessage2',
        targetConstructor: class TestService2 {},
      };

      const mockInstance2 = { handleMessage2: jest.fn() };

      const mockMessages: Message[] = [
        {
          MessageId: 'msg-partial-success',
          ReceiptHandle: 'receipt-partial-success',
          Body: JSON.stringify({ id: 1, content: 'partial success message' }),
        },
      ];

      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockInstance.handleMessage.mockRejectedValue(
        new Error('First handler failed'),
      );
      mockInstance2.handleMessage2.mockResolvedValue(undefined);
      mockSqsService.deleteMessage.mockResolvedValue(undefined);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
          {
            ...mockHandler2,
            handler: async (message: Message) => {
              await mockInstance2.handleMessage2(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockSqsService.deleteMessage).toHaveBeenCalledWith(
        queueUrl1,
        mockMessages[0],
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Deleted message msg-partial-success from queue ' + queueUrl1,
      );
    });

    it('should handle delete message error', async () => {
      const mockMessages: Message[] = [
        {
          MessageId: 'msg-delete-error',
          ReceiptHandle: 'receipt-delete-error',
          Body: JSON.stringify({ id: 1, content: 'delete error message' }),
        },
      ];

      const deleteError = new Error('Delete failed');
      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockInstance.handleMessage.mockResolvedValue(undefined);
      mockSqsService.deleteMessage.mockRejectedValue(deleteError);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to delete message msg-delete-error from queue',
        ),
      );
    });

    it('should handle receive message error', async () => {
      const receiveError = new Error('Receive failed');
      mockSqsService.receiveMessage.mockRejectedValue(receiveError);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error receiving messages from queue'),
      );
    });

    it('should handle empty messages array', async () => {
      mockSqsService.receiveMessage.mockResolvedValue([]);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockSqsService.receiveMessage).toHaveBeenCalledWith(queueUrl1);
      expect(mockInstance.handleMessage).not.toHaveBeenCalled();
      expect(mockSqsService.deleteMessage).not.toHaveBeenCalled();
    });
  });

  describe('sleep function', () => {
    it('should wait for specified time', async () => {
      jest.useFakeTimers();

      const sleepPromise = (service as any).sleep(1000);

      jest.advanceTimersByTime(999);
      expect(sleepPromise).not.toHaveProperty('resolved');

      jest.advanceTimersByTime(1);
      await sleepPromise;

      jest.useRealTimers();
    });
  });

  describe('DLQ handlers', () => {
    it('should handle DLQ messages', async () => {
      const mockDlqHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: true,
        target: { constructor: { name: 'DlqService' } },
        methodName: 'handleDlqMessage',
        targetConstructor: class DlqService {},
      };

      const mockDlqInstance = { handleDlqMessage: jest.fn() };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockDlqHandler]);
      mockModuleRef.get.mockReturnValue(mockDlqInstance);

      const mockMessages: Message[] = [
        {
          MessageId: 'dlq-msg-1',
          ReceiptHandle: 'dlq-receipt-1',
          Body: JSON.stringify({ id: 1, content: 'DLQ message' }),
        },
      ];

      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockDlqInstance.handleDlqMessage.mockResolvedValue(undefined);
      mockSqsService.deleteMessage.mockResolvedValue(undefined);

      await service.onModuleInit();

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockDlqHandler,
            handler: async (message: Message) => {
              await mockDlqInstance.handleDlqMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      expect(mockDlqInstance.handleDlqMessage).toHaveBeenCalledWith(
        mockMessages[0],
      );
      expect(mockSqsService.deleteMessage).toHaveBeenCalledWith(
        queueUrl1,
        mockMessages[0],
      );
    });
  });

  describe('concurrent message processing', () => {
    it('should process multiple messages', async () => {
      const mockInstance = { handleMessage: jest.fn() };
      const mockHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService' } },
        methodName: 'handleMessage',
        targetConstructor: class TestService {},
      };

      // Reset mocks for this test
      mockSqsService.receiveMessage.mockReset();
      mockSqsService.deleteMessage.mockReset();
      mockInstance.handleMessage.mockReset();

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockHandler]);
      mockModuleRef.get.mockReturnValue(mockInstance);

      const mockMessages: Message[] = [
        {
          MessageId: 'concurrent-msg-1',
          ReceiptHandle: 'concurrent-receipt-1',
          Body: JSON.stringify({ id: 1, content: 'concurrent message 1' }),
        },
        {
          MessageId: 'concurrent-msg-2',
          ReceiptHandle: 'concurrent-receipt-2',
          Body: JSON.stringify({ id: 2, content: 'concurrent message 2' }),
        },
        {
          MessageId: 'concurrent-msg-3',
          ReceiptHandle: 'concurrent-receipt-3',
          Body: JSON.stringify({ id: 3, content: 'concurrent message 3' }),
        },
      ];

      mockSqsService.receiveMessage.mockResolvedValue(mockMessages);
      mockInstance.handleMessage.mockResolvedValue(undefined);
      mockSqsService.deleteMessage.mockResolvedValue(undefined);

      const privateService = service as any;
      const queuePoller = {
        queueUrl: queueUrl1,
        handlers: [
          {
            ...mockHandler,
            handler: async (message: Message) => {
              await mockInstance.handleMessage(message);
            },
          },
        ],
        isPolling: true,
        pollInterval: 5000,
      };

      await privateService.pollMessages(queuePoller);

      // All messages should be processed
      expect(mockInstance.handleMessage).toHaveBeenCalledTimes(3);
      expect(mockSqsService.deleteMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe('startPoller behavior', () => {
    it('should not start poller if already polling', async () => {
      const mockHandler = {
        queueUrl: queueUrl1,
        handler: jest.fn(),
        isDlq: false,
        target: { constructor: { name: 'TestService' } },
        methodName: 'handleMessage',
        targetConstructor: class TestService {},
      };

      mockSqsHandlerRegistry.getHandlers.mockReturnValue([mockHandler]);
      mockModuleRef.get.mockReturnValue({ handleMessage: jest.fn() });

      await service.onModuleInit();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Starting polling for queue: ${queueUrl1}`,
      );

      // Try to start again - should not log the starting message again
      mockLogger.debug.mockClear();

      // Manually call startPoller to test the guard
      const privateService = service as any;
      await privateService.startPoller({
        queueUrl: queueUrl1,
        handlers: [],
        isPolling: true,
        pollInterval: 5000,
      });

      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        `Starting polling for queue: ${queueUrl1}`,
      );
    });
  });
});
