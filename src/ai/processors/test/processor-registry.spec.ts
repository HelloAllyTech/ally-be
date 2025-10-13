import { Test, TestingModule } from '@nestjs/testing';
import { ProcessorRegistry } from '../processor-registry';
import { TranscribeResultProcessor } from '../transcribe-result.processor';
import { UnknownEventProcessor } from '../unknown-event.processor';
import { LearnMessageProcessor } from '../../../learn/processor/learn-message.processor';
import { LearnEventProcessor } from '../../../learn/processor/learn-event.processor';
import { LoggerService } from '../../../logger/logger.service';
import { IEventProcessor } from '../base-processor.interface';

describe('ProcessorRegistry', () => {
  let registry: ProcessorRegistry;
  let transcribeResultProcessor: jest.Mocked<TranscribeResultProcessor>;
  let learnMessageProcessor: jest.Mocked<LearnMessageProcessor>;
  let learnEventProcessor: jest.Mocked<LearnEventProcessor>;
  let unknownEventProcessor: jest.Mocked<UnknownEventProcessor>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockProcessorBase = {
    process: jest.fn(),
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

    const mockTranscribeResultProcessor = {
      ...mockProcessorBase,
      getEventType: jest.fn().mockReturnValue('transcribe_result'),
      process: jest.fn().mockResolvedValue(undefined),
    };

    const mockLearnMessageProcessor = {
      ...mockProcessorBase,
      getEventType: jest.fn().mockReturnValue('learn_message'),
      process: jest.fn().mockResolvedValue(undefined),
    };

    const mockLearnEventProcessor = {
      ...mockProcessorBase,
      getEventType: jest.fn().mockReturnValue('learn_event'),
      process: jest.fn().mockResolvedValue(undefined),
    };

    const mockUnknownEventProcessor = {
      ...mockProcessorBase,
      getEventType: jest.fn().mockReturnValue('unknown'),
      process: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessorRegistry,
        {
          provide: TranscribeResultProcessor,
          useValue: mockTranscribeResultProcessor,
        },
        {
          provide: LearnMessageProcessor,
          useValue: mockLearnMessageProcessor,
        },
        {
          provide: LearnEventProcessor,
          useValue: mockLearnEventProcessor,
        },
        {
          provide: UnknownEventProcessor,
          useValue: mockUnknownEventProcessor,
        },
      ],
    }).compile();

    registry = module.get<ProcessorRegistry>(ProcessorRegistry);
    transcribeResultProcessor = module.get(TranscribeResultProcessor);
    learnMessageProcessor = module.get(LearnMessageProcessor);
    learnEventProcessor = module.get(LearnEventProcessor);
    unknownEventProcessor = module.get(UnknownEventProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should be defined', () => {
      expect(registry).toBeDefined();
    });

    it('should initialize logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith(
        'ProcessorRegistry',
      );
    });

    it('should register all processors during initialization', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registered 3 event processors',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Registered processor for: transcribe_result',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Registered processor for: learn_message',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Registered processor for: learn_event',
      );
    });
  });

  describe('getProcessor', () => {
    it('should return correct processor for transcribe_result event', () => {
      const processor = registry.getProcessor('transcribe_result');
      expect(processor).toBe(transcribeResultProcessor);
    });

    it('should return correct processor for learn_message event', () => {
      const processor = registry.getProcessor('learn_message');
      expect(processor).toBe(learnMessageProcessor);
    });

    it('should return correct processor for learn_event event', () => {
      const processor = registry.getProcessor('learn_event');
      expect(processor).toBe(learnEventProcessor);
    });

    it('should return undefined for unknown event type', () => {
      const processor = registry.getProcessor('non_existent_event');
      expect(processor).toBeUndefined();
    });

    it('should return undefined for empty string event type', () => {
      const processor = registry.getProcessor('');
      expect(processor).toBeUndefined();
    });

    it('should return undefined for null event type', () => {
      const processor = registry.getProcessor(null as any);
      expect(processor).toBeUndefined();
    });

    it('should return undefined for undefined event type', () => {
      const processor = registry.getProcessor(undefined as any);
      expect(processor).toBeUndefined();
    });
  });

  describe('processEvent', () => {
    const mockEventData = { id: 'test-data', content: 'test content' };

    it('should process event with registered processor', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('transcribe_result', mockEventData);

      expect(transcribeResultProcessor.process).toHaveBeenCalledWith(
        mockEventData,
      );
      expect(unknownEventProcessor.process).not.toHaveBeenCalled();
    });

    it('should process event with learn message processor', async () => {
      learnMessageProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('learn_message', mockEventData);

      expect(learnMessageProcessor.process).toHaveBeenCalledWith(mockEventData);
      expect(unknownEventProcessor.process).not.toHaveBeenCalled();
    });

    it('should process event with learn event processor', async () => {
      learnEventProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('learn_event', mockEventData);

      expect(learnEventProcessor.process).toHaveBeenCalledWith(mockEventData);
      expect(unknownEventProcessor.process).not.toHaveBeenCalled();
    });

    it('should use unknown event processor for unregistered event type', async () => {
      unknownEventProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('unknown_event_type', mockEventData);

      expect(unknownEventProcessor.process).toHaveBeenCalledWith({
        eventType: 'unknown_event_type',
        eventData: mockEventData,
      });
      expect(transcribeResultProcessor.process).not.toHaveBeenCalled();
    });

    it('should handle processor throwing error', async () => {
      const error = new Error('Processor failed');
      transcribeResultProcessor.process.mockRejectedValue(error);

      await expect(
        registry.processEvent('transcribe_result', mockEventData),
      ).rejects.toThrow('Processor failed');
    });

    it('should handle unknown processor throwing error', async () => {
      const error = new Error('Unknown processor failed');
      unknownEventProcessor.process.mockRejectedValue(error);

      await expect(
        registry.processEvent('unknown_event_type', mockEventData),
      ).rejects.toThrow('Unknown processor failed');
    });

    it('should handle empty event data', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('transcribe_result', {});

      expect(transcribeResultProcessor.process).toHaveBeenCalledWith({});
    });

    it('should handle null event data', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('transcribe_result', null);

      expect(transcribeResultProcessor.process).toHaveBeenCalledWith(null);
    });

    it('should handle undefined event data', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('transcribe_result', undefined);

      expect(transcribeResultProcessor.process).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getRegisteredEventTypes', () => {
    it('should return all registered event types', () => {
      const eventTypes = registry.getRegisteredEventTypes();

      expect(eventTypes).toHaveLength(3);
      expect(eventTypes).toContain('transcribe_result');
      expect(eventTypes).toContain('learn_message');
      expect(eventTypes).toContain('learn_event');
    });

    it('should return array in consistent order', () => {
      const eventTypes1 = registry.getRegisteredEventTypes();
      const eventTypes2 = registry.getRegisteredEventTypes();

      expect(eventTypes1).toEqual(eventTypes2);
    });
  });

  describe('getProcessorHealth', () => {
    it('should return health status for all processors', () => {
      const health = registry.getProcessorHealth();

      expect(health).toEqual({
        transcribe_result: true,
        learn_message: true,
        learn_event: true,
      });
    });

    it('should return consistent health status', () => {
      const health1 = registry.getProcessorHealth();
      const health2 = registry.getProcessorHealth();

      expect(health1).toEqual(health2);
    });
  });

  describe('registerCustomProcessor', () => {
    it('should register custom processor successfully', () => {
      const customProcessor: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('custom_event'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(customProcessor);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registered custom processor for: custom_event',
      );

      // Verify processor is registered
      const processor = registry.getProcessor('custom_event');
      expect(processor).toBe(customProcessor);
    });

    it('should update registered event types after custom registration', () => {
      const customProcessor: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('custom_event'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(customProcessor);

      const eventTypes = registry.getRegisteredEventTypes();
      expect(eventTypes).toContain('custom_event');
      expect(eventTypes).toHaveLength(4);
    });

    it('should update processor health after custom registration', () => {
      const customProcessor: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('custom_event'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(customProcessor);

      const health = registry.getProcessorHealth();
      expect(health.custom_event).toBe(true);
    });

    it('should override existing processor with same event type', () => {
      const newTranscribeProcessor: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('transcribe_result'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(newTranscribeProcessor);

      const processor = registry.getProcessor('transcribe_result');
      expect(processor).toBe(newTranscribeProcessor);
      expect(processor).not.toBe(transcribeResultProcessor);
    });

    it('should handle processor with empty event type', () => {
      const emptyProcessor: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue(''),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(emptyProcessor);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registered custom processor for: ',
      );

      const processor = registry.getProcessor('');
      expect(processor).toBe(emptyProcessor);
    });

    it('should handle multiple custom processors', () => {
      const customProcessor1: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('custom_event_1'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      const customProcessor2: IEventProcessor = {
        getEventType: jest.fn().mockReturnValue('custom_event_2'),
        process: jest.fn().mockResolvedValue(undefined),
      };

      registry.registerCustomProcessor(customProcessor1);
      registry.registerCustomProcessor(customProcessor2);

      expect(registry.getProcessor('custom_event_1')).toBe(customProcessor1);
      expect(registry.getProcessor('custom_event_2')).toBe(customProcessor2);
      expect(registry.getRegisteredEventTypes()).toHaveLength(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent event processing', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);
      learnMessageProcessor.process.mockResolvedValue(undefined);

      const promises = [
        registry.processEvent('transcribe_result', { id: 1 }),
        registry.processEvent('learn_message', { id: 2 }),
        registry.processEvent('transcribe_result', { id: 3 }),
      ];

      await Promise.all(promises);

      expect(transcribeResultProcessor.process).toHaveBeenCalledTimes(2);
      expect(learnMessageProcessor.process).toHaveBeenCalledTimes(1);
    });

    it('should handle case-sensitive event types', () => {
      const processor1 = registry.getProcessor('transcribe_result');
      const processor2 = registry.getProcessor('TRANSCRIBE_RESULT');
      const processor3 = registry.getProcessor('Transcribe_Result');

      expect(processor1).toBe(transcribeResultProcessor);
      expect(processor2).toBeUndefined();
      expect(processor3).toBeUndefined();
    });

    it('should maintain processor state across multiple calls', async () => {
      transcribeResultProcessor.process.mockResolvedValue(undefined);

      await registry.processEvent('transcribe_result', { call: 1 });
      await registry.processEvent('transcribe_result', { call: 2 });

      expect(transcribeResultProcessor.process).toHaveBeenCalledTimes(2);
      expect(transcribeResultProcessor.process).toHaveBeenNthCalledWith(1, {
        call: 1,
      });
      expect(transcribeResultProcessor.process).toHaveBeenNthCalledWith(2, {
        call: 2,
      });
    });
  });
});
