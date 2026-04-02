import { Test, TestingModule } from '@nestjs/testing';
import { BehaviorInstructionProcessor } from '../behavior-instruction.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { ScenarioBehaviorInstructionService } from '../../service/scenario-behavior-instruction.service';
import { LoggerService } from 'src/logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioBehaviorInstruction } from '../../entity/scenario-behavior-instruction.entity';

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

describe('BehaviorInstructionProcessor', () => {
  let processor: BehaviorInstructionProcessor;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;
  let scenarioBehaviorInstructionService: jest.Mocked<ScenarioBehaviorInstructionService>;
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

  const mockScenarioBehaviorInstruction = {
    id: 'bi-123',
    scenarioId: 1,
    category: 'SHOULD_DO',
  } as unknown as ScenarioBehaviorInstruction;

  const mockBehaviorInstructionData: LearnMessageAndEventMessage = {
    message_type: 'behavior_instruction',
    timestamp: 1771393604,
    room_id: mockRoomId,
    data: {
      behavior_instruction: {
        timestamp: new Date('2026-02-18T05:46:44.822493Z'),
        behavior_instruction_data: {
          behaviorInstructionId: 'bi-123',
        },
      },
    },
  };

  beforeEach(async () => {
    const mockScenarioSessionService = {
      getScenarioSessionByRoomIdOrNull: jest.fn(),
      addScenarioSessionBehaviorInstruction: jest.fn(),
    };

    const mockScenarioBehaviorInstructionService = {
      getScenarioBehaviorInstructionById: jest.fn(),
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
        BehaviorInstructionProcessor,
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
        {
          provide: ScenarioBehaviorInstructionService,
          useValue: mockScenarioBehaviorInstructionService,
        },
      ],
    }).compile();

    processor = module.get<BehaviorInstructionProcessor>(
      BehaviorInstructionProcessor,
    );
    scenarioSessionService = module.get(ScenarioSessionService);
    scenarioBehaviorInstructionService = module.get(
      ScenarioBehaviorInstructionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEventType', () => {
    it('should return "behavior_instruction"', () => {
      expect(processor.getEventType()).toBe('behavior_instruction');
    });
  });

  describe('process', () => {
    it('should successfully process behavior instruction data', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById.mockResolvedValue(
        mockScenarioBehaviorInstruction,
      );
      scenarioSessionService.addScenarioSessionBehaviorInstruction.mockResolvedValue(
        undefined,
      );

      await processor.process(mockBehaviorInstructionData);

      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).toHaveBeenCalledWith(mockRoomId);
      expect(
        scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById,
      ).toHaveBeenCalledWith('bi-123');
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).toHaveBeenCalledWith(
        mockScenarioSession,
        mockBehaviorInstructionData.data.behavior_instruction,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Scenario session behavior instruction added: ${mockScenarioSessionId}`,
      );
    });

    it('should skip processing for preview rooms', async () => {
      const previewData: LearnMessageAndEventMessage = {
        ...mockBehaviorInstructionData,
        room_id: 'preview-test-session-123',
      };

      await processor.process(previewData);

      expect(
        scenarioSessionService.getScenarioSessionByRoomIdOrNull,
      ).not.toHaveBeenCalled();
      expect(
        scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById,
      ).not.toHaveBeenCalled();
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).not.toHaveBeenCalled();
    });

    it('should handle scenario session not found', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        null as any,
      );

      await processor.process(mockBehaviorInstructionData);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario session not found: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).not.toHaveBeenCalled();
    });

    it('should handle missing behavior instruction data', async () => {
      const dataWithoutInstruction: LearnMessageAndEventMessage = {
        message_type: 'behavior_instruction',
        timestamp: Date.now(),
        room_id: mockRoomId,
        data: {},
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );

      await processor.process(dataWithoutInstruction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Behavior instruction data is missing: ${mockRoomId}`,
      );
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).not.toHaveBeenCalled();
    });

    it('should skip when scenario behavior instruction not found', async () => {
      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById.mockResolvedValue(
        null,
      );

      await processor.process(mockBehaviorInstructionData);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Scenario behavior instruction not found: bi-123`,
      );
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).not.toHaveBeenCalled();
    });

    it('should process with different behavior instruction id', async () => {
      const otherInstructionData: LearnMessageAndEventMessage = {
        ...mockBehaviorInstructionData,
        data: {
          behavior_instruction: {
            timestamp: new Date(),
            behavior_instruction_data: {
              behaviorInstructionId: 'bi-456',
            },
          },
        },
      };

      const otherInstruction = {
        ...mockScenarioBehaviorInstruction,
        id: 'bi-456',
      };

      scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById.mockResolvedValue(
        otherInstruction as ScenarioBehaviorInstruction,
      );
      scenarioSessionService.addScenarioSessionBehaviorInstruction.mockResolvedValue(
        undefined,
      );

      await processor.process(otherInstructionData);

      expect(
        scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById,
      ).toHaveBeenCalledWith('bi-456');
      expect(
        scenarioSessionService.addScenarioSessionBehaviorInstruction,
      ).toHaveBeenCalledWith(
        mockScenarioSession,
        otherInstructionData.data.behavior_instruction,
      );
    });
  });
});
