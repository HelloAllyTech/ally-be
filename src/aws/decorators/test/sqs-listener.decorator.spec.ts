import { SqsListener, SqsDlqListener } from '../sqs-listener.decorator';
import { sqsHandlerRegistry } from '../../registry/sqs-handler.registry';

// Mock the registry
jest.mock('../../registry/sqs-handler.registry');

describe('SQS Listener Decorators', () => {
  let mockRegistry: jest.Mocked<typeof sqsHandlerRegistry>;

  beforeEach(() => {
    mockRegistry = sqsHandlerRegistry as jest.Mocked<typeof sqsHandlerRegistry>;
    mockRegistry.registerHandler = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('SqsListener', () => {
    it('should register handler with correct parameters', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

      class TestService {
        @SqsListener(queueUrl)
        handleMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService.prototype,
        'handleMessage',
        false, // isDlq should be false for regular listener
      );
    });

    it('should register multiple handlers in the same class', () => {
      const queueUrl1 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue1';
      const queueUrl2 = 'https://sqs.us-east-1.amazonaws.com/123456789/queue2';

      class TestService {
        @SqsListener(queueUrl1)
        handleMessage1(message: any) {
          return message;
        }

        @SqsListener(queueUrl2)
        handleMessage2(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        queueUrl1,
        TestService.prototype,
        'handleMessage1',
        false,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        queueUrl2,
        TestService.prototype,
        'handleMessage2',
        false,
      );
    });

    it('should register handlers across different classes', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/shared-queue';

      class ServiceA {
        @SqsListener(queueUrl)
        handleMessageA(message: any) {
          return message;
        }
      }

      class ServiceB {
        @SqsListener(queueUrl)
        handleMessageB(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        queueUrl,
        ServiceA.prototype,
        'handleMessageA',
        false,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        queueUrl,
        ServiceB.prototype,
        'handleMessageB',
        false,
      );
    });

    it('should handle different queue URL formats', () => {
      const queueUrls = [
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
        'https://sqs.eu-west-1.amazonaws.com/987654321/another-queue',
        'https://sqs.ap-southeast-1.amazonaws.com/555666777/third-queue.fifo',
      ];

      class TestService {
        @SqsListener(queueUrls[0])
        handleMessage1(message: any) {
          return message;
        }

        @SqsListener(queueUrls[1])
        handleMessage2(message: any) {
          return message;
        }

        @SqsListener(queueUrls[2])
        handleMessage3(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(3);
      queueUrls.forEach((url, index) => {
        expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
          index + 1,
          url,
          TestService.prototype,
          `handleMessage${index + 1}`,
          false,
        );
      });
    });

    it('should return the original descriptor', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

      class TestService {
        @SqsListener(queueUrl)
        handleMessage() {
          return 'original method';
        }
      }

      const instance = new TestService();
      expect(instance.handleMessage()).toBe('original method');
    });

    it('should work with async methods', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/async-queue';

      class TestService {
        @SqsListener(queueUrl)
        async handleAsyncMessage(message: any) {
          return Promise.resolve(message);
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService.prototype,
        'handleAsyncMessage',
        false,
      );
    });

    it('should work with methods that have multiple parameters', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/multi-param-queue';

      class TestService {
        @SqsListener(queueUrl)
        handleMultiParamMessage(message: any, context?: any, options?: any) {
          return { message, context, options };
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService.prototype,
        'handleMultiParamMessage',
        false,
      );
    });
  });

  describe('SqsDlqListener', () => {
    it('should register DLQ handler with correct parameters', () => {
      const dlqUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue-dlq';

      class TestService {
        @SqsDlqListener(dlqUrl)
        handleDlqMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        dlqUrl,
        TestService.prototype,
        'handleDlqMessage',
        true, // isDlq should be true for DLQ listener
      );
    });

    it('should register multiple DLQ handlers', () => {
      const dlqUrl1 =
        'https://sqs.us-east-1.amazonaws.com/123456789/queue1-dlq';
      const dlqUrl2 =
        'https://sqs.us-east-1.amazonaws.com/123456789/queue2-dlq';

      class TestService {
        @SqsDlqListener(dlqUrl1)
        handleDlqMessage1(message: any) {
          return message;
        }

        @SqsDlqListener(dlqUrl2)
        handleDlqMessage2(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        dlqUrl1,
        TestService.prototype,
        'handleDlqMessage1',
        true,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        dlqUrl2,
        TestService.prototype,
        'handleDlqMessage2',
        true,
      );
    });

    it('should work with FIFO DLQ queues', () => {
      const fifoUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue.fifo-dlq';

      class TestService {
        @SqsDlqListener(fifoUrl)
        handleFifoDlqMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        fifoUrl,
        TestService.prototype,
        'handleFifoDlqMessage',
        true,
      );
    });

    it('should return the original descriptor', () => {
      const dlqUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-dlq';

      class TestService {
        @SqsDlqListener(dlqUrl)
        handleDlqMessage() {
          return 'original dlq method';
        }
      }

      const instance = new TestService();
      expect(instance.handleDlqMessage()).toBe('original dlq method');
    });
  });

  describe('Mixed decorators', () => {
    it('should handle both regular and DLQ listeners in same class', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/main-queue';
      const dlqUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/main-queue-dlq';

      class TestService {
        @SqsListener(queueUrl)
        handleMessage(message: any) {
          return message;
        }

        @SqsDlqListener(dlqUrl)
        handleDlqMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        queueUrl,
        TestService.prototype,
        'handleMessage',
        false,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        dlqUrl,
        TestService.prototype,
        'handleDlqMessage',
        true,
      );
    });

    it('should handle multiple decorators on different methods with same queue URL', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/shared-queue';

      class TestService {
        @SqsListener(queueUrl)
        handleMessage1(message: any) {
          return `handler1: ${message}`;
        }

        @SqsListener(queueUrl)
        handleMessage2(message: any) {
          return `handler2: ${message}`;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        queueUrl,
        TestService.prototype,
        'handleMessage1',
        false,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        queueUrl,
        TestService.prototype,
        'handleMessage2',
        false,
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty queue URL', () => {
      const emptyUrl = '';

      class TestService {
        @SqsListener(emptyUrl)
        handleMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        emptyUrl,
        TestService.prototype,
        'handleMessage',
        false,
      );
    });

    it('should handle null queue URL', () => {
      const nullUrl = null as any;

      class TestService {
        @SqsListener(nullUrl)
        handleMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        nullUrl,
        TestService.prototype,
        'handleMessage',
        false,
      );
    });

    it('should handle undefined queue URL', () => {
      const undefinedUrl = undefined as any;

      class TestService {
        @SqsListener(undefinedUrl)
        handleMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        undefinedUrl,
        TestService.prototype,
        'handleMessage',
        false,
      );
    });

    it('should work with private methods', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/private-queue';

      class TestService {
        @SqsListener(queueUrl)
        private handlePrivateMessage(message: any) {
          return message;
        }

        public callPrivateHandler(message: any) {
          return this.handlePrivateMessage(message);
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService.prototype,
        'handlePrivateMessage',
        false,
      );

      const instance = new TestService();
      expect(instance.callPrivateHandler('test')).toBe('test');
    });

    it('should work with static methods', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/static-queue';

      class TestService {
        @SqsListener(queueUrl)
        static handleStaticMessage(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService,
        'handleStaticMessage',
        false,
      );

      expect(TestService.handleStaticMessage('test')).toBe('test');
    });
  });

  describe('decorator registration timing', () => {
    it('should register handlers immediately when decorator is applied', () => {
      const queueUrl =
        'https://sqs.us-east-1.amazonaws.com/123456789/immediate-queue';

      // Registry should be called during class definition
      expect(mockRegistry.registerHandler).not.toHaveBeenCalled();

      class TestService {
        @SqsListener(queueUrl)
        handleMessage(message: any) {
          return message;
        }
      }

      // Registry should be called after decorator application
      expect(mockRegistry.registerHandler).toHaveBeenCalledWith(
        queueUrl,
        TestService.prototype,
        'handleMessage',
        false,
      );
    });

    it('should register handlers in order of decorator application', () => {
      const queueUrl1 =
        'https://sqs.us-east-1.amazonaws.com/123456789/order-queue-1';
      const queueUrl2 =
        'https://sqs.us-east-1.amazonaws.com/123456789/order-queue-2';
      const queueUrl3 =
        'https://sqs.us-east-1.amazonaws.com/123456789/order-queue-3';

      class TestService {
        @SqsListener(queueUrl1)
        handleMessage1(message: any) {
          return message;
        }

        @SqsDlqListener(queueUrl2)
        handleDlqMessage(message: any) {
          return message;
        }

        @SqsListener(queueUrl3)
        handleMessage3(message: any) {
          return message;
        }
      }

      expect(mockRegistry.registerHandler).toHaveBeenCalledTimes(3);
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        1,
        queueUrl1,
        TestService.prototype,
        'handleMessage1',
        false,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        2,
        queueUrl2,
        TestService.prototype,
        'handleDlqMessage',
        true,
      );
      expect(mockRegistry.registerHandler).toHaveBeenNthCalledWith(
        3,
        queueUrl3,
        TestService.prototype,
        'handleMessage3',
        false,
      );
    });
  });
});
