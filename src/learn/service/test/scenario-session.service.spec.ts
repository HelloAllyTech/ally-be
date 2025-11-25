import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { AddFeedbackToScenarioSessionRequestDto } from 'src/learn/dto/add-feedback-to-scenario-session.dto';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { ScenarioSessionDetails } from 'src/learn/entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from 'src/learn/entity/scenario-session-events.entity';
import { ScenarioSessionFeedbacks } from 'src/learn/entity/scenario-session-feedbacks.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from 'src/learn/enum/scenario-session-status.enum';
import { ScenarioStatus } from 'src/learn/enum/scenario.status.enum';
import { ScenarioSessionMessagesRepository } from 'src/learn/repository/scenario-session-messages.repository';
import { ScenarioSessionRepository } from 'src/learn/repository/scenario-session.repository';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioTenantService } from '../scenario-tenant.service';
import { ScenarioService } from '../scenario.service';
import { SimulationCreditsService } from '../simulation-credits.service';
import { ScenarioPathService } from 'src/scenario-path/service/scenario-path.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(() => 'test-tenant-id'),
    getUserId: jest.fn(() => 'test-user-id'),
    getExecutionId: jest.fn(() => 'test-execution-id'),
  },
}));

describe('ScenarioSessionService', () => {
  let service: ScenarioSessionService;
  let scenarioSessionRepository: jest.Mocked<ScenarioSessionRepository>;
  let scenarioSessionMessagesRepository: jest.Mocked<ScenarioSessionMessagesRepository>;
  let scenarioService: jest.Mocked<ScenarioService>;
  let livekitService: jest.Mocked<LiveKitService>;
  let sessionEventService: jest.Mocked<SessionEventService>;
  let aiService: jest.Mocked<AiService>;
  let scenarioSessionFeedbacksRepository: jest.Mocked<
    Repository<ScenarioSessionFeedbacks>
  >;
  let dataSource: jest.Mocked<DataSource>;

  let permissionValidatorService: jest.Mocked<PermissionValidator>;
  let simulationCreditsService: jest.Mocked<SimulationCreditsService>;
  let scenarioTenantService: jest.Mocked<ScenarioTenantService>;
  let mockConfigService: any;

  const mockTenantId = 'tenant-123';
  const mockUserId = 456;
  const mockCounselorId = 123;
  const mockScenarioSessionId = 'session-123';
  const mockRoomId = 'room-123';
  const mockScenarioId = 1;

  const mockScenarioSession: ScenarioSessions = {
    id: mockScenarioSessionId,
    roomId: mockRoomId,
    scenarioId: mockScenarioId,
    counselorId: mockCounselorId,
    status: ScenarioSessionStatus.ACTIVE,
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: undefined,
    score: undefined,
    metadata: undefined,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioSessions;

  const mockScenario = {
    id: mockScenarioId,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test scenario description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor',
    metadata: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSessionEvents: SessionEvents[] = [
    {
      id: 'event-1',
      name: 'Event 1',
      description: 'First event',
      score: 10,
      emoji: '🎯',
      message: 'Event 1 message',
      branchInstruction: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SessionEvents,
    {
      id: 'event-2',
      name: 'Event 2',
      description: 'Second event',
      score: 15,
      emoji: '🚀',
      message: 'Event 2 message',
      branchInstruction: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SessionEvents,
  ];

  const mockPagination = { limit: 10, offset: 0 };

  beforeEach(async () => {
    const mockScenarioSessionRepo = {
      getScenarioSessions: jest.fn(),
      getAdminScenarioSessions: jest.fn(),
      getScenarioSession: jest.fn(),
      createScenarioSession: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      getScenarioSessionScore: jest.fn(),
    };

    const mockScenarioSessionMessagesRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockScenarioService = {
      getScenario: jest.fn(),
      getScenarioVoice: jest.fn(),
    };

    const mockLivekitService = {
      createRoom: jest.fn(),
      deleteRoom: jest.fn(),
      generateAccessToken: jest.fn(),
      getRoom: jest.fn(),
    };

    const mockSessionEventService = {
      getSessionEventsByScenarioId: jest.fn(),
      findByIds: jest.fn(),
    };

    const mockAiService = {
      getScenarioSessionSummary: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
    };

    const mockFeedbackRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockSessionEventsRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockEventsRepo = {
      save: jest.fn(),
      delete: jest.fn(),
    };

    const mockScenarioSessionDetailsRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const mockPermissionValidatorService = {
      validatePermissions: jest.fn(),
    };

    const mockSimulationCreditsService = {
      getSimulationCredits: jest.fn(),
      consumeCredits: jest.fn(),
    };

    const mockScenarioTenantService = {
      getScenarioTenant: jest.fn(),
    };

    const mockScenarioPathService = {
      getScenarioPathById: jest.fn(),
    };

    const mockScenarioPathSessionService = {
      handleEndScenarioPathSession: jest.fn(),
    };

    mockConfigService = {
      simulationCredits: {
        lifespanSecondsPerCredit: 60,
      },
    };

    // Setup ExecutionManager mocks
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
    (ExecutionManager.getExecutionId as jest.Mock).mockReturnValue('exec-123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionService,
        {
          provide: ScenarioSessionRepository,
          useValue: mockScenarioSessionRepo,
        },
        {
          provide: ScenarioSessionMessagesRepository,
          useValue: mockScenarioSessionMessagesRepo,
        },
        {
          provide: ScenarioService,
          useValue: mockScenarioService,
        },
        {
          provide: LiveKitService,
          useValue: mockLivekitService,
        },
        {
          provide: SessionEventService,
          useValue: mockSessionEventService,
        },
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: getRepositoryToken(ScenarioSessionFeedbacks),
          useValue: mockFeedbackRepo,
        },
        {
          provide: getRepositoryToken(ScenarioSessionEvents),
          useValue: mockSessionEventsRepo,
        },
        {
          provide: getRepositoryToken(ScenarioEvents),
          useValue: mockEventsRepo,
        },
        {
          provide: getRepositoryToken(ScenarioSessionDetails),
          useValue: mockScenarioSessionDetailsRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidatorService,
        },
        {
          provide: SimulationCreditsService,
          useValue: mockSimulationCreditsService,
        },
        {
          provide: ScenarioTenantService,
          useValue: mockScenarioTenantService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ScenarioPathService,
          useValue: mockScenarioPathService,
        },
        {
          provide: ScenarioPathSessionService,
          useValue: mockScenarioPathSessionService,
        },
      ],
    }).compile();

    service = module.get<ScenarioSessionService>(ScenarioSessionService);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioSessionMessagesRepository = module.get(
      ScenarioSessionMessagesRepository,
    );
    scenarioService = module.get(ScenarioService);
    livekitService = module.get(LiveKitService);
    sessionEventService = module.get(SessionEventService);
    aiService = module.get(AiService);
    scenarioSessionFeedbacksRepository = module.get(
      getRepositoryToken(ScenarioSessionFeedbacks),
    );
    dataSource = module.get(DataSource);
    permissionValidatorService = module.get(PermissionValidator);
    simulationCreditsService = module.get(SimulationCreditsService);
    scenarioTenantService = module.get(ScenarioTenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect(scenarioSessionRepository).toBeDefined();
      expect(scenarioSessionMessagesRepository).toBeDefined();
      expect(scenarioService).toBeDefined();
      expect(livekitService).toBeDefined();
      expect(sessionEventService).toBeDefined();
      expect(aiService).toBeDefined();
      expect(scenarioSessionFeedbacksRepository).toBeDefined();
      expect(dataSource).toBeDefined();
      expect(permissionValidatorService).toBeDefined();
      expect(simulationCreditsService).toBeDefined();
      expect(scenarioTenantService).toBeDefined();
    });
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions with default status', async () => {
      const mockSessions = [mockScenarioSession];
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
      );

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(
        mockCounselorId,
        mockPagination,
        ScenarioSessionStatus.ENDED,
      );
    });

    it('should return scenario sessions with custom status', async () => {
      const mockSessions = [mockScenarioSession];
      const customStatus = ScenarioSessionStatus.ACTIVE;
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        customStatus,
      );

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(mockCounselorId, mockPagination, customStatus);
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions', async () => {
      const mockSessions = [mockScenarioSession];
      scenarioSessionRepository.getAdminScenarioSessions.mockResolvedValue(
        mockSessions,
      );

      const result = await service.getAdminScenarioSessions(mockPagination);

      expect(result).toEqual({ data: mockSessions });
      expect(
        scenarioSessionRepository.getAdminScenarioSessions,
      ).toHaveBeenCalledWith(mockPagination, ScenarioSessionStatus.ENDED);
    });
  });

  describe('getScenarioSession', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(null);

      await expect(
        service.getScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));

      expect(
        permissionValidatorService.validatePermissions,
      ).toHaveBeenCalledWith(mockCounselorId, [
        PERMISSIONS.ORGANIZATION_ACCESS,
      ]);
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        false,
      );
    });

    it('should return scenario session with feedback for admin user', async () => {
      const mockFeedback = { id: 'feedback-1', rating: 5 };
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(
        mockFeedback as any,
      );

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({ ...mockScenarioSession, hasFeedback: true });
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        true,
      );
    });

    it('should filter out PASSIVE events and return only ACTIVE events', async () => {
      const mockSessionWithMixedEvents = {
        ...mockScenarioSession,
        events: [
          {
            id: 'session-event-1',
            events: {
              id: 'event-1',
              visibilityType: 'ACTIVE',
              name: 'Active Event 1',
            },
          },
          {
            id: 'session-event-2',
            events: {
              id: 'event-2',
              visibilityType: 'PASSIVE',
              name: 'Passive Event',
            },
          },
          {
            id: 'session-event-3',
            events: {
              id: 'event-3',
              visibilityType: 'ACTIVE',
              name: 'Active Event 2',
            },
          },
        ],
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithMixedEvents as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect((result as any).events).toHaveLength(2);
      expect((result as any).events[0].events.visibilityType).toBe('ACTIVE');
      expect((result as any).events[1].events.visibilityType).toBe('ACTIVE');
      expect(result.hasFeedback).toBe(false);
    });
  });

  describe('endScenarioSession', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.endScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should throw BadRequestException when scenario session is not active', async () => {
      const inactiveSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(inactiveSession);

      await expect(
        service.endScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(
        new BadRequestException('Scenario session is not active'),
      );
    });

    it('should successfully end scenario session', async () => {
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(livekitService.deleteRoom).toHaveBeenCalledWith(mockRoomId);
    });

    it('should consume correct credits when remaining seconds >= 30', async () => {
      const mockScore = 85.5;
      const startTime = new Date('2024-01-01T10:00:00Z');
      const endTime = new Date('2024-01-01T10:02:45Z'); // 165 seconds
      const sessionWithDuration = {
        ...mockScenarioSession,
        startedAt: startTime,
        endedAt: endTime,
      };

      const originalDate = global.Date;
      const mockDate = jest.fn(() => endTime);
      (global as any).Date = mockDate;

      scenarioSessionRepository.findOne.mockResolvedValue(sessionWithDuration);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      // 165 seconds: 2 full credits + 1 additional (45 >= 30) = 3 credits
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        3,
      );

      global.Date = originalDate;
    });
  });

  describe('addFeedbackToScenarioSession', () => {
    const mockFeedbackDto: AddFeedbackToScenarioSessionRequestDto = {
      rating: 5,
      feedback: 'Great session',
    };

    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should successfully add feedback to scenario session', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      const mockCreatedFeedback = { id: 'feedback-1', ...mockFeedbackDto };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);
      scenarioSessionFeedbacksRepository.create.mockReturnValue(
        mockCreatedFeedback as any,
      );
      scenarioSessionFeedbacksRepository.save.mockResolvedValue(
        mockCreatedFeedback as any,
      );

      const result = await service.addFeedbackToScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        mockFeedbackDto,
      );

      expect(result).toEqual(mockCreatedFeedback);
      expect(scenarioSessionFeedbacksRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        rating: mockFeedbackDto.rating,
        feedback: mockFeedbackDto.feedback,
        tenantId: mockTenantId,
      });
    });
  });

  describe('previewScenario', () => {
    it('should create preview scenario session successfully', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        status: ScenarioStatus.DRAFT,
        metadata: {
          agentGoal: 'Help the client',
          lifeHistory: 'Life history',
          voiceId: 'voice-123',
          name: 'Test Client',
          age: 25,
          gender: 'female',
          currentLocation: 'New York',
          context: 'Context',
          openingStatements: 'Opening',
        },
        isGlobal: false,
      };

      const mockVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
      };

      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: 'preview-room',
        serverUrl: 'https://livekit.example.com',
      };

      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice as any);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.previewScenario(
        previewDto as any,
        mockUserId,
      );

      expect(result.roomName).toMatch(/^preview-\d+-/);
      expect(result.accessToken).toEqual(mockTokenResponse);
    });

    it('should throw BadRequestException for scenario with invalid status', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockInvalidScenario = {
        ...mockScenario,
        status: ScenarioStatus.ARCHIVED,
        isGlobal: false,
      };

      scenarioService.getScenario.mockResolvedValue(mockInvalidScenario);

      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(
        new BadRequestException(
          'Scenario should be draft or active for preview',
        ),
      );
    });
  });

  describe('endPreviewScenario', () => {
    it('should delete preview scenario room successfully', async () => {
      const roomName = 'preview-test-session-123';
      livekitService.deleteRoom.mockResolvedValue(undefined);

      await service.endPreviewScenario(roomName);

      expect(livekitService.deleteRoom).toHaveBeenCalledWith(roomName);
    });
  });

  describe('getLatestScenarioSessionByScenarioPathSessionItemId', () => {
    it('should return a scenario session when found', async () => {
      const scenarioPathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      const mockSessionWithPathItemId = {
        ...mockScenarioSession,
        scenarioPathSessionItemId,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(
        mockSessionWithPathItemId,
      );

      const result =
        await service.getLatestScenarioSessionByScenarioPathSessionItemId(
          scenarioPathSessionItemId,
        );

      expect(result).toEqual(mockSessionWithPathItemId);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathSessionItemId },
        order: { createdAt: 'DESC' },
      });
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return null when scenario session is not found', async () => {
      const scenarioPathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      const result =
        await service.getLatestScenarioSessionByScenarioPathSessionItemId(
          scenarioPathSessionItemId,
        );

      expect(result).toBeNull();
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathSessionItemId },
        order: { createdAt: 'DESC' },
      });
    });

    it('should handle errors from repository', async () => {
      const scenarioPathSessionItemId = '550e8400-e29b-41d4-a716-446655440000';
      const error = new Error('Database error');
      scenarioSessionRepository.findOne.mockRejectedValue(error);

      await expect(
        service.getLatestScenarioSessionByScenarioPathSessionItemId(
          scenarioPathSessionItemId,
        ),
      ).rejects.toThrow('Database error');
    });
  });
});
