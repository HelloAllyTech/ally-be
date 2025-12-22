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
import {
  ScenarioStatus,
  ScenarioDifficultyLevel,
} from 'src/learn/type/scenario.type';
import { ScenarioSessionMessagesRepository } from 'src/learn/repository/scenario-session-messages.repository';
import { ScenarioSessionRepository } from 'src/learn/repository/scenario-session.repository';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioTenantService } from '../scenario-tenant.service';
import { ScenarioService } from '../scenario.service';
import { SimulationCreditsService } from '../simulation-credits.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import {
  DEFAULT_LANGUAGE_CODE,
  SCENARIO_SESSION_TRANSLATABLE_FIELDS,
} from 'src/learn/constants/scenario-session.constants';
import { ScenarioTranslationsRepository } from 'src/learn/repository/scenario-translations.repository';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(() => 'test-tenant-id'),
    getUserId: jest.fn(() => 'test-user-id'),
    getExecutionId: jest.fn(() => 'test-execution-id'),
    getCurrentContext: jest.fn(() => ({
      tenantId: 'test-tenant-id',
      userId: 'test-user-id',
      executionId: 'test-execution-id',
    })),
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
  let scenarioPathSessionService: jest.Mocked<ScenarioPathSessionService>;
  let scenarioPathSharedService: jest.Mocked<ScenarioPathSharedService>;
  let scenarioTranslationRepository: jest.Mocked<ScenarioTranslationsRepository>;
  let sessionEventTranslationService: jest.Mocked<SessionEventTranslationService>;
  let mockConfigService: any;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioVoicesRepository: jest.Mocked<ScenarioVoicesRepository>;

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
    metadata: {},
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
      delete: jest.fn(),
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
      getAdminScenario: jest.fn(),
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

    const mockScenarioPathSessionService = {
      handleEndScenarioPathSession: jest.fn(),
    };

    const mockScenarioPathSharedService = {
      getPermittedPathSessionItemBySessionItemId: jest.fn(),
      getScenarioPathSessionById: jest.fn(),
      getScenarioPathTenant: jest.fn(),
    };

    const mockScenarioTranslationsRepository = {
      getScenarioTranslationsByScenarioId: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        metadata: { title: 'Prueba' },
      }),
    };

    const mockSessionEventTranslationService = {
      getSessionEventsTranslationsByScenarioId: jest.fn().mockResolvedValue([]),
    };

    const mockSharedLanguageService = {
      getLanguagesByIds: jest.fn(),
      getLanguageByLanguageCode: jest.fn(),
    };

    const mockScenarioVoicesRepository = {
      getFallbackVoice: jest.fn().mockResolvedValue([]),
    };

    mockConfigService = {
      simulationCredits: {
        lifespanSecondsPerCredit: 60,
      },
      featureFlag: {
        scenarioCustomFields: true,
      },
    };

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
        { provide: ScenarioService, useValue: mockScenarioService },
        { provide: LiveKitService, useValue: mockLivekitService },
        { provide: SessionEventService, useValue: mockSessionEventService },
        { provide: AiService, useValue: mockAiService },
        { provide: PermissionsService, useValue: mockPermissionsService },
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
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidatorService,
        },
        {
          provide: SimulationCreditsService,
          useValue: mockSimulationCreditsService,
        },
        { provide: ScenarioTenantService, useValue: mockScenarioTenantService },
        { provide: AppConfigService, useValue: mockConfigService },
        {
          provide: ScenarioPathSessionService,
          useValue: mockScenarioPathSessionService,
        },
        {
          provide: ScenarioPathSharedService,
          useValue: mockScenarioPathSharedService,
        },
        {
          provide: ScenarioTranslationsRepository,
          useValue: mockScenarioTranslationsRepository,
        },
        {
          provide: SessionEventTranslationService,
          useValue: mockSessionEventTranslationService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioVoicesRepository,
          useValue: mockScenarioVoicesRepository,
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
    scenarioPathSessionService = module.get(ScenarioPathSessionService);
    scenarioPathSharedService = module.get(ScenarioPathSharedService);
    scenarioTranslationRepository = module.get(ScenarioTranslationsRepository);
    sessionEventTranslationService = module.get(SessionEventTranslationService);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioVoicesRepository = module.get(ScenarioVoicesRepository);
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
      expect(scenarioPathSessionService).toBeDefined();
      expect(scenarioPathSharedService).toBeDefined();
      expect(sessionEventTranslationService).toBeDefined();
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

    it('should successfully end scenario session even when already ended', async () => {
      const inactiveSession = {
        ...mockScenarioSession,
        status: ScenarioSessionStatus.ENDED,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(inactiveSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(0);
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
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          status: ScenarioSessionStatus.ENDED,
        }),
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
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        metadata: {
          voiceId: 'voice-123',
          name: 'Test Client',
          age: 25,
          gender: 'female',
          genderIdentity: 'Female/Woman',
          sexualOrientation: 'Heterosexual (straight)',
          currentLocation: 'New York',
          context: 'Context',
          openingStatements: ['Opening'],
          responseLength: 'short',
          agentDialogues: 'Sample dialogue',
          languageVoices: { 1: 'voice-123' },
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

      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioWithMetadata,
      );
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
    it('should use default voice ID from languageVoices when not set in metadata', async () => {
      const scenarioWithoutVoiceId = {
        ...mockScenario,
        metadata: {
          agentGoal: 'Help the client',
          lifeHistory: 'Life history',
          voiceId: undefined,
          name: 'Test Client',
          age: 25,
          gender: 'female',
          currentLocation: 'New York',
          context: 'Context',
          openingStatements: ['Opening', 'Opening 2'],
          // language ID 1 will be returned as default language
          languageVoices: { 1: 'voice-123' },
          difficultyLevel: 'medium',
          responseLength: 'medium',
          genderIdentity: 'female',
          sexualOrientation: 'heterosexual',
          agentDialogues: ['Hello, how can I help you?'],
        },
      };

      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: 'preview-room',
        serverUrl: 'https://livekit.example.com',
      };

      const mockPreviewDto = { scenarioId: mockScenarioId };

      scenarioService.getAdminScenario.mockResolvedValue(
        scenarioWithoutVoiceId as any,
      );

      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );

      // 👇 Mock default language lookup
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue({
        id: 1,
        value: DEFAULT_LANGUAGE_CODE,
        label: 'English (India)',
      } as any);

      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      await service.previewScenario(mockPreviewDto, mockUserId);

      expect(scenarioWithoutVoiceId.metadata.voiceId).toBe('voice-123');
    });
    it('should throw BadRequestException for scenario with invalid status', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockInvalidScenario = {
        ...mockScenario,
        status: ScenarioStatus.ARCHIVED,
        isGlobal: false,
      };

      scenarioService.getAdminScenario.mockResolvedValue(mockInvalidScenario);

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

  describe('getScenarioTranslationData', () => {
    it('should return original data when no language is specified', async () => {
      const metadata = { voiceId: 'test-voice', title: 'Test' };
      const result = await (service as any).getScenarioTranslationData(
        metadata,
        1,
      );
      expect(result).toEqual({
        voiceId: 'test-voice',
        promptData: { title: 'Test' },
      });
    });

    it('should return translated data when language is not English', async () => {
      // Mock the repository to return our translation
      const mockTranslation = {
        id: 1,
        metadata: {
          title: 'Prueba',
          description: 'Descripción de prueba',
          instructions: 'Instrucciones de prueba',
        },
      };
      scenarioTranslationRepository.findOne.mockResolvedValue(
        mockTranslation as any,
      );

      // Create test data with language that's not English
      const metadata = {
        voiceId: 'test-voice',
        title: 'Test',
        language: 'es-ES',
        description: 'Test description',
        instructions: 'Test instructions',
        languageId: 2,
        defaultLanguageId: 1,
      };

      // Save the original fields and replace with our test fields
      const originalFields = [...SCENARIO_SESSION_TRANSLATABLE_FIELDS];
      SCENARIO_SESSION_TRANSLATABLE_FIELDS.length = 0;
      SCENARIO_SESSION_TRANSLATABLE_FIELDS.push(
        'title',
        'description',
        'instructions',
      );

      try {
        const result = await (service as any).getScenarioTranslationData(
          metadata,
          1,
        );

        expect(result).toEqual({
          voiceId: 'test-voice',
          promptData: {
            title: 'Prueba',
            description: 'Descripción de prueba',
            instructions: 'Instrucciones de prueba',
            language: 'es-ES',
            languageId: 2,
          },
        });

        expect(scenarioTranslationRepository.findOne).toHaveBeenCalledWith({
          select: ['id', 'metadata'],
          where: { scenarioId: 1, languageId: 2 },
        });
      } finally {
        // Restore the original fields
        SCENARIO_SESSION_TRANSLATABLE_FIELDS.length = 0;
        SCENARIO_SESSION_TRANSLATABLE_FIELDS.push(...originalFields);
      }
    });
  });

  describe('startScenarioSession', () => {
    it('should throw BadRequestException when scenario not found', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
      };
      scenarioService.getAdminScenario.mockResolvedValue(null as any);

      await expect(
        service.startScenarioSession(mockCounselorId, startDto as any),
      ).rejects.toThrow(new BadRequestException('Scenario not found'));

      expect(scenarioService.getAdminScenario).toHaveBeenCalledWith(
        mockScenarioId,
      );
    });

    it('should throw BadRequestException when voiceId is not found', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
        languageId: '2', // Non-existent language
      };
      const mockScenarioWithoutVoice = {
        id: mockScenarioId,
        title: 'Test Scenario',
        scenario: 'Test scenario content',
        description: 'Test scenario description',
        coverImageUrl: 'https://example.com/image.jpg',
        status: ScenarioStatus.ACTIVE,
        prompt: 'You are a counselor',
        createdAt: new Date(),
        updatedAt: new Date(),
        isGlobal: false,
        metadata: {
          languageVoices: { '1': 'default-voice' }, // No voice for language 2
        },
      };

      scenarioService.getScenario.mockResolvedValue(mockScenarioWithoutVoice);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);

      await expect(
        service.startScenarioSession(1, startDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully start scenario session', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          title: 'Test Scenario',
          description: 'Test Description',
          voiceId: 'test-voice',
          lifeHistory: 'Test Life History',
        },
        isGlobal: false,
      };
      const mockVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
      };
      const mockCreatedSession = {
        ...mockScenarioSession,
        id: 'new-session-id',
        roomId: 'new-room-id',
      };
      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: 'new-room-id',
        serverUrl: 'https://livekit.example.com',
      };
      const mockFallbackVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        config: {
          age: 'adult',
          name: 'priyanka',
          model: 'aura-2-luna-en',
          gender: 'female',
          voiceId: 'aura-2-luna-en',
        },
      };

      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioWithMetadata as any,
      );
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice as any);
      scenarioTenantService.getScenarioTenant.mockResolvedValue({
        id: 1,
        scenarioId: mockScenarioId,
        tenantId: mockTenantId,
      } as any);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioVoicesRepository.getFallbackVoice.mockResolvedValue(
        mockFallbackVoice as any,
      );
      sessionEventService.findByIds.mockResolvedValue([]);
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        consumedCredits: 0,
        creditLimit: 100,
      } as any);
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockCreatedSession,
      );
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.startScenarioSession(
        mockCounselorId,
        startDto as any,
      );

      expect(result).toBeDefined();
      expect(result.scenarioSession).toEqual(mockCreatedSession);
      expect(result.accessToken).toEqual(mockTokenResponse);
      expect(livekitService.createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockCreatedSession.roomId,
          ttl: 3600,
        }),
      );
    });

    it('should clean up session when room creation fails', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
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
      const mockCreatedSession = {
        ...mockScenarioSession,
        id: 'new-session-id',
        roomId: 'new-room-id',
      };

      const mockFallbackVoice = {
        id: 'voice-123',
        name: 'Test Voice',
        config: {
          age: 'adult',
          name: 'priyanka',
          model: 'aura-2-luna-en',
          gender: 'female',
          voiceId: 'aura-2-luna-en',
        },
      };
      const roomError = new Error('Room creation failed');

      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioWithMetadata as any,
      );
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice as any);
      scenarioTenantService.getScenarioTenant.mockResolvedValue({
        id: 1,
        scenarioId: mockScenarioId,
        tenantId: mockTenantId,
      } as any);
      sessionEventService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioVoicesRepository.getFallbackVoice.mockResolvedValue(
        mockFallbackVoice as any,
      );
      sessionEventService.findByIds.mockResolvedValue([]);
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        consumedCredits: 0,
        creditLimit: 100,
      } as any);
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockCreatedSession,
      );
      scenarioSessionRepository.delete = jest.fn().mockResolvedValue(undefined);
      livekitService.createRoom.mockRejectedValue(roomError);

      await expect(
        service.startScenarioSession(mockCounselorId, startDto as any),
      ).rejects.toThrow('Room creation failed');

      expect(scenarioSessionRepository.delete).toHaveBeenCalledWith(
        mockCreatedSession.id,
      );
    });
  });

  describe('getLanguageDetailsForScenarioSession', () => {
    it('should return language details', async () => {
      const languageDetails = await (
        service as any
      ).getLanguageDetailsForScenarioSession(
        mockCounselorId,
        mockScenarioSessionId,
      );
      expect(languageDetails).toBeDefined();
    });
    it('should return null languageDetails if languageDetails is not found', async () => {
      const mockReturnData = {
        enLanguageDetails: undefined,
        languageDetails: null,
      };
      const languageDetails = await (
        service as any
      ).getLanguageDetailsForScenarioSession(1);
      expect(languageDetails).toEqual(mockReturnData);
    });
  });

  describe('getFallbackVoiceForLanguageGender', () => {
    it('should return fallback voice for language and gender', async () => {
      const fallbackVoice = await (
        service as any
      ).getFallbackVoiceForLanguageGender(1, 'female');
      expect(fallbackVoice).toBeDefined();
    });
  });
});
