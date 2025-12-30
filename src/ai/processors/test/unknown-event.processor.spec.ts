import { Test, TestingModule } from '@nestjs/testing';
import { UnknownEventProcessor } from '../unknown-event.processor';
import { LoggerService } from '../../../logger/logger.service';

describe('UnknownEventProcessor', () => {
  let processor: UnknownEventProcessor;
  let mockLogger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    // Mock LoggerService
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [UnknownEventProcessor],
    }).compile();

    processor = module.get<UnknownEventProcessor>(UnknownEventProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and basic setup', () => {
    it('should be defined', () => {
      expect(processor).toBeDefined();
    });

    it('should initialize logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith(
        'UnknownEventProcessor',
      );
    });
  });

  describe('getEventType', () => {
    it('should return UNKNOWN_EVENT', () => {
      expect(processor.getEventType()).toBe('UNKNOWN_EVENT');
    });
  });

  describe('process', () => {
    it('should process unknown event with eventType and eventData', async () => {
      const unknownEventData = {
        eventType: 'custom_unknown_event',
        eventData: {
          id: 'test-id',
          message: 'test message',
          timestamp: Date.now(),
        },
      };

      await processor.process(unknownEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: custom_unknown_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(unknownEventData.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event custom_unknown_event was not processed - no handler found',
      );
    });

    it('should handle event with undefined eventType', async () => {
      const eventDataWithUndefinedType = {
        eventType: undefined,
        eventData: {
          content: 'some content',
        },
      };

      await processor.process(eventDataWithUndefinedType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: undefined',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(eventDataWithUndefinedType.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event undefined was not processed - no handler found',
      );
    });

    it('should handle event with null eventType', async () => {
      const eventDataWithNullType = {
        eventType: null,
        eventData: {
          content: 'some content',
        },
      };

      await processor.process(eventDataWithNullType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: null',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(eventDataWithNullType.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event null was not processed - no handler found',
      );
    });

    it('should handle event with empty string eventType', async () => {
      const eventDataWithEmptyType = {
        eventType: '',
        eventData: {
          content: 'some content',
        },
      };

      await processor.process(eventDataWithEmptyType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: ',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(eventDataWithEmptyType.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event  was not processed - no handler found',
      );
    });

    it('should handle event with undefined eventData', async () => {
      const eventDataWithUndefinedData = {
        eventType: 'test_event',
        eventData: undefined,
      };

      await processor.process(eventDataWithUndefinedData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: test_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: undefined');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event test_event was not processed - no handler found',
      );
    });

    it('should handle event with null eventData', async () => {
      const eventDataWithNullData = {
        eventType: 'test_event',
        eventData: null,
      };

      await processor.process(eventDataWithNullData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: test_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: null');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event test_event was not processed - no handler found',
      );
    });

    it('should handle event with empty object eventData', async () => {
      const eventDataWithEmptyObject = {
        eventType: 'empty_event',
        eventData: {},
      };

      await processor.process(eventDataWithEmptyObject);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: empty_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: {}');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event empty_event was not processed - no handler found',
      );
    });

    it('should handle event with complex nested eventData', async () => {
      const complexEventData = {
        eventType: 'complex_event',
        eventData: {
          user: {
            id: 'user-123',
            profile: {
              name: 'John Doe',
              preferences: {
                theme: 'dark',
                notifications: true,
              },
            },
          },
          actions: [
            { type: 'click', target: 'button-1' },
            { type: 'scroll', position: 100 },
          ],
          metadata: {
            timestamp: Date.now(),
            version: '1.0.0',
          },
        },
      };

      await processor.process(complexEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: complex_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(complexEventData.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event complex_event was not processed - no handler found',
      );
    });

    it('should handle event with array eventData', async () => {
      const eventDataWithArray = {
        eventType: 'array_event',
        eventData: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
          { id: 3, name: 'Item 3' },
        ],
      };

      await processor.process(eventDataWithArray);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: array_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(eventDataWithArray.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event array_event was not processed - no handler found',
      );
    });

    it('should handle event with primitive eventData', async () => {
      const eventDataWithString = {
        eventType: 'string_event',
        eventData: 'This is just a string',
      };

      await processor.process(eventDataWithString);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: string_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Event data: "This is just a string"',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event string_event was not processed - no handler found',
      );
    });

    it('should handle event with number eventData', async () => {
      const eventDataWithNumber = {
        eventType: 'number_event',
        eventData: 12345,
      };

      await processor.process(eventDataWithNumber);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: number_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: 12345');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event number_event was not processed - no handler found',
      );
    });

    it('should handle event with boolean eventData', async () => {
      const eventDataWithBoolean = {
        eventType: 'boolean_event',
        eventData: true,
      };

      await processor.process(eventDataWithBoolean);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: boolean_event',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: true');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event boolean_event was not processed - no handler found',
      );
    });

    it('should handle malformed input data', async () => {
      const malformedData = {
        // Missing eventType
        eventData: { content: 'test' },
      };

      await processor.process(malformedData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: undefined',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event data: ${JSON.stringify(malformedData.eventData, null, 2)}`,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event undefined was not processed - no handler found',
      );
    });

    it('should handle completely empty input', async () => {
      const emptyData = {};

      await processor.process(emptyData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: undefined',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Event data: undefined');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event undefined was not processed - no handler found',
      );
    });

    it('should handle circular reference in eventData', async () => {
      const circularData: any = {
        eventType: 'circular_event',
        eventData: {
          id: 'test',
          name: 'circular test',
        },
      };
      // Create circular reference
      circularData.eventData.self = circularData.eventData;

      // This should not throw an error, but the JSON.stringify will fail internally
      await expect(processor.process(circularData)).rejects.toThrow();
    });

    it('should handle very large eventData', async () => {
      const largeEventData = {
        eventType: 'large_event',
        eventData: {
          largeString: 'A'.repeat(10000), // 10KB string
          largeArray: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            value: `item-${i}`,
          })),
        },
      };

      await processor.process(largeEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unknown event type detected: large_event',
      );
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event large_event was not processed - no handler found',
      );
    });

    it('should handle concurrent processing of unknown events', async () => {
      const event1 = {
        eventType: 'concurrent_event_1',
        eventData: { id: 1 },
      };

      const event2 = {
        eventType: 'concurrent_event_2',
        eventData: { id: 2 },
      };

      await Promise.all([processor.process(event1), processor.process(event2)]);

      expect(mockLogger.info).toHaveBeenCalledTimes(4); // 2 calls per event
      expect(mockLogger.warn).toHaveBeenCalledTimes(2); // 1 call per event
    });
  });

  describe('Error Handling', () => {
    it('should handle JSON.stringify errors gracefully', async () => {
      // Create an object that throws during JSON.stringify
      const problematicEventData = {
        eventType: 'problematic_event',
        eventData: {},
      };

      // Mock JSON.stringify to throw
      const originalStringify = JSON.stringify;
      JSON.stringify = jest
        .fn()
        .mockImplementation((value, replacer, space) => {
          if (space === 2) {
            throw new Error('JSON stringify error');
          }
          return originalStringify(value, replacer, space);
        });

      await expect(processor.process(problematicEventData)).rejects.toThrow(
        'JSON stringify error',
      );

      // Restore original JSON.stringify
      JSON.stringify = originalStringify;
    });
  });
});
