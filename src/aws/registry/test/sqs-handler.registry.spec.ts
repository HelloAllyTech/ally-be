import { sqsHandlerRegistry } from '../sqs-handler.registry';
import { Message } from '@aws-sdk/client-sqs';

describe('SqsHandlerRegistry', () => {
  let registry: typeof sqsHandlerRegistry;

  const importedRegistry = sqsHandlerRegistry;

  beforeEach(() => {
    // Reset the registry before each test
    registry = sqsHandlerRegistry;
    (registry as any).handlers = [];
  });

  afterEach(() => {
    // Clean up after each test
    (registry as any).handlers = [];
  });

  describe('registerHandler', () => {
    it('should register a handler successfully', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };
      const methodName = 'handleMessage';

      registry.registerHandler(queueUrl, mockTarget, methodName, false);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        queueUrl,
        isDlq: false,
        target: mockTarget,
        methodName,
        targetConstructor: mockTarget.constructor,
      });
      expect(typeof handlers[0].handler).toBe('function');
    });

    it('should register a DLQ handler successfully', () => {
      const dlqUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue-dlq';
      const mockTarget = {
        handleDlqMessage: jest.fn(),
        constructor: class TestDlqService {},
      };
      const methodName = 'handleDlqMessage';

      registry.registerHandler(dlqUrl, mockTarget, methodName, true);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        queueUrl: dlqUrl,
        isDlq: true,
        target: mockTarget,
        methodName,
        targetConstructor: mockTarget.constructor,
      });
    });

    it('should register multiple handlers', () => {
      const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';
      const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

      const mockTarget1 = {
        handleMessage1: jest.fn(),
        constructor: class TestService1 {},
      };

      const mockTarget2 = {
        handleMessage2: jest.fn(),
        constructor: class TestService2 {},
      };

      registry.registerHandler(queueUrl1, mockTarget1, 'handleMessage1', false);
      registry.registerHandler(queueUrl2, mockTarget2, 'handleMessage2', true);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(2);

      expect(handlers[0]).toMatchObject({
        queueUrl: queueUrl1,
        isDlq: false,
        target: mockTarget1,
        methodName: 'handleMessage1',
      });

      expect(handlers[1]).toMatchObject({
        queueUrl: queueUrl2,
        isDlq: true,
        target: mockTarget2,
        methodName: 'handleMessage2',
      });
    });

    it('should register handlers for the same queue URL', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/shared-queue';

      const mockTarget1 = {
        handleMessage1: jest.fn(),
        constructor: class TestService1 {},
      };

      const mockTarget2 = {
        handleMessage2: jest.fn(),
        constructor: class TestService2 {},
      };

      registry.registerHandler(queueUrl, mockTarget1, 'handleMessage1', false);
      registry.registerHandler(queueUrl, mockTarget2, 'handleMessage2', false);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(2);

      handlers.forEach((handler) => {
        expect(handler.queueUrl).toBe(queueUrl);
        expect(handler.isDlq).toBe(false);
      });
    });

    it('should default isDlq to false when not provided', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/default-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage');

      const handlers = registry.getHandlers();
      expect(handlers[0].isDlq).toBe(false);
    });

    it('should create a working handler function', async () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/function-test-queue';
      const mockTarget = {
        handleMessage: jest.fn().mockResolvedValue('handled'),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = registry.getHandlers();
      const handlerFunction = handlers[0].handler;

      const mockMessage: Message = {
        MessageId: 'test-message-id',
        ReceiptHandle: 'test-receipt-handle',
        Body: JSON.stringify({ content: 'test message' }),
      };

      await handlerFunction(mockMessage);

      expect(mockTarget.handleMessage).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle async methods in handler function', async () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/async-queue';
      const mockTarget = {
        handleAsyncMessage: jest
          .fn()
          .mockImplementation(async (message: Message) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return `processed: ${message.MessageId}`;
          }),
        constructor: class AsyncTestService {},
      };

      registry.registerHandler(
        queueUrl,
        mockTarget,
        'handleAsyncMessage',
        false,
      );

      const handlers = registry.getHandlers();
      const handlerFunction = handlers[0].handler;

      const mockMessage: Message = {
        MessageId: 'async-message-id',
        ReceiptHandle: 'async-receipt-handle',
        Body: JSON.stringify({ content: 'async test message' }),
      };

      await handlerFunction(mockMessage);

      expect(mockTarget.handleAsyncMessage).toHaveBeenCalledWith(mockMessage);
    });

    it('should preserve method context in handler function', async () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/context-queue';

      class TestService {
        private serviceId = 'test-service-123';

        handleMessage(message: Message) {
          return `${this.serviceId}: ${message.MessageId}`;
        }
      }

      const mockTarget = new TestService();
      const handleMessageSpy = jest.spyOn(mockTarget, 'handleMessage');

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = registry.getHandlers();
      const handlerFunction = handlers[0].handler;

      const mockMessage: Message = {
        MessageId: 'context-message-id',
        ReceiptHandle: 'context-receipt-handle',
        Body: JSON.stringify({ content: 'context test message' }),
      };

      await handlerFunction(mockMessage);

      expect(handleMessageSpy).toHaveBeenCalledWith(mockMessage);
    });
  });

  describe('getHandlers', () => {
    it('should return empty array when no handlers registered', () => {
      const handlers = registry.getHandlers();
      expect(handlers).toEqual([]);
    });

    it('should return all registered handlers', () => {
      const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';
      const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

      const mockTarget1 = {
        handleMessage1: jest.fn(),
        constructor: class TestService1 {},
      };

      const mockTarget2 = {
        handleMessage2: jest.fn(),
        constructor: class TestService2 {},
      };

      registry.registerHandler(queueUrl1, mockTarget1, 'handleMessage1', false);
      registry.registerHandler(queueUrl2, mockTarget2, 'handleMessage2', true);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(2);
    });

    it('should return handlers in registration order', () => {
      const urls = [
        'https://sqs.us-east-1.amazonaws.com/123456789/first-queue',
        'https://sqs.us-east-1.amazonaws.com/123456789/second-queue',
        'https://sqs.us-east-1.amazonaws.com/123456789/third-queue',
      ];

      urls.forEach((url, index) => {
        const mockTarget = {
          [`handleMessage${index}`]: jest.fn(),
          constructor: class TestService {},
        };
        registry.registerHandler(
          url,
          mockTarget,
          `handleMessage${index}`,
          false,
        );
      });

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(3);

      handlers.forEach((handler, index) => {
        expect(handler.queueUrl).toBe(urls[index]);
        expect(handler.methodName).toBe(`handleMessage${index}`);
      });
    });

    it('should return the same handlers array reference', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/copy-test-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers1 = registry.getHandlers();
      const handlers2 = registry.getHandlers();

      expect(handlers1).toBe(handlers2); // Same array instance
      expect(handlers1).toEqual(handlers2); // Same content
    });
  });

  describe('getHandlersByQueue', () => {
    beforeEach(() => {
      const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';
      const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

      const mockTarget1a = {
        handleMessage1a: jest.fn(),
        constructor: class TestService1a {},
      };

      const mockTarget1b = {
        handleMessage1b: jest.fn(),
        constructor: class TestService1b {},
      };

      const mockTarget2 = {
        handleMessage2: jest.fn(),
        constructor: class TestService2 {},
      };

      registry.registerHandler(
        queueUrl1,
        mockTarget1a,
        'handleMessage1a',
        false,
      );
      registry.registerHandler(
        queueUrl1,
        mockTarget1b,
        'handleMessage1b',
        false,
      );
      registry.registerHandler(queueUrl2, mockTarget2, 'handleMessage2', true);
    });

    it('should return handlers for specific queue URL', () => {
      const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';

      const handlers = registry.getHandlersByQueue(queueUrl1);

      expect(handlers).toHaveLength(2);
      handlers.forEach((handler) => {
        expect(handler.queueUrl).toBe(queueUrl1);
        expect(handler.isDlq).toBe(false);
      });

      expect(handlers[0].methodName).toBe('handleMessage1a');
      expect(handlers[1].methodName).toBe('handleMessage1b');
    });

    it('should return DLQ handlers for specific queue URL', () => {
      const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

      const handlers = registry.getHandlersByQueue(queueUrl2);

      expect(handlers).toHaveLength(1);
      expect(handlers[0].queueUrl).toBe(queueUrl2);
      expect(handlers[0].isDlq).toBe(true);
      expect(handlers[0].methodName).toBe('handleMessage2');
    });

    it('should return empty array for non-existent queue URL', () => {
      const nonExistentUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/non-existent';

      const handlers = registry.getHandlersByQueue(nonExistentUrl);

      expect(handlers).toEqual([]);
    });

    it('should return empty array for empty queue URL', () => {
      const handlers = registry.getHandlersByQueue('');

      expect(handlers).toEqual([]);
    });

    it('should return empty array for null queue URL', () => {
      const handlers = registry.getHandlersByQueue(null as any);

      expect(handlers).toEqual([]);
    });

    it('should return empty array for undefined queue URL', () => {
      const handlers = registry.getHandlersByQueue(undefined as any);

      expect(handlers).toEqual([]);
    });

    it('should handle case-sensitive queue URLs', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/CaseSensitive';
      const wrongCaseUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/casesensitive';

      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const correctHandlers = registry.getHandlersByQueue(queueUrl);
      const wrongHandlers = registry.getHandlersByQueue(wrongCaseUrl);

      expect(correctHandlers).toHaveLength(1);
      expect(wrongHandlers).toHaveLength(0);
    });
  });

  describe('SqsHandler interface compliance', () => {
    it('should create handlers that comply with SqsHandler interface', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/interface-test-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = registry.getHandlers();
      const handler = handlers[0];

      // Check all required properties exist
      expect(handler).toHaveProperty('queueUrl');
      expect(handler).toHaveProperty('handler');
      expect(handler).toHaveProperty('isDlq');
      expect(handler).toHaveProperty('target');
      expect(handler).toHaveProperty('methodName');
      expect(handler).toHaveProperty('targetConstructor');

      // Check property types
      expect(typeof handler.queueUrl).toBe('string');
      expect(typeof handler.handler).toBe('function');
      expect(typeof handler.isDlq).toBe('boolean');
      expect(typeof handler.target).toBe('object');
      expect(typeof handler.methodName).toBe('string');
      expect(typeof handler.targetConstructor).toBe('function');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle target without constructor', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/no-constructor-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        // No constructor property, will use Object constructor
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0].targetConstructor).toBe(Object);
    });

    it('should handle method that does not exist on target', async () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/missing-method-queue';
      const mockTarget = {
        // handleMessage method does not exist
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = registry.getHandlers();
      const handlerFunction = handlers[0].handler;

      const mockMessage: Message = {
        MessageId: 'test-message-id',
        ReceiptHandle: 'test-receipt-handle',
        Body: JSON.stringify({ content: 'test message' }),
      };

      // Should not throw error, but method call will fail
      await expect(handlerFunction(mockMessage)).rejects.toThrow();
    });

    it('should handle null target gracefully', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/null-target-queue';
      const nullTarget = null as any;

      // This will throw an error due to accessing constructor on null
      expect(() => {
        registry.registerHandler(queueUrl, nullTarget, 'handleMessage', false);
      }).toThrow();
    });

    it('should handle empty method name', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/empty-method-queue';
      const mockTarget = {
        '': jest.fn(), // Empty method name
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, '', false);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0].methodName).toBe('');
    });
  });

  describe('registry singleton behavior', () => {
    it('should maintain state across multiple imports', () => {
      // This test ensures the registry is a singleton
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/singleton-test-queue';
      const mockTarget = {
        handleMessage: jest.fn(),
        constructor: class TestService {},
      };

      registry.registerHandler(queueUrl, mockTarget, 'handleMessage', false);

      const handlers = importedRegistry.getHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0].queueUrl).toBe(queueUrl);
    });
  });
});
