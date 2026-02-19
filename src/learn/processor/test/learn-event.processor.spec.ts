import { Test, TestingModule } from '@nestjs/testing';
import { LearnEventProcessor } from '../learn-event.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from 'src/logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';

// Mock LoggerService
jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

describe('LearnEventProcessor', () => {
  let processor: LearnEventProcessor;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let mockLogger: jest.Mocked<any>;

  const mockTenantId = 'tenant-123';
  const mockRoomId = 'room-123';
  const mockScenarioSessionId = 'session-123';

  const mockScenarioSession: ScenarioSessions = {
    id: mockScenarioSessionId,
    roomId: mockRoomId,
    scenarioId: 1,
    counselorId: 123,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date(),
    endedAt: undefined,
    score: undefined,
    metadata: undefined,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockEventData: LearnMessageAndEventMessage = {
    message_type: 'event',
    timestamp: Date.now(),
    room_id: mockRoomId,
    data: {
      event: {
        timestamp: new Date(),
        event_data: {
          eventCode: 'SS1',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          message: 'Hello, world!',
          branchInstruction: 'This is a test branch instruction',
          detectionData: {
            sentences: ['This is a test sentence', 'This is a test sentence 2'],
          },
          id: '123',
          name: 'Test name',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    },
  };

  beforeEach(async () => {
    const mockScenarioSessionService = {
      getScenarioSessionByRoomIdOrNull: jest.fn(),
      handleScenarioSessionEvent: jest.fn(),
      addScenarioSessionEvent: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnEventProcessor,
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
      ],
    }).compile();

    processor = module.get<LearnEventProcessor>(LearnEventProcessor);
    scenarioSessionService = module.get(ScenarioSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEventType', () => {
    it('should return "event"', () => {
      const result = processor.getEventType();
      expect(result).toBe('event');
    });
  });

  describe('process', () => {
    it('should successfully process event data', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.handleScenarioSessionEvent.mockResolvedValue(
        {} as any,
      );

      await processor.process(mockEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(mockEventData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).toHaveBeenCalledWith(mockScenarioSession, mockEventData.data.event);
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Scenario session event added: ${mockScenarioSessionId}`,
      );
    });

    it('should skip processing for preview scenario rooms', async () => {
      const previewEventData: LearnMessageAndEventMessage = {
        ...mockEventData,
        room_id: 'preview-test-session-123',
      };

      await processor.process(previewEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(previewEventData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).not.toHaveBeenCalled();
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle scenario session not found', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        null as any,
      );

      await processor.process(mockEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(mockEventData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle undefined scenario session', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        undefined as any,
      );

      await processor.process(mockEventData);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle missing event data', async () => {
      const eventDataWithoutEvent: LearnMessageAndEventMessage = {
        message_type: 'event',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {},
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(eventDataWithoutEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(eventDataWithoutEvent)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle null event data', async () => {
      const eventDataWithNullEvent: LearnMessageAndEventMessage = {
        message_type: 'event',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          event: null as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(eventDataWithNullEvent);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle undefined event data', async () => {
      const eventDataWithUndefinedEvent: LearnMessageAndEventMessage = {
        message_type: 'event',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          event: undefined as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(eventDataWithUndefinedEvent);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Event not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle getScenarioSessionByRoomIdOrNull error', async () => {
      const error = new Error('Database connection failed');
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockRejectedValue(
        error,
      );

      await expect(processor.process(mockEventData)).rejects.toThrow(
        'Database connection failed',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(mockEventData)}`,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn event: "Database connection failed"',
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).not.toHaveBeenCalled();
    });

    it('should handle addScenarioSessionEvent error', async () => {
      const error = new Error('Failed to add event');
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.handleScenarioSessionEvent.mockRejectedValue(
        error,
      );

      await expect(processor.process(mockEventData)).rejects.toThrow(
        'Failed to add event',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(mockEventData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).toHaveBeenCalledWith(mockScenarioSession, mockEventData.data.event);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn event: "Failed to add event"',
      );
    });

    it('should handle error without message property', async () => {
      const errorWithoutMessage = {
        code: 'ERROR_CODE',
        details: 'Some details',
      };
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockRejectedValue(
        errorWithoutMessage,
      );

      await expect(processor.process(mockEventData)).rejects.toBe(
        errorWithoutMessage,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn event: undefined',
      );
    });

    it('should handle different room IDs', async () => {
      const differentRoomId = 'room-456';
      const eventDataWithDifferentRoom: LearnMessageAndEventMessage = {
        ...mockEventData,
        room_id: differentRoomId,
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        null as any,
      );

      await processor.process(eventDataWithDifferentRoom);

      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(differentRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${differentRoomId}`,
      );
    });

    it('should handle complex event data', async () => {
      const complexEventData: LearnMessageAndEventMessage = {
        message_type: 'event',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          event: {
            timestamp: new Date(),
            event_data: {
              eventCode: 'SS1',
              id: 'complex-event-123',
              name: 'Complex Event',
              detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
              visibilityType: SessionEventVisibilityType.ACTIVE,
              message: 'Hello, world!',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        },
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.handleScenarioSessionEvent.mockResolvedValue(
        {} as any,
      );

      await processor.process(complexEventData);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Processing learn event: ${JSON.stringify(complexEventData)}`,
      );
      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).toHaveBeenCalledWith(mockScenarioSession, complexEventData.data.event);
    });

    it('should handle scenario session with different tenant ID', async () => {
      const differentTenantId = 'tenant-456';
      const sessionWithDifferentTenant = {
        ...mockScenarioSession,
        tenantId: differentTenantId,
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        sessionWithDifferentTenant,
      );
      scenarioSessionService.handleScenarioSessionEvent.mockResolvedValue(
        {} as any,
      );

      await processor.process(mockEventData);

      expect(
        scenarioSessionService.handleScenarioSessionEvent,
      ).toHaveBeenCalledWith(
        sessionWithDifferentTenant,
        mockEventData.data.event,
      );
    });
  });
});
