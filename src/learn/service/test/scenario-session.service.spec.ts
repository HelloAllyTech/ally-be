import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioSessionRepository } from '../../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../../repository/scenario-session-messages.repository';
import { ScenarioService } from '../scenario.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { AiService } from 'src/ai/service/ai.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ScenarioSessionFeedbacks } from '../../entity/scenario-session-feedbacks.entity';
import { ScenarioSessionEvents } from '../../entity/scenario-session-events.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../entity/scenario-session-messages.entity';
import { ScenarioSessionDetails } from '../../entity/scenario-session-details.entity';
import { ScenarioSessionStatus } from '../../enum/scenario-session-status.enum';
import { ScenarioSessionMessageType } from '../../enum/scenario-session-message.type.enum';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { EntityOperationException } from 'src/exception/custom.exception';
import { StartScenarioSessionRequestDto } from '../../dto/start-scenario-session-request.dto';
import { AddFeedbackToScenarioSessionRequestDto } from '../../dto/add-feedback-to-scenario-session.dto';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { LearnEventData } from '../../interface/learn-message.interface';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SimulationCreditsService } from '../simulation-credits.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { SessionEventSpeaker } from 'src/session-event/enum/session-event-speaker.enum';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';

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
  let mockEntityManager: any;
  let permissionValidatorService: jest.Mocked<PermissionValidator>;
  let simulationCreditsService: jest.Mocked<SimulationCreditsService>;
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

    mockEntityManager = {
      getRepository: jest.fn(),
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

    mockConfigService = {
      simulationCredits: {
        lifespanSecondsPerCredit: 60,
      },
    };

    const mockLoggerService = {
      getInstance: jest.fn().mockReturnValue({
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
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
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: LoggerService,
          useValue: mockLoggerService,
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
  });

  afterEach(() => {
    jest.clearAllMocks();
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

    it('should return scenario session without feedback for regular user', async () => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({ ...mockScenarioSession, hasFeedback: false });
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        false,
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

    it('should return empty events array when all events are PASSIVE', async () => {
      const mockSessionWithPassiveEvents = {
        ...mockScenarioSession,
        events: [
          {
            id: 'session-event-1',
            events: {
              id: 'event-1',
              visibilityType: 'PASSIVE',
              name: 'Passive Event 1',
            },
          },
          {
            id: 'session-event-2',
            events: {
              id: 'event-2',
              visibilityType: 'PASSIVE',
              name: 'Passive Event 2',
            },
          },
        ],
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithPassiveEvents as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect((result as any).events).toEqual([]);
      expect(result.hasFeedback).toBe(false);
    });

    it('should handle scenario session with no events', async () => {
      const mockSessionWithNoEvents = {
        ...mockScenarioSession,
        events: [],
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithNoEvents as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect((result as any).events).toEqual([]);
      expect(result.hasFeedback).toBe(false);
    });

    it('should handle scenario session without events property', async () => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      // Should not throw error and should return session normally
      expect(result).toEqual({ ...mockScenarioSession, hasFeedback: false });
    });
  });

  describe('startScenarioSession', () => {
    const mockStartDto: StartScenarioSessionRequestDto = {
      scenarioId: mockScenarioId,
    };

    it('should throw EntityOperationException when active session exists', async () => {
      const activeSessions = { data: [mockScenarioSession] };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        activeSessions.data,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(EntityOperationException);

      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(
        mockCounselorId,
        { limit: 1, offset: 0 },
        ScenarioSessionStatus.ACTIVE,
      );
    });

    it('should throw BadRequestException when scenario has no lifeHistory', async () => {
      const mockScenarioWithoutLifeHistory = {
        ...mockScenario,
        metadata: {
          difficulty: 'beginner',
          tags: ['test'],
        },
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioWithoutLifeHistory,
      );
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Scenario details are not complete. Please contact admin.',
        ),
      );
    });

    it('should throw BadRequestException when scenario metadata is null', async () => {
      const mockScenarioWithNullMetadata = {
        ...mockScenario,
        metadata: null,
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioWithNullMetadata as any,
      );
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Scenario details are not complete. Please contact admin.',
        ),
      );
    });

    it('should successfully start scenario session with default ttl', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'intermediate',
          tags: ['anxiety'],
          lifeHistory: { age: 25, background: 'test' },
          voiceId: 'voice-123',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });
      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toEqual({
        scenarioSession: mockScenarioSession,
        accessToken: mockTokenResponse,
      });
      expect(livekitService.createRoom).toHaveBeenCalledWith({
        name: mockRoomId,
        ttl: 1200,
        metadata: {
          version: '1.0',
          tenantId: mockTenantId,
          scenario: {
            id: mockScenarioWithMetadata.id,
            title: mockScenarioWithMetadata.title,
            scenario: mockScenarioWithMetadata.scenario,
            description: mockScenarioWithMetadata.description,
            coverImageUrl: mockScenarioWithMetadata.coverImageUrl,
            status: mockScenarioWithMetadata.status,
            prompt: mockScenarioWithMetadata.prompt,
            promptData: {
              difficulty: 'intermediate',
              tags: ['anxiety'],
              lifeHistory: { age: 25, background: 'test' },
            },
            createdAt: mockScenarioWithMetadata.createdAt,
            updatedAt: mockScenarioWithMetadata.updatedAt,
            voice: mockVoice,
            events: mockSessionEvents,
          },
        },
      });
    });

    it('should successfully start scenario session with custom ttl', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      const customTtl = 3600;
      const mockStartDtoWithTtl = { ...mockStartDto, ttl: customTtl };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'beginner',
          lifeHistory: { age: 30, background: 'test background' },
          voiceId: 'voice-456',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockVoice = {
        id: 'voice-456',
        name: 'Another Voice',
        voiceId: 'openai-voice-id-2',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });
      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDtoWithTtl,
      );

      expect(result).toEqual({
        scenarioSession: mockScenarioSession,
        accessToken: mockTokenResponse,
      });
      expect(livekitService.createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockRoomId,
          ttl: customTtl,
        }),
      );
    });

    it('should throw BadRequestException when user has insufficient credits', async () => {
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 10,
        consumedCredits: 95, // Almost at limit
        secondsAllowedPerCredit: 60,
      });

      await expect(
        service.startScenarioSession(mockCounselorId, mockStartDto),
      ).rejects.toThrow(
        new BadRequestException(
          'You have insufficient credits to start a new scenario session',
        ),
      );

      expect(
        simulationCreditsService.getSimulationCredits,
      ).toHaveBeenCalledWith(mockCounselorId);
    });

    it('should use default 60 when lifespanSecondsPerCredit is undefined', async () => {
      // Temporarily set config to return undefined
      const originalValue =
        mockConfigService.simulationCredits.lifespanSecondsPerCredit;
      mockConfigService.simulationCredits.lifespanSecondsPerCredit = undefined;

      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });

      // With undefined lifespanSecondsPerCredit, it should use default 60
      // 50 + (1200 / 60) = 50 + 20 = 70 < 100, so should not throw
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'intermediate',
          tags: ['anxiety'],
          lifeHistory: { age: 25, background: 'test' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };

      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toBeDefined();
      expect(result.scenarioSession).toEqual(mockScenarioSession);

      // Restore original value
      mockConfigService.simulationCredits.lifespanSecondsPerCredit =
        originalValue;
    });

    it('should successfully start scenario session when user has sufficient credits', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          difficulty: 'intermediate',
          tags: ['anxiety'],
          lifeHistory: { age: 25, background: 'test' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        creditLimit: 100,
        consumedCredits: 50,
        secondsAllowedPerCredit: 60,
      });
      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockScenarioSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        mockStartDto,
      );

      expect(result).toEqual({
        scenarioSession: mockScenarioSession,
        accessToken: mockTokenResponse,
      });
      expect(
        simulationCreditsService.getSimulationCredits,
      ).toHaveBeenCalledWith(mockCounselorId);
    });
  });

  describe('endScenarioSession', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
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
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.findOne.mockResolvedValue(inactiveSession);

      await expect(
        service.endScenarioSession(mockScenarioSessionId, mockCounselorId),
      ).rejects.toThrow(
        new BadRequestException('Scenario session is not active'),
      );
    });

    it('should successfully end scenario session with room deletion error', async () => {
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockRejectedValue(
        new Error('Room deletion failed'),
      );
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          status: ScenarioSessionStatus.ENDED,
          score: mockScore,
        }),
      );
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        expect.any(Number),
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
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        expect.any(Number),
      );
    });

    it('should successfully end scenario session with call duration calculation', async () => {
      const mockScore = 85.5;
      const sessionWithEndDate = {
        ...mockScenarioSession,
        endedAt: new Date('2024-01-01T11:00:00Z'), // 1 hour after start
      };
      scenarioSessionRepository.findOne.mockResolvedValue(sessionWithEndDate);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          status: ScenarioSessionStatus.ENDED,
          score: mockScore,
        }),
      );
    });

    it('should handle zero call duration fallback', async () => {
      const mockScore = 85.5;
      const sessionWithStartTime = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:00:00Z'),
      };
      scenarioSessionRepository.findOne.mockResolvedValue(sessionWithStartTime);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      // Mock Date constructor to return a date that when subtracted gives 0
      const originalDate = global.Date;
      const mockDate = jest.fn(() => ({
        getTime: () => sessionWithStartTime.startedAt!.getTime(), // Same time as startedAt
      }));
      (global as any).Date = mockDate;

      const result = await service.endScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
      );

      expect(result).toEqual({
        message: 'Scenario session ended successfully',
      });
      // With 0 duration, consumeSimulationCredits should return early and not call consumeCredits
      expect(simulationCreditsService.consumeCredits).not.toHaveBeenCalled();

      // Restore original Date
      global.Date = originalDate;
    });

    it('should consume correct number of credits based on call duration', async () => {
      const mockScore = 85.5;
      const startTime = new Date('2024-01-01T10:00:00Z');
      const endTime = new Date('2024-01-01T10:05:00Z'); // 5 minutes = 300 seconds
      const sessionWithDuration = {
        ...mockScenarioSession,
        startedAt: startTime,
        endedAt: endTime,
      };

      // Mock Date constructor to return the end time when new Date() is called
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
      // 300 seconds: 5 full credits (300/60=5) + 0 remaining seconds (< 30) = 5 credits
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        5,
      );

      // Restore original Date
      global.Date = originalDate;
    });

    it('should consume correct credits when remaining seconds < 30 (no additional credit)', async () => {
      const mockScore = 85.5;
      const startTime = new Date('2024-01-01T10:00:00Z');
      // 2 minutes 15 seconds = 135 seconds
      // 135 / 60 = 2 full credits, 15 remaining seconds
      // Since 15 < 30, no additional credit
      const endTime = new Date('2024-01-01T10:02:15Z');
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
      // 135 seconds: 2 full credits (135/60=2.25) + 0 additional (15 < 30) = 2 credits
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        2,
      );

      global.Date = originalDate;
    });

    it('should consume correct credits when remaining seconds >= 30 (with additional credit)', async () => {
      const mockScore = 85.5;
      const startTime = new Date('2024-01-01T10:00:00Z');
      // 2 minutes 45 seconds = 165 seconds
      // 165 / 60 = 2 full credits, 45 remaining seconds
      // Since 45 >= 30, add 1 additional credit
      const endTime = new Date('2024-01-01T10:02:45Z');
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
      // 165 seconds: 2 full credits (165/60=2.75) + 1 additional (45 >= 30) = 3 credits
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        3,
      );

      global.Date = originalDate;
    });

    it('should use default 60 when lifespanSecondsPerCredit is undefined in consumeCredits', async () => {
      // Temporarily set config to return undefined
      const originalValue =
        mockConfigService.simulationCredits.lifespanSecondsPerCredit;
      mockConfigService.simulationCredits.lifespanSecondsPerCredit = undefined;

      const mockScore = 85.5;
      const startTime = new Date('2024-01-01T10:00:00Z');
      const endTime = new Date('2024-01-01T10:02:00Z'); // 2 minutes = 120 seconds
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
      // With undefined, should use default 60
      // 120 seconds / 60 = 2 credits
      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        2,
      );

      global.Date = originalDate;
      // Restore original value
      mockConfigService.simulationCredits.lifespanSecondsPerCredit =
        originalValue;
    });
  });

  describe('generateScenarioSessionToken', () => {
    it('should generate access token', async () => {
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: mockRoomId,
        serverUrl: 'https://livekit.example.com',
      };
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.generateScenarioSessionToken(
        mockRoomId,
        mockCounselorId,
      );

      expect(result).toEqual(mockTokenResponse);
      expect(livekitService.generateAccessToken).toHaveBeenCalledWith({
        roomName: mockRoomId,
        participantName: mockCounselorId.toString(),
      });
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

    it('should throw BadRequestException when scenario session is not ended', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException('Scenario session is not ended'),
      );
    });

    it('should throw BadRequestException when counselor is not authorized', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
        counselorId: 999,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'You are not authorized to add feedback to this scenario session',
        ),
      );
    });

    it('should throw BadRequestException when feedback already exists', async () => {
      const endedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      const existingFeedback = { id: 'feedback-1' };
      scenarioSessionRepository.findOne.mockResolvedValue(endedSession);
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(
        existingFeedback as any,
      );

      await expect(
        service.addFeedbackToScenarioSession(
          mockScenarioSessionId,
          mockCounselorId,
          mockFeedbackDto,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Feedback already exists for this scenario session',
        ),
      );
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

  describe('getScenarioSessionByRoomId', () => {
    it('should throw BadRequestException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getScenarioSessionByRoomId(mockRoomId),
      ).rejects.toThrow(new BadRequestException('Scenario session not found'));
    });

    it('should return scenario session by room ID', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      const result = await service.getScenarioSessionByRoomId(mockRoomId);

      expect(result).toEqual(mockScenarioSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { roomId: mockRoomId },
      });
    });
  });

  describe('addScenarioSessionMessage', () => {
    it('should add scenario session message for CLIENT role', async () => {
      const mockChatMessage: MessageRequest = {
        role: 'CLIENT',
        content: 'Test message',
        start_time: 10.5,
        end_time: 15.2,
      };
      const mockCreatedMessage = { id: 1, content: 'Test message' };

      scenarioSessionMessagesRepository.create.mockReturnValue(
        mockCreatedMessage as any,
      );
      scenarioSessionMessagesRepository.save.mockResolvedValue(
        mockCreatedMessage as any,
      );

      const result = await service.addScenarioSessionMessage(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );

      expect(result).toEqual(mockCreatedMessage);
      expect(scenarioSessionMessagesRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        senderId: -1,
        content: mockChatMessage.content,
        messageType: ScenarioSessionMessageType.TEXT,
        startSeconds: mockChatMessage.start_time,
        endSeconds: mockChatMessage.end_time,
        tenantId: mockTenantId,
      });
    });

    it('should add scenario session message for COUNSELOR role', async () => {
      const mockChatMessage: MessageRequest = {
        role: 'COUNSELOR',
        content: 'Test response',
        start_time: 20.1,
        end_time: 25.8,
      };
      const mockCreatedMessage = { id: 2, content: 'Test response' };

      scenarioSessionMessagesRepository.create.mockReturnValue(
        mockCreatedMessage as any,
      );
      scenarioSessionMessagesRepository.save.mockResolvedValue(
        mockCreatedMessage as any,
      );

      const result = await service.addScenarioSessionMessage(
        mockScenarioSessionId,
        mockCounselorId,
        mockChatMessage,
        mockTenantId,
      );

      expect(result).toEqual(mockCreatedMessage);
      expect(scenarioSessionMessagesRepository.create).toHaveBeenCalledWith({
        scenarioSessionId: mockScenarioSessionId,
        senderId: mockCounselorId,
        content: mockChatMessage.content,
        messageType: ScenarioSessionMessageType.TEXT,
        startSeconds: mockChatMessage.start_time,
        endSeconds: mockChatMessage.end_time,
        tenantId: mockTenantId,
      });
    });
  });

  describe('getMessagesByScenarioSessionId', () => {
    it('should return messages by scenario session ID', async () => {
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: mockCounselorId,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Message 1',
          metadata: undefined,
          startSeconds: 10.5,
          endSeconds: 15.2,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioSessionMessages,
        {
          id: 2,
          scenarioSessionId: mockScenarioSessionId,
          senderId: -1,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Message 2',
          metadata: undefined,
          startSeconds: 16.0,
          endSeconds: 20.5,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioSessionMessages,
      ];
      scenarioSessionMessagesRepository.getMessagesByScenarioSessionId.mockResolvedValue(
        mockMessages,
      );

      const result = await service.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(result).toEqual({ messages: mockMessages });
      expect(
        scenarioSessionMessagesRepository.getMessagesByScenarioSessionId,
      ).toHaveBeenCalledWith(mockScenarioSessionId, mockPagination);
    });
  });

  describe('addScenarioSessionEvent', () => {
    it('should add scenario session event for active session', async () => {
      const mockEvent: LearnEventData = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        event_data: {
          id: 'event-123',
          name: 'Event 1',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          message: 'Hello, world!',
          speaker: SessionEventSpeaker.CARE_GIVER,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
      const mockCreatedEvent = { id: 1, eventId: 'event-123' };
      const mockActiveSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ACTIVE,
      };

      const mockScenarioSessionEventsRepo = {
        create: jest.fn().mockReturnValue(mockCreatedEvent),
        save: jest.fn().mockResolvedValue(mockCreatedEvent),
      };

      const mockScenarioEventsRepo = {
        findOne: jest.fn().mockResolvedValue(null),
      };

      const mockSessionEventsRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'event-123', score: 10 }),
      };

      mockEntityManager.getRepository.mockImplementation((entity: any) => {
        if (entity === ScenarioSessionEvents) {
          return mockScenarioSessionEventsRepo;
        }
        if (entity === ScenarioEvents) {
          return mockScenarioEventsRepo;
        }
        if (entity === SessionEvents) {
          return mockSessionEventsRepo;
        }
        return {};
      });

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      await service.addScenarioSessionEvent(mockActiveSession, mockEvent);

      expect(mockScenarioSessionEventsRepo.create).toHaveBeenCalled();
      expect(mockScenarioSessionEventsRepo.save).toHaveBeenCalled();
    });

    it('should add scenario session event and update score for ended session', async () => {
      const mockEvent: LearnEventData = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        event_data: {
          id: 'event-123',
          name: 'Event 1',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          message: 'Hello, world!',
          speaker: SessionEventSpeaker.CARE_GIVER,
          score: 15,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
      const mockCreatedEvent = { id: 1, eventId: 'event-123' };
      const mockEndedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };

      const mockScenarioSessionEventsRepo = {
        create: jest.fn().mockReturnValue(mockCreatedEvent),
        save: jest.fn().mockResolvedValue(mockCreatedEvent),
      };

      const mockScenarioSessionRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockEntityManager.getRepository.mockImplementation((entity: any) => {
        if (entity === ScenarioSessionEvents) {
          return mockScenarioSessionEventsRepo;
        }

        if (entity === ScenarioSessions) {
          return mockScenarioSessionRepo;
        }
        return {};
      });

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      await service.addScenarioSessionEvent(mockEndedSession, mockEvent);

      expect(mockScenarioSessionEventsRepo.create).toHaveBeenCalled();
      expect(mockScenarioSessionEventsRepo.save).toHaveBeenCalled();
      expect(mockScenarioSessionRepo.update).toHaveBeenCalledWith(
        mockEndedSession.id,
        { score: expect.any(Function) },
      );

      // Verify the arrow function executes correctly
      const updateCall = mockScenarioSessionRepo.update.mock.calls[0];
      const scoreFunction = updateCall[1].score;
      expect(scoreFunction()).toBe('score + 15');
    });

    it('should handle ended session with PASSIVE event (no score update)', async () => {
      const mockEvent: LearnEventData = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        event_data: {
          id: 'event-123',
          name: 'Event 1',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.PASSIVE,
          message: 'Hello, world!',
          speaker: SessionEventSpeaker.CARE_GIVER,
          score: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
      const mockCreatedEvent = { id: 1, eventId: 'event-123' };
      const mockEndedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };

      const mockScenarioSessionEventsRepo = {
        create: jest.fn().mockReturnValue(mockCreatedEvent),
        save: jest.fn().mockResolvedValue(mockCreatedEvent),
      };

      const mockScenarioSessionRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockEntityManager.getRepository.mockImplementation((entity: any) => {
        if (entity === ScenarioSessionEvents) {
          return mockScenarioSessionEventsRepo;
        }

        if (entity === ScenarioSessions) {
          return mockScenarioSessionRepo;
        }
        return {};
      });

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      await service.addScenarioSessionEvent(mockEndedSession, mockEvent);

      expect(mockScenarioSessionEventsRepo.create).toHaveBeenCalled();
      expect(mockScenarioSessionEventsRepo.save).toHaveBeenCalled();

      // Should not update score for PASSIVE events
      expect(mockScenarioSessionRepo.update).not.toHaveBeenCalled();
    });

    it('should handle ended session with ACTIVE event but no score (updates with 0)', async () => {
      const mockEvent: LearnEventData = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        event_data: {
          id: 'event-124',
          name: 'Event 2',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          message: 'Hello, world!',
          speaker: SessionEventSpeaker.CARE_GIVER,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
      const mockCreatedEvent = { id: 2, eventId: 'event-124' };
      const mockEndedSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };

      const mockScenarioSessionEventsRepo = {
        create: jest.fn().mockReturnValue(mockCreatedEvent),
        save: jest.fn().mockResolvedValue(mockCreatedEvent),
      };

      const mockScenarioSessionRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockEntityManager.getRepository.mockImplementation((entity: any) => {
        if (entity === ScenarioSessionEvents) {
          return mockScenarioSessionEventsRepo;
        }

        if (entity === ScenarioSessions) {
          return mockScenarioSessionRepo;
        }
        return {};
      });

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      await service.addScenarioSessionEvent(mockEndedSession, mockEvent);

      expect(mockScenarioSessionEventsRepo.create).toHaveBeenCalled();
      expect(mockScenarioSessionEventsRepo.save).toHaveBeenCalled();

      // Should update score with 0 when event has no score
      expect(mockScenarioSessionRepo.update).toHaveBeenCalledWith(
        mockEndedSession.id,
        { score: expect.any(Function) },
      );

      // Verify the arrow function executes correctly with 0 when no score
      const updateCall = mockScenarioSessionRepo.update.mock.calls[0];
      const scoreFunction = updateCall[1].score;
      expect(scoreFunction()).toBe('score + 0');
    });
  });

  describe('getScenarioSessionSummaryFromAI', () => {
    it('should handle scenario with no messages', async () => {
      const mockScenarioSessionMessagesRepo = {
        find: jest.fn().mockResolvedValue([]),
      };
      mockEntityManager.getRepository.mockReturnValue(
        mockScenarioSessionMessagesRepo,
      );
      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );

      // Call the private method through endScenarioSession to test the path
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      // Add a small delay to allow the async method to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockScenarioSessionMessagesRepo.find).toHaveBeenCalledWith({
        where: {
          scenarioSessionId: mockScenarioSessionId,
          messageType: ScenarioSessionMessageType.TEXT,
          tenantId: mockTenantId,
        },
      });
    });

    it('should generate AI summary when messages exist', async () => {
      const mockMessages = [
        {
          senderId: mockCounselorId,
          content: 'Hello, how are you?',
          startSeconds: 10.5,
          endSeconds: 15.2,
        },
        {
          senderId: -1,
          content: 'I am feeling anxious',
          startSeconds: 16.0,
          endSeconds: 20.5,
        },
      ];
      const mockSummary = 'AI generated summary';
      const mockScenarioSessionMessagesRepo = {
        find: jest.fn().mockResolvedValue(mockMessages),
      };
      const mockScenarioSessionDetailsRepo = {
        create: jest.fn().mockReturnValue({ id: 'details-1' }),
        save: jest.fn().mockResolvedValue({ id: 'details-1' }),
      };

      mockEntityManager.getRepository
        .mockReturnValueOnce(mockScenarioSessionMessagesRepo)
        .mockReturnValueOnce(mockScenarioSessionDetailsRepo);

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );
      aiService.getScenarioSessionSummary.mockResolvedValue(mockSummary);

      // Call through endScenarioSession
      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      // Mock getScenario to be called within the transaction with select parameter
      const mockScenarioForSummary = {
        id: mockScenarioId,
        metadata: {
          agentGoal: 'Test agent goal',
        },
      };
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioForSummary as any,
      );

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      // Add a small delay to allow the async method to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(aiService.getScenarioSessionSummary).toHaveBeenCalledWith(
        [
          {
            role: 'COUNSELLOR',
            content: 'Hello, how are you?',
            start_time: 10.5,
            end_time: 15.2,
          },
          {
            role: 'CLIENT',
            content: 'I am feeling anxious',
            start_time: 16.0,
            end_time: 20.5,
          },
        ],
        'Test agent goal',
      );
      expect(mockScenarioSessionDetailsRepo.save).toHaveBeenCalled();
    });

    it('should use empty string when agentGoal is undefined', async () => {
      const mockMessages = [
        {
          senderId: mockCounselorId,
          content: 'Hello',
          startSeconds: 10.5,
          endSeconds: 15.2,
        },
      ];
      const mockSummary = 'AI generated summary';
      const mockScenarioSessionMessagesRepo = {
        find: jest.fn().mockResolvedValue(mockMessages),
      };
      const mockScenarioSessionDetailsRepo = {
        create: jest.fn().mockReturnValue({ id: 'details-1' }),
        save: jest.fn().mockResolvedValue({ id: 'details-1' }),
      };

      mockEntityManager.getRepository
        .mockReturnValueOnce(mockScenarioSessionMessagesRepo)
        .mockReturnValueOnce(mockScenarioSessionDetailsRepo);

      dataSource.transaction.mockImplementation(async (callback: any) =>
        callback(mockEntityManager),
      );
      aiService.getScenarioSessionSummary.mockResolvedValue(mockSummary);

      const mockScore = 85.5;
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(
        mockScore,
      );
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);

      // Mock getScenario with no agentGoal
      const mockScenarioForSummary = {
        id: mockScenarioId,
        metadata: {
          // No agentGoal property
        },
      };
      scenarioService.getScenario.mockResolvedValue(
        mockScenarioForSummary as any,
      );

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      // Add a small delay to allow the async method to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(aiService.getScenarioSessionSummary).toHaveBeenCalledWith(
        expect.any(Array),
        '', // Should use empty string as fallback
      );
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
        metadata: {
          difficulty: 'intermediate',
          tags: ['anxiety'],
          agentGoal: 'Help the client overcome anxiety',
          lifeHistory: 'Life history of the client',
          voiceId: 'voice-123',
          name: 'Test Client',
          age: 25,
          gender: 'female',
          currentLocation: 'New York, USA',
          context: 'Context of the client',
          openingStatements: 'Opening statements of the client',
        },
      };
      const mockVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: 'preview-room',
        serverUrl: 'https://livekit.example.com',
      };

      scenarioService.getScenario.mockResolvedValue(mockScenarioWithMetadata);
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice);
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
      expect(scenarioService.getScenario).toHaveBeenCalledWith(mockScenarioId);
      expect(
        sessionEventService.getSessionEventsByScenarioId,
      ).toHaveBeenCalledWith(mockScenarioId);
      expect(livekitService.createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/^preview-\d+-/),
          metadata: expect.any(Object),
        }),
      );
      expect(livekitService.generateAccessToken).toHaveBeenCalledWith({
        roomName: expect.stringMatching(/^preview-\d+-/),
        participantName: mockUserId.toString(),
      });
    });

    it('should throw BadRequestException for scenario with invalid status', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockInvalidScenario = {
        ...mockScenario,
        status: ScenarioStatus.ARCHIVED,
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

    it('should throw BadRequestException for scenario with missing mandatory fields', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockIncompleteScenario = {
        ...mockScenario,
        status: ScenarioStatus.DRAFT,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        metadata: {
          agentGoal: 'Help the client',
          // Missing other mandatory fields
        },
      };

      scenarioService.getScenario.mockResolvedValue(mockIncompleteScenario);

      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(
        /The following required fields are missing for preview scenario/,
      );
    });

    it('should handle scenario with null metadata', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockScenarioWithNullMetadata = {
        ...mockScenario,
        status: ScenarioStatus.DRAFT,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        metadata: null,
      };

      scenarioService.getScenario.mockResolvedValue(
        mockScenarioWithNullMetadata as any,
      );

      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(
        /The following required fields are missing for preview scenario/,
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
});
