import { Test, TestingModule } from '@nestjs/testing';
import {
  RoomFinishedHandler,
  RoomFinishedEvent,
} from '../room-finished.handler';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from 'src/learn/enum/scenario-session-status.enum';

describe('RoomFinishedHandler', () => {
  let handler: RoomFinishedHandler;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockScenarioSession: ScenarioSessions = {
    id: 'session-123',
    roomId: 'test-room',
    scenarioId: 1,
    counselorId: 456,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date(),
    endedAt: undefined,
    score: undefined,
    metadata: undefined,
    tenantId: 'tenant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockRoomFinishedEvent: RoomFinishedEvent = {
    event: 'room_finished',
    room: {
      name: 'test-room',
      sid: 'room-sid-123',
      creation_time: Date.now(),
      empty_timeout: 3600,
      max_participants: 5,
      num_participants: 0,
      num_publishers: 0,
      active_recording: false,
      metadata: '{"scenarioId": 123}',
    },
    id: 'event-id-123',
    created_at: Date.now(),
  };

  beforeEach(async () => {
    const mockScenarioSessionService = {
      getScenarioSessionByRoomId: jest.fn(),
      endScenarioSession: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomFinishedHandler,
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
      ],
    }).compile();

    handler = module.get<RoomFinishedHandler>(RoomFinishedHandler);
    scenarioSessionService = module.get(ScenarioSessionService);

    // Mock the logger instance after handler is created
    (handler as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should handle room finished event successfully', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(mockRoomFinishedEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Room finished: ${mockRoomFinishedEvent.room.name}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('test-room');
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'session-123',
        456,
      );
    });

    it('should handle getScenarioSessionByRoomId error', async () => {
      const error = new Error('Scenario session not found');
      scenarioSessionService.getScenarioSessionByRoomId.mockRejectedValue(
        error,
      );

      await expect(handler.handle(mockRoomFinishedEvent)).rejects.toThrow(
        'Scenario session not found',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle room finished: "Scenario session not found"',
      );
      expect(scenarioSessionService.endScenarioSession).not.toHaveBeenCalled();
    });

    it('should handle endScenarioSession error', async () => {
      const error = new Error('Failed to end scenario session');
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockRejectedValue(error);

      await expect(handler.handle(mockRoomFinishedEvent)).rejects.toThrow(
        'Failed to end scenario session',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle room finished: "Failed to end scenario session"',
      );
    });

    it('should handle different room names', async () => {
      const eventWithDifferentRoom: RoomFinishedEvent = {
        ...mockRoomFinishedEvent,
        room: {
          ...mockRoomFinishedEvent.room,
          name: 'scenario-room-456',
        },
      };

      const sessionWithDifferentRoom = {
        ...mockScenarioSession,
        roomId: 'scenario-room-456',
        id: 'session-456',
        counselorId: 789,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        sessionWithDifferentRoom,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(eventWithDifferentRoom);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room finished: scenario-room-456',
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('scenario-room-456');
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'session-456',
        789,
      );
    });

    it('should handle scenario session with different counselor ID', async () => {
      const sessionWithDifferentCounselor = {
        ...mockScenarioSession,
        counselorId: 999,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        sessionWithDifferentCounselor,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(mockRoomFinishedEvent);

      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'session-123',
        999,
      );
    });

    it('should handle error without message property', async () => {
      const errorWithoutMessage = {
        code: 'UNKNOWN_ERROR',
        details: 'Some details',
      };
      scenarioSessionService.getScenarioSessionByRoomId.mockRejectedValue(
        errorWithoutMessage,
      );

      await expect(handler.handle(mockRoomFinishedEvent)).rejects.toBe(
        errorWithoutMessage,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle room finished: undefined',
      );
    });

    it('should handle room with null name', async () => {
      const eventWithNullRoomName: RoomFinishedEvent = {
        ...mockRoomFinishedEvent,
        room: {
          ...mockRoomFinishedEvent.room,
          name: null as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(eventWithNullRoomName);

      expect(mockLogger.info).toHaveBeenCalledWith('Room finished: null');
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(null);
    });

    it('should handle room with undefined name', async () => {
      const eventWithUndefinedRoomName: RoomFinishedEvent = {
        ...mockRoomFinishedEvent,
        room: {
          ...mockRoomFinishedEvent.room,
          name: undefined as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(eventWithUndefinedRoomName);

      expect(mockLogger.info).toHaveBeenCalledWith('Room finished: undefined');
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(undefined);
    });

    it('should handle scenario session with all properties', async () => {
      const completeScenarioSession: ScenarioSessions = {
        id: 'complete-session-123',
        roomId: 'complete-room',
        scenarioId: 42,
        counselorId: 123,
        status: ScenarioSessionStatus.ACTIVE,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: undefined,
        score: 85.5,
        metadata: { sessionType: 'assessment' },
        tenantId: 'complete-tenant',
        createdAt: new Date('2024-01-01T09:00:00Z'),
        updatedAt: new Date('2024-01-01T11:00:00Z'),
      } as ScenarioSessions;

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        completeScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(mockRoomFinishedEvent);

      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'complete-session-123',
        123,
      );
    });

    it('should not end scenario session if already ended', async () => {
      const endedScenarioSession: ScenarioSessions = {
        id: 'ended-session-123',
        roomId: 'test-room',
        scenarioId: 1,
        counselorId: 456,
        status: ScenarioSessionStatus.ENDED,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T11:00:00Z'),
        score: 85.5,
        metadata: undefined,
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ScenarioSessions;

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        endedScenarioSession,
      );

      await handler.handle(mockRoomFinishedEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Room finished: ${mockRoomFinishedEvent.room.name}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('test-room');
      expect(scenarioSessionService.endScenarioSession).not.toHaveBeenCalled();
    });

    it('should handle minimal room finished event', async () => {
      const minimalEvent: RoomFinishedEvent = {
        event: 'room_finished',
        room: {
          name: 'minimal-room',
          sid: 'minimal-sid',
          creation_time: Date.now(),
          empty_timeout: 0,
          max_participants: 1,
          num_participants: 0,
          num_publishers: 0,
          active_recording: false,
          metadata: '',
        },
        id: 'minimal-event-id',
        created_at: Date.now(),
      };

      const minimalSession = {
        ...mockScenarioSession,
        roomId: 'minimal-room',
        id: 'minimal-session',
        counselorId: 1,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        minimalSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(minimalEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room finished: minimal-room',
      );
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'minimal-session',
        1,
      );
    });

    it('should handle room with complex metadata', async () => {
      const eventWithComplexMetadata: RoomFinishedEvent = {
        ...mockRoomFinishedEvent,
        room: {
          ...mockRoomFinishedEvent.room,
          metadata: JSON.stringify({
            scenarioId: 999,
            type: 'advanced',
            settings: { recordingEnabled: true },
          }),
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(eventWithComplexMetadata);

      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('test-room');
      expect(scenarioSessionService.endScenarioSession).toHaveBeenCalledWith(
        'session-123',
        456,
      );
    });

    it('should handle room with special characters in name', async () => {
      const eventWithSpecialChars: RoomFinishedEvent = {
        ...mockRoomFinishedEvent,
        room: {
          ...mockRoomFinishedEvent.room,
          name: 'room_with-special.chars@123',
        },
      };

      const sessionWithSpecialRoom = {
        ...mockScenarioSession,
        roomId: 'room_with-special.chars@123',
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        sessionWithSpecialRoom,
      );
      scenarioSessionService.endScenarioSession.mockResolvedValue({
        message: 'Scenario session ended successfully',
      });

      await handler.handle(eventWithSpecialChars);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Room finished: room_with-special.chars@123',
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith('room_with-special.chars@123');
    });
  });
});
