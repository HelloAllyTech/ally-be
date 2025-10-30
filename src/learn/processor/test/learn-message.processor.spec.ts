import { Test, TestingModule } from '@nestjs/testing';
import { LearnMessageProcessor } from '../learn-message.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from 'src/logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';

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

describe('LearnMessageProcessor', () => {
  let processor: LearnMessageProcessor;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let mockLogger: jest.Mocked<any>;

  const mockTenantId = 'tenant-123';
  const mockRoomId = 'room-123';
  const mockScenarioSessionId = 'session-123';
  const mockCounselorId = 456;

  const mockScenarioSession: ScenarioSessions = {
    id: mockScenarioSessionId,
    roomId: mockRoomId,
    scenarioId: 1,
    counselorId: mockCounselorId,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date(),
    endedAt: undefined,
    score: undefined,
    metadata: undefined,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockChatMessage: MessageRequest = {
    role: 'CLIENT',
    content: 'Test message content',
    start_time: 10.5,
    end_time: 15.2,
  };

  const mockMessageData: LearnMessageAndEventMessage = {
    message_type: 'message',
    timestamp: Date.now(),
    room_id: mockRoomId,
    data: {
      chat_message: mockChatMessage,
    },
  };

  beforeEach(async () => {
    const mockScenarioSessionService = {
      getScenarioSessionByRoomId: jest.fn(),
      addScenarioSessionMessage: jest.fn(),
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
        LearnMessageProcessor,
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
      ],
    }).compile();

    processor = module.get<LearnMessageProcessor>(LearnMessageProcessor);
    scenarioSessionService = module.get(ScenarioSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEventType', () => {
    it('should return "message"', () => {
      const result = processor.getEventType();
      expect(result).toBe('message');
    });
  });

  describe('process', () => {
    it('should successfully process message data', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(mockMessageData);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(mockMessageData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Scenario session message added: ${mockScenarioSessionId}`,
      );
    });

    it('should skip processing for preview scenario rooms', async () => {
      const previewMessageData: LearnMessageAndEventMessage = {
        ...mockMessageData,
        room_id: 'preview-test-session-123',
      };

      await processor.process(previewMessageData);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(previewMessageData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).not.toHaveBeenCalled();
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle scenario session not found', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        null as any,
      );

      await processor.process(mockMessageData);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(mockMessageData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle undefined scenario session', async () => {
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        undefined as any,
      );

      await processor.process(mockMessageData);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle missing chat message data', async () => {
      const messageDataWithoutChatMessage: LearnMessageAndEventMessage = {
        message_type: 'message',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {},
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(messageDataWithoutChatMessage);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(messageDataWithoutChatMessage)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Chat message not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle null chat message data', async () => {
      const messageDataWithNullChatMessage: LearnMessageAndEventMessage = {
        message_type: 'message',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          chat_message: null as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(messageDataWithNullChatMessage);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Chat message not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle undefined chat message data', async () => {
      const messageDataWithUndefinedChatMessage: LearnMessageAndEventMessage = {
        message_type: 'message',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          chat_message: undefined as any,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(messageDataWithUndefinedChatMessage);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Chat message not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle getScenarioSessionByRoomId error', async () => {
      const error = new Error('Database connection failed');
      scenarioSessionService.getScenarioSessionByRoomId.mockRejectedValue(
        error,
      );

      await expect(processor.process(mockMessageData)).rejects.toThrow(
        'Database connection failed',
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(mockMessageData)}`,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn message: "Database connection failed"',
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).not.toHaveBeenCalled();
    });

    it('should handle addScenarioSessionMessage error', async () => {
      const error = new Error('Failed to add message');
      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockRejectedValue(error);

      await expect(processor.process(mockMessageData)).rejects.toThrow(
        'Failed to add message',
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(mockMessageData)}`,
      );
      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn message: "Failed to add message"',
      );
    });

    it('should handle error without message property', async () => {
      const errorWithoutMessage = {
        code: 'ERROR_CODE',
        details: 'Some details',
      };
      scenarioSessionService.getScenarioSessionByRoomId.mockRejectedValue(
        errorWithoutMessage,
      );

      await expect(processor.process(mockMessageData)).rejects.toBe(
        errorWithoutMessage,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to process learn message: undefined',
      );
    });

    it('should handle different room IDs', async () => {
      const differentRoomId = 'room-456';
      const messageDataWithDifferentRoom: LearnMessageAndEventMessage = {
        ...mockMessageData,
        room_id: differentRoomId,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        null as any,
      );

      await processor.process(messageDataWithDifferentRoom);

      expect(
        scenarioSessionService.getScenarioSessionByRoomId,
      ).toHaveBeenCalledWith(differentRoomId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${differentRoomId}`,
      );
    });

    it('should handle COUNSELOR role message', async () => {
      const counselorMessage: MessageRequest = {
        role: 'COUNSELOR',
        content: 'Counselor response',
        start_time: 20.1,
        end_time: 25.8,
      };

      const messageDataWithCounselorMessage: LearnMessageAndEventMessage = {
        ...mockMessageData,
        data: {
          chat_message: counselorMessage,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(messageDataWithCounselorMessage);

      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        counselorMessage,
        mockTenantId,
      );
    });

    it('should handle message without timing information', async () => {
      const messageWithoutTiming: MessageRequest = {
        role: 'CLIENT',
        content: 'Message without timing',
      };

      const messageDataWithoutTiming: LearnMessageAndEventMessage = {
        ...mockMessageData,
        data: {
          chat_message: messageWithoutTiming,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(messageDataWithoutTiming);

      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        messageWithoutTiming,
        mockTenantId,
      );
    });

    it('should handle complex message data', async () => {
      const complexChatMessage: MessageRequest = {
        role: 'CLIENT',
        content: 'Complex message with special characters: @#$%^&*()',
        start_time: 30.5,
        end_time: 35.2,
      };

      const complexMessageData: LearnMessageAndEventMessage = {
        message_type: 'message',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {
          chat_message: complexChatMessage,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(complexMessageData);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Processing learn message: ${JSON.stringify(complexMessageData)}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        complexChatMessage,
        mockTenantId,
      );
    });

    it('should handle scenario session with different tenant ID', async () => {
      const differentTenantId = 'tenant-456';
      const sessionWithDifferentTenant = {
        ...mockScenarioSession,
        tenantId: differentTenantId,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        sessionWithDifferentTenant,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(mockMessageData);

      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        differentTenantId,
      );
    });

    it('should handle scenario session with different counselor ID', async () => {
      const differentCounselorId = 789;
      const sessionWithDifferentCounselor = {
        ...mockScenarioSession,
        counselorId: differentCounselorId,
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        sessionWithDifferentCounselor,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(mockMessageData);

      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        differentCounselorId,
        mockChatMessage,
        mockTenantId,
      );
    });

    it('should handle empty message content', async () => {
      const emptyContentMessage: MessageRequest = {
        role: 'CLIENT',
        content: '',
        start_time: 10.0,
        end_time: 15.0,
      };

      const messageDataWithEmptyContent: LearnMessageAndEventMessage = {
        ...mockMessageData,
        data: {
          chat_message: emptyContentMessage,
        },
      };

      scenarioSessionService.getScenarioSessionByRoomId.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionService.addScenarioSessionMessage.mockResolvedValue(
        {} as any,
      );

      await processor.process(messageDataWithEmptyContent);

      expect(
        scenarioSessionService.addScenarioSessionMessage,
      ).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        emptyContentMessage,
        mockTenantId,
      );
    });
  });
});
