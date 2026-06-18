import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { DataSource, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { UserService } from 'src/user/service/user.service';
import { AddFeedbackToScenarioSessionRequestDto } from 'src/learn/dto/add-feedback-to-scenario-session.dto';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { ScenarioSessionDetails } from 'src/learn/entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from 'src/learn/entity/scenario-session-events.entity';
import { ScenarioSessionTurnMetrics } from 'src/learn/entity/scenario-session-turn-metrics.entity';
import { LearnTurnMetricsData } from 'src/learn/interface/learn-message.interface';
import { ScenarioSessionBehaviorInstructions } from 'src/learn/entity/scenario-session-behavior-instructions.entity';
import { ScenarioSessionMessages } from 'src/learn/entity/scenario-session-messages.entity';
import { ScenarioSessionMessageType } from 'src/learn/enum/scenario-session-message.type.enum';
import { ScenarioSessionFeedbacks } from 'src/learn/entity/scenario-session-feedbacks.entity';
import { ScenarioSessionReflectionPromptResponse } from 'src/learn/entity/scenario-session-reflection-prompt-response.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ScenarioSessionStatus } from 'src/learn/enum/scenario-session-status.enum';
import {
  ScenarioStatus,
  ScenarioDifficultyLevel,
  ExperienceMode,
  ChecklistType,
} from 'src/learn/type/scenario.type';
import { ScenarioSessionMessagesRepository } from 'src/learn/repository/scenario-session-messages.repository';
import { ScenarioSessionRepository } from 'src/learn/repository/scenario-session.repository';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioTenantService } from '../scenario-tenant.service';
import { ScenarioService } from '../scenario.service';
import { SimulationCreditsService } from '../simulation-credits.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import { ScenarioTranslationsRepository } from 'src/learn/repository/scenario-translations.repository';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversationalGuardrailsService } from 'src/conversational-guardrails/service/conversational-guardrails.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { isEnglishLanguage } from '../../util/scenario.util';
import { BehaviorTranslationRepository } from 'src/learn/repository/behavior-translation.repository';
import { ScenarioBehaviorInstructionTranslationRepository } from 'src/learn/repository/scenario-behavior-instruction-translation.repository';
import { ScenarioEventsRepository } from 'src/learn/repository/scenario-events.repository';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { SimulationCapacityException } from 'src/learn/exception/simulation-capacity.exception';
import { ScenarioSessionRecordingService } from '../scenario-session-recording.service';

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
  let sessionEventSharedService: jest.Mocked<SessionEventSharedService>;
  let aiService: jest.Mocked<AiService>;
  let scenarioSessionFeedbacksRepository: jest.Mocked<
    Repository<ScenarioSessionFeedbacks>
  >;
  let scenarioSessionReflectionPromptResponseRepository: jest.Mocked<
    Repository<ScenarioSessionReflectionPromptResponse>
  >;
  let dataSource: jest.Mocked<DataSource>;
  let permissionValidatorService: jest.Mocked<PermissionValidator>;
  let simulationCreditsService: jest.Mocked<SimulationCreditsService>;
  let scenarioTenantService: jest.Mocked<ScenarioTenantService>;
  let scenarioPathSessionService: jest.Mocked<ScenarioPathSessionService>;
  let scenarioPathSharedService: jest.Mocked<ScenarioPathSharedService>;
  let reviewSharedService: jest.Mocked<ScenarioSessionReviewSharedService>;
  let sessionEventTranslationService: jest.Mocked<SessionEventTranslationService>;
  let mockConfigService: any;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let scenarioEventsRepository: jest.Mocked<ScenarioEventsRepository>;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;

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
    metadata: {
      stateInstructions: [
        {
          stateId: '1',
          name: 'State 1',
        },
      ],
    },
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

    const mockScenarioSharedService = {
      getMessagesByScenarioSessionId: jest.fn(),
      getScenarioSessionSkills: jest.fn(),
    };

    const mockLivekitService = {
      createRoom: jest.fn(),
      deleteRoom: jest.fn(),
      generateAccessToken: jest.fn(),
      getRoom: jest.fn(),
      listRooms: jest.fn().mockResolvedValue([]),
      listParticipants: jest.fn().mockResolvedValue([]),
      agentDispatch: jest.fn().mockResolvedValue(undefined),
      preMarkProactiveDispatch: jest.fn(),
      clearProactiveDispatch: jest.fn(),
      isProactiveDispatchPending: jest.fn().mockReturnValue(false),
    };

    const mockSessionEventSharedService = {
      getSessionEventsByScenarioId: jest.fn(),
      findByIds: jest.fn(),
    };

    const mockAiService = {
      getScenarioSessionSummary: jest.fn(),
      getScenarioSessionEvaluation: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn(),
    };

    const mockFeedbackRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockScenarioSessionReflectionPromptResponseRepo = {
      find: jest.fn().mockResolvedValue([]),
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

    const mockScenarioSessionBehaviorInstructionsRepo = {
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

    const mockReviewSharedService = {
      getReviewByScenarioSessionId: jest.fn().mockResolvedValue(null),
    };
    const mockEventEmitter = {
      emit: jest.fn(),
    };
    const mockConversationalGuardrailsService = {
      getRandomGuardrailsForSession: jest.fn().mockResolvedValue([]),
    };

    const mockCaseSharedService = {
      getCaseItemsByIds: jest.fn(),
      getCaseSessionItemsForUser: jest.fn(),
      getPreviousCaseMemory: jest.fn().mockResolvedValue(null),
    };

    const mockCaseSessionService = {
      getCaseSessionById: jest.fn(),
      updateCaseSessionItemStatus: jest.fn(),
    };

    const mockBehaviorTranslationRepository = {
      getTranslationsForBehaviors: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioBehaviorInstructionTranslationRepository = {
      getTranslationsForInstructions: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioEventsRepository = {
      getEventChecklist: jest.fn(),
    };

    const mockScenariosRepository = {
      findOne: jest.fn(),
    };

    const mockScenarioSessionRecordingService = {
      stopScenarioSessionRecording: jest.fn(),
    };

    mockConfigService = {
      simulationCredits: {
        lifespanSecondsPerCredit: 60,
      },
      featureFlag: {
        scenarioCustomFields: true,
        useScenarioSessionEvaluation: false,
      },
      isThinkingFillerAllowed: jest.fn().mockReturnValue(false),
      simulationConcurrency: {
        maxConcurrentSimulations: 100,
      },
      livekit: {
        agentName: 'Agent',
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
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        { provide: LiveKitService, useValue: mockLivekitService },
        {
          provide: SessionEventSharedService,
          useValue: mockSessionEventSharedService,
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            ...mockScenarioSharedService,
            createMetadataForScenario: jest.fn(),
            createRoomMetadata: jest.fn(),
            getScenarioById: jest.fn(),
            getScenarioSessionById: jest.fn(),
            getSessionEventsByScenarioId: jest.fn(),
            getLanguageDetailsForScenarioSession: jest.fn().mockResolvedValue({
              enLanguageDetails: { id: 1, value: 'en' },
              languageDetails: { id: 1, value: 'en' },
            }),
          },
        },
        { provide: AiService, useValue: mockAiService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        {
          provide: getRepositoryToken(ScenarioSessionFeedbacks),
          useValue: mockFeedbackRepo,
        },
        {
          provide: getRepositoryToken(ScenarioSessionReflectionPromptResponse),
          useValue: mockScenarioSessionReflectionPromptResponseRepo,
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
          provide: getRepositoryToken(ScenarioSessionBehaviorInstructions),
          useValue: mockScenarioSessionBehaviorInstructionsRepo,
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
          provide: UserService,
          useValue: {
            get: jest.fn().mockResolvedValue({ email: 'test@example.com' }),
          },
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioVoicesRepository,
          useValue: mockScenarioVoicesRepository,
        },
        {
          provide: ScenarioSessionReviewSharedService,
          useValue: mockReviewSharedService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ConversationalGuardrailsService,
          useValue: mockConversationalGuardrailsService,
        },
        {
          provide: CaseSharedService,
          useValue: mockCaseSharedService,
        },
        {
          provide: CaseSessionService,
          useValue: mockCaseSessionService,
        },
        {
          provide: BehaviorTranslationRepository,
          useValue: mockBehaviorTranslationRepository,
        },
        {
          provide: ScenarioBehaviorInstructionTranslationRepository,
          useValue: mockScenarioBehaviorInstructionTranslationRepository,
        },
        {
          provide: ScenarioEventsRepository,
          useValue: mockScenarioEventsRepository,
        },
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepository,
        },
        {
          provide: ScenarioSessionRecordingService,
          useValue: mockScenarioSessionRecordingService,
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
    sessionEventSharedService = module.get(SessionEventSharedService);
    aiService = module.get(AiService);
    scenarioSessionFeedbacksRepository = module.get(
      getRepositoryToken(ScenarioSessionFeedbacks),
    );
    scenarioSessionReflectionPromptResponseRepository = module.get(
      getRepositoryToken(ScenarioSessionReflectionPromptResponse),
    );
    dataSource = module.get(DataSource);
    permissionValidatorService = module.get(PermissionValidator);
    simulationCreditsService = module.get(SimulationCreditsService);
    scenarioTenantService = module.get(ScenarioTenantService);
    scenarioPathSessionService = module.get(ScenarioPathSessionService);
    scenarioPathSharedService = module.get(ScenarioPathSharedService);
    sessionEventTranslationService = module.get(SessionEventTranslationService);
    reviewSharedService = module.get(ScenarioSessionReviewSharedService);
    scenarioSharedService = module.get(ScenarioSharedService);
    scenarioEventsRepository = module.get(ScenarioEventsRepository);
    scenariosRepository = module.get(ScenariosRepository) as any;
    sharedLanguageService = module.get(SharedLanguageService);
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
      expect(sessionEventSharedService).toBeDefined();
      expect(aiService).toBeDefined();
      expect(scenarioSessionFeedbacksRepository).toBeDefined();
      expect(dataSource).toBeDefined();
      expect(permissionValidatorService).toBeDefined();
      expect(simulationCreditsService).toBeDefined();
      expect(scenarioTenantService).toBeDefined();
      expect(scenarioPathSessionService).toBeDefined();
      expect(scenarioPathSharedService).toBeDefined();
      expect(sessionEventTranslationService).toBeDefined();
      expect(reviewSharedService).toBeDefined();
    });
  });

  describe('getScenarioSessions', () => {
    it('should return scenario sessions with default status', async () => {
      const mockSessions = [
        { ...mockScenarioSession, scenario: { ...mockScenario } },
      ];
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('scenario.prompt');
      expect(result.data[0]).not.toHaveProperty('scenario.metadata');
      expect(result.data[0]).not.toHaveProperty('scenario.translations');
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(
        mockCounselorId,
        mockPagination,
        ScenarioSessionStatus.ENDED,
      );
    });

    it('should return scenario sessions with custom status and apply translations when languageCode is provided', async () => {
      const mockSessions = [
        {
          ...mockScenarioSession,
          scenario: {
            ...mockScenario,
            title: 'English Title',
            description: 'English Description',
            translations: {
              mr: {
                title: 'Marathi Title',
                description: 'Marathi Description',
              },
            },
          },
        },
      ];
      const customStatus = ScenarioSessionStatus.ACTIVE;
      const languageCode = 'mr';
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        customStatus,
        languageCode,
      );

      expect(result.data).toHaveLength(1);
      const scenario = (result.data[0] as any).scenario;
      expect(scenario.title).toBe('Marathi Title');
      expect(scenario.description).toBe('Marathi Description');
      expect(scenario).not.toHaveProperty('prompt');
      expect(scenario).not.toHaveProperty('metadata');
      expect(scenario).not.toHaveProperty('translations');
      expect(
        scenarioSessionRepository.getScenarioSessions,
      ).toHaveBeenCalledWith(mockCounselorId, mockPagination, customStatus);
    });

    it('should fallback to default title/description if translation for languageCode is missing one field', async () => {
      const mockSessions = [
        {
          ...mockScenarioSession,
          scenario: {
            ...mockScenario,
            title: 'English Title',
            description: 'English Description',
            translations: {
              mr: {
                title: 'Marathi Title',
                // description is missing
              },
            },
          },
        },
      ];
      const customStatus = ScenarioSessionStatus.ACTIVE;
      const languageCode = 'mr';
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await service.getScenarioSessions(
        mockCounselorId,
        mockPagination,
        customStatus,
        languageCode,
      );

      expect(result.data).toHaveLength(1);
      const scenario = (result.data[0] as any).scenario;
      expect(scenario.title).toBe('Marathi Title');
      expect(scenario.description).toBe('English Description');
    });
  });

  describe('getAdminScenarioSessions', () => {
    it('should return admin scenario sessions and delete internal fields including translations', async () => {
      const mockSessions = [
        { ...mockScenarioSession, scenario: { ...mockScenario } },
      ];
      scenarioSessionRepository.getAdminScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await service.getAdminScenarioSessions(mockPagination);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('scenario.prompt');
      expect(result.data[0]).not.toHaveProperty('scenario.metadata');
      expect(result.data[0]).not.toHaveProperty('scenario.translations');
      expect(
        scenarioSessionRepository.getAdminScenarioSessions,
      ).toHaveBeenCalledWith(mockPagination, ScenarioSessionStatus.ENDED);
    });

    it('should apply translations to admin scenario sessions when languageCode is provided', async () => {
      const mockSessions = [
        {
          ...mockScenarioSession,
          scenario: {
            ...mockScenario,
            title: 'English Title',
            description: 'English Description',
            translations: {
              mr: {
                title: 'Marathi Title',
                description: 'Marathi Description',
              },
            },
          },
        },
      ];
      const languageCode = 'mr';
      scenarioSessionRepository.getAdminScenarioSessions.mockResolvedValue(
        mockSessions as any,
      );

      const result = await service.getAdminScenarioSessions(
        mockPagination,
        languageCode,
      );

      expect(result.data).toHaveLength(1);
      const scenario = (result.data[0] as any).scenario;
      expect(scenario.title).toBe('Marathi Title');
      expect(scenario.description).toBe('Marathi Description');
      expect(scenario).not.toHaveProperty('prompt');
      expect(scenario).not.toHaveProperty('metadata');
      expect(scenario).not.toHaveProperty('translations');
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

      expect(result).toEqual({
        ...mockScenarioSession,
        hasFeedback: true,
        sessionFeedback: { rating: 5, feedback: undefined, tags: [] },
        reviewId: undefined,
        reviewNote: undefined,
        reviewStatus: undefined,
        reviewCreatedAt: undefined,
      });
      expect(scenarioSessionRepository.getScenarioSession).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockCounselorId,
        true,
      );
    });

    it('should apply translations to scenario when languageCode is provided', async () => {
      const mockSessionWithTranslations = {
        ...mockScenarioSession,
        scenario: {
          ...mockScenario,
          title: 'English Title',
          description: 'English Description',
          translations: {
            mr: {
              title: 'Marathi Title',
              description: 'Marathi Description',
            },
          },
        },
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithTranslations as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        false,
        'mr',
      );

      const scenario = (result as any).scenario;
      expect(scenario.title).toBe('Marathi Title');
      expect(scenario.description).toBe('Marathi Description');
      expect(scenario).not.toHaveProperty('prompt');
      expect(scenario).not.toHaveProperty('translations');
    });

    it('should strip areas_of_improvement and populate improvements when enableRecommendations is false', async () => {
      const mockSessionWithDetails = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:30:00Z'),
        details: {
          summary: {
            areas_of_improvement: [
              {
                improvement: 'Be more empathetic',
                recommendation: 'Try active listening',
              },
              {
                improvement: 'Ask open questions',
                recommendation: 'Use how/what',
              },
            ],
          },
        },
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithDetails as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        false,
      );

      expect((result as any).details.summary.improvements).toEqual([
        'Be more empathetic',
        'Ask open questions',
      ]);
      expect(
        (result as any).details.summary.areas_of_improvement,
      ).toBeUndefined();
    });

    it('should preserve areas_of_improvement when enableRecommendations is true', async () => {
      const areasOfImprovement = [
        {
          improvement: 'Be more empathetic',
          recommendation: 'Try active listening',
        },
        { improvement: 'Ask open questions', recommendation: 'Use how/what' },
      ];
      const mockSessionWithDetails = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:30:00Z'),
        details: {
          summary: {
            areas_of_improvement: areasOfImprovement,
          },
        },
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithDetails as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        true,
      );

      expect((result as any).details.summary.areas_of_improvement).toEqual(
        areasOfImprovement,
      );
    });

    it('should keep existing improvements and clear areas_of_improvement when enableRecommendations is false and improvements already exist', async () => {
      const mockSessionWithDetails = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:30:00Z'),
        details: {
          summary: {
            improvements: ['Existing improvement 1'],
            areas_of_improvement: [
              { improvement: 'New improvement', recommendation: 'Do this' },
            ],
          },
        },
      };

      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        mockSessionWithDetails as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        false,
      );

      expect((result as any).details.summary.improvements).toEqual([
        'Existing improvement 1',
      ]);
      expect(
        (result as any).details.summary.areas_of_improvement,
      ).toBeUndefined();
    });

    it('should return only ACTIVE events (filtering done at repository level)', async () => {
      // Repository now returns only ACTIVE events with autoTerminationStatus=false
      const mockSessionWithActiveEvents = {
        ...mockScenarioSession,
        events: [
          {
            id: 'session-event-1',
            autoTerminationStatus: false,
            events: {
              id: 'event-1',
              visibilityType: 'ACTIVE',
              name: 'Active Event 1',
            },
          },
          {
            id: 'session-event-3',
            autoTerminationStatus: false,
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
        mockSessionWithActiveEvents as any,
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

  describe('getScenarioSession - per-language report', () => {
    const endedSession = (summary: Record<string, any>) =>
      ({
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:30:00Z'),
        details: { summary },
      }) as any;

    beforeEach(() => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);
    });

    it('serves the default feedback (and strips internal cache fields) when the requested language matches the stored language', async () => {
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        endedSession({
          feedback: { positives: ['Good rapport'] },
          language: 'en',
          translations: { hi: { status: 'COMPLETED', feedback: {} } },
        }),
      );

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        true,
        'en-US',
      );

      expect((result as any).details.summary.feedback).toEqual({
        positives: ['Good rapport'],
      });
      expect((result as any).details.summary).not.toHaveProperty(
        'translations',
      );
      expect((result as any).details.summary).not.toHaveProperty('language');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('swaps in the cached COMPLETED feedback for the requested language', async () => {
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        endedSession({
          feedback: { positives: ['English'] },
          language: 'en',
          translations: {
            hi: { status: 'COMPLETED', feedback: { positives: ['हिंदी'] } },
          },
        }),
      );

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        true,
        'hi',
      );

      expect((result as any).details.summary.feedback).toEqual({
        positives: ['हिंदी'],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('withholds feedback and triggers a background re-evaluation when the requested language is not cached', async () => {
      const row: any = {
        summary: { feedback: { positives: ['English'] }, language: 'en' },
      };
      const repoStub = {
        findOne: jest.fn().mockResolvedValue(row),
        save: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb({ getRepository: () => repoStub }),
      );
      scenarioSessionMessagesRepository.find.mockResolvedValue([
        {
          id: 1,
          senderId: 1,
          content: 'hello',
          startSeconds: 0,
          endSeconds: 1,
        },
      ] as any);
      aiService.getScenarioSessionEvaluation.mockResolvedValue({
        positives: [],
        improvements: [],
        emotional_movement: [],
        message_tags: [],
        areas_of_growth: [],
      } as any);
      scenarioSessionRepository.getScenarioSession.mockResolvedValue(
        endedSession({
          feedback: { positives: ['English'] },
          language: 'en',
        }),
      );

      const result = await service.getScenarioSession(
        mockScenarioSessionId,
        mockCounselorId,
        true,
        'ta',
      );

      // Feedback withheld so the client keeps polling until the Tamil copy lands.
      expect((result as any).details.summary.feedback).toBeUndefined();
      // PENDING slot was reserved.
      expect(repoStub.save).toHaveBeenCalled();
      expect(row.summary.translations.ta.status).toBeDefined();

      // The fire-and-forget generation runs the evaluation in the target language.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      const evalCall = aiService.getScenarioSessionEvaluation.mock.calls[0];
      expect(evalCall[1]).toBe(false); // need_memory
      expect(evalCall[5]).toBe('ta'); // languageCode
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
      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        expect.objectContaining({
          metadata: expect.objectContaining({ creditsUsed: 3 }),
        }),
      );

      global.Date = originalDate;
    });

    it('should call getScenarioSessionEvaluation when useScenarioSessionEvaluation is true', async () => {
      const mockSummaryResponse = {
        improvements: ['Improve exploration'],
        positives: ['Good empathy'],
        sessionGlimpse: 'Client discussed work stress.',
        cumulativeMemory: '',
        messageTags: [] as string[],
        emotionalMovement: [] as string[],
      };
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: 1,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Hello',
          startSeconds: 0,
          endSeconds: 2,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDetailsSave = jest.fn().mockResolvedValue(undefined);
      const mockDetailsRepo = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: mockDetailsSave,
      };
      const mockEntityManager = {
        getRepository: jest.fn(() => mockDetailsRepo),
      };

      mockConfigService.featureFlag.useScenarioSessionEvaluation = true;
      scenarioSessionMessagesRepository.find.mockResolvedValue(
        mockMessages as ScenarioSessionMessages[],
      );
      aiService.getScenarioSessionEvaluation.mockResolvedValue(
        mockSummaryResponse as any,
      );
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb(mockEntityManager),
      );

      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(0);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);
      await new Promise((r) => setImmediate(r));

      expect(aiService.getScenarioSessionEvaluation).toHaveBeenCalled();
      expect(aiService.getScenarioSessionSummary).not.toHaveBeenCalled();
      expect(mockDetailsSave).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: { feedback: mockSummaryResponse },
        }),
      );

      mockConfigService.featureFlag.useScenarioSessionEvaluation = false;
    });

    it('should call getScenarioSessionSummary when useScenarioSessionEvaluation is false', async () => {
      const mockFeedbackResponse = { feedback: 'Summary feedback' };
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: 0,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Client said hi',
          startSeconds: 0,
          endSeconds: 1,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDetailsSave = jest.fn().mockResolvedValue(undefined);
      const mockDetailsRepo = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: mockDetailsSave,
      };
      const mockEntityManager = {
        getRepository: jest.fn(() => mockDetailsRepo),
      };

      mockConfigService.featureFlag.useScenarioSessionEvaluation = false;
      scenarioSessionMessagesRepository.find.mockResolvedValue(
        mockMessages as ScenarioSessionMessages[],
      );
      aiService.getScenarioSessionSummary.mockResolvedValue(
        mockFeedbackResponse as any,
      );
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb(mockEntityManager),
      );

      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(0);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);
      await new Promise((r) => setImmediate(r));

      expect(aiService.getScenarioSessionSummary).toHaveBeenCalled();
      expect(aiService.getScenarioSessionEvaluation).not.toHaveBeenCalled();
      expect(mockDetailsSave).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: { feedback: mockFeedbackResponse },
        }),
      );
    });

    it('should pass enableRecommendations to getScenarioSessionEvaluation', async () => {
      const mockSummaryResponse = {
        improvements: [],
        positives: [],
        sessionGlimpse: '',
        cumulativeMemory: '',
        messageTags: [] as string[],
        emotionalMovement: [] as string[],
        areas_of_improvement: [
          { improvement: 'Improve X', recommendation: 'Do Y' },
        ],
      };
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: 1,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Hello',
          startSeconds: 0,
          endSeconds: 2,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDetailsSave = jest.fn().mockResolvedValue(undefined);
      const mockDetailsRepo = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: mockDetailsSave,
      };
      const mockEntityManager = {
        getRepository: jest.fn(() => mockDetailsRepo),
      };

      mockConfigService.featureFlag.useScenarioSessionEvaluation = true;
      scenarioSessionMessagesRepository.find.mockResolvedValue(
        mockMessages as ScenarioSessionMessages[],
      );
      aiService.getScenarioSessionEvaluation.mockResolvedValue(
        mockSummaryResponse as any,
      );
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb(mockEntityManager),
      );

      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId, {
        enableRecommendations: true,
      });
      await new Promise((r) => setImmediate(r));

      expect(aiService.getScenarioSessionEvaluation).toHaveBeenCalledWith(
        expect.any(Array),
        false,
        null,
        undefined,
        true,
        undefined,
      );

      mockConfigService.featureFlag.useScenarioSessionEvaluation = false;
    });

    it('should pass languageCode to getScenarioSessionEvaluation', async () => {
      const mockSummaryResponse = {
        improvements: [],
        positives: [],
        sessionGlimpse: '',
        cumulativeMemory: '',
        messageTags: [] as string[],
        emotionalMovement: [] as string[],
        areas_of_improvement: [
          { improvement: 'Improve X', recommendation: 'Do Y' },
        ],
      };
      const mockMessages = [
        {
          id: 1,
          scenarioSessionId: mockScenarioSessionId,
          senderId: 1,
          messageType: ScenarioSessionMessageType.TEXT,
          content: 'Hello',
          startSeconds: 0,
          endSeconds: 2,
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDetailsSave = jest.fn().mockResolvedValue(undefined);
      const mockDetailsRepo = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: mockDetailsSave,
      };
      const mockEntityManager = {
        getRepository: jest.fn(() => mockDetailsRepo),
      };

      mockConfigService.featureFlag.useScenarioSessionEvaluation = true;
      scenarioSessionMessagesRepository.find.mockResolvedValue(
        mockMessages as ScenarioSessionMessages[],
      );
      aiService.getScenarioSessionEvaluation.mockResolvedValue(
        mockSummaryResponse as any,
      );
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb(mockEntityManager),
      );

      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId, {
        enableRecommendations: true,
        languageCode: 'hi',
      });
      await new Promise((r) => setImmediate(r));

      expect(aiService.getScenarioSessionEvaluation).toHaveBeenCalledWith(
        expect.any(Array),
        false,
        null,
        undefined,
        true,
        'hi',
      );

      mockConfigService.featureFlag.useScenarioSessionEvaluation = false;
    });
  });

  describe('pause/resume', () => {
    it('handleSessionPausedEvent stamps pausedAt from the event timestamp', async () => {
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      const atMs = Date.parse('2024-01-01T10:01:00Z');

      await service.handleSessionPausedEvent(mockScenarioSession, {
        timestamp: new Date(),
        event_data: { id: 'session-paused', atMs },
      } as any);

      expect(scenarioSessionRepository.update).toHaveBeenCalledWith(
        mockScenarioSessionId,
        { pausedAt: new Date(atMs) },
      );
    });

    it('handleSessionPausedEvent is a no-op once the session has ended', async () => {
      await service.handleSessionPausedEvent(
        { ...mockScenarioSession, status: ScenarioSessionStatus.ENDED },
        {
          timestamp: new Date(),
          event_data: { id: 'session-paused', atMs: 1 },
        } as any,
      );

      expect(scenarioSessionRepository.update).not.toHaveBeenCalled();
    });

    it('handleSessionResumedEvent sets cumulative totalPausedMs and clears pausedAt', async () => {
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);

      await service.handleSessionResumedEvent(
        { ...mockScenarioSession, totalPausedMs: 5000 },
        {
          timestamp: new Date(),
          event_data: { id: 'session-resumed', totalPausedMs: 12000 },
        } as any,
      );

      const [id, patch] = scenarioSessionRepository.update.mock.calls[0];
      expect(id).toBe(mockScenarioSessionId);
      expect(patch.pausedAt).toBeNull();
      // totalPausedMs is applied atomically as a SQL GREATEST expression.
      expect((patch.totalPausedMs as () => string)()).toBe(
        'GREATEST("totalPausedMs", 12000)',
      );
    });

    it('handleSessionResumedEvent applies GREATEST so a stale event cannot lower the total', async () => {
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);

      await service.handleSessionResumedEvent(
        { ...mockScenarioSession, totalPausedMs: 20000 },
        {
          timestamp: new Date(),
          event_data: { id: 'session-resumed', totalPausedMs: 12000 },
        } as any,
      );

      const [, patch] = scenarioSessionRepository.update.mock.calls[0];
      // The DB-side GREATEST keeps the larger stored value (20000) over the
      // stale reported 12000 — the guarantee now lives in SQL, atomically.
      expect((patch.totalPausedMs as () => string)()).toBe(
        'GREATEST("totalPausedMs", 12000)',
      );
    });

    it('handleScenarioSessionEvent routes session-paused and session-resumed', async () => {
      const pauseSpy = jest
        .spyOn(service, 'handleSessionPausedEvent')
        .mockResolvedValue(undefined as any);
      const resumeSpy = jest
        .spyOn(service, 'handleSessionResumedEvent')
        .mockResolvedValue(undefined as any);

      await service.handleScenarioSessionEvent(mockScenarioSession, {
        timestamp: new Date(),
        event_data: { id: 'session-paused' },
      } as any);
      await service.handleScenarioSessionEvent(mockScenarioSession, {
        timestamp: new Date(),
        event_data: { id: 'session-resumed' },
      } as any);

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(resumeSpy).toHaveBeenCalledTimes(1);

      pauseSpy.mockRestore();
      resumeSpy.mockRestore();
    });

    it('excludes totalPausedMs from billed credits', async () => {
      // 165s wall - 60s paused = 105s active -> 1 full credit + 45s (>=30) -> 2 credits
      const session = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:02:45Z'),
        totalPausedMs: 60000,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(session);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(80);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        2,
      );
    });

    it('closes an open pause interval (ended while paused) when billing', async () => {
      // wall 165s, paused 10:01:00 -> end 10:02:45 = 105s -> active 60s -> exactly 1 credit
      const session = {
        ...mockScenarioSession,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:02:45Z'),
        pausedAt: new Date('2024-01-01T10:01:00Z'),
        totalPausedMs: 0,
      };
      scenarioSessionRepository.findOne.mockResolvedValue(session);
      scenarioSessionRepository.getScenarioSessionScore.mockResolvedValue(80);
      scenarioSessionRepository.update.mockResolvedValue({
        affected: 1,
      } as any);
      livekitService.deleteRoom.mockResolvedValue(undefined);
      simulationCreditsService.consumeCredits.mockResolvedValue(true);

      await service.endScenarioSession(mockScenarioSessionId, mockCounselorId);

      expect(simulationCreditsService.consumeCredits).toHaveBeenCalledWith(
        mockCounselorId,
        1,
      );
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
        tags: [],
      });
    });
  });

  describe('getReflectionPrompts', () => {
    it('should return reflection prompts for the session', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      const promptId = '0ee957a5-36d3-49be-886f-a8c72242388e';
      const mockRows = [
        {
          id: 'response-row-1',
          promptId,
          response: 'My reflection answer',
        },
      ];
      scenarioSessionReflectionPromptResponseRepository.find.mockResolvedValue(
        mockRows as ScenarioSessionReflectionPromptResponse[],
      );

      const result = await service.getReflectionPrompts(mockScenarioSessionId);

      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockScenarioSessionId, tenantId: mockTenantId },
      });
      expect(
        scenarioSessionReflectionPromptResponseRepository.find,
      ).toHaveBeenCalledWith({
        where: { scenarioSessionId: mockScenarioSessionId },
      });
      expect(result.reflectionPrompts).toHaveLength(1);
      expect(result.reflectionPrompts[0].id).toBe('response-row-1');
      expect(result.reflectionPrompts[0].promptId).toBe(promptId);
      expect(result.reflectionPrompts[0].response).toBe('My reflection answer');
      expect(result.reflectionPrompts[0].prompt).toBe(
        'What do you think the client needed most in the moment you shifted to problem-solving?',
      );
    });

    it('should throw NotFoundException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getReflectionPrompts(mockScenarioSessionId),
      ).rejects.toThrow(NotFoundException);

      expect(
        scenarioSessionReflectionPromptResponseRepository.find,
      ).not.toHaveBeenCalled();
    });

    it('should return empty array when no reflection prompt records exist', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionReflectionPromptResponseRepository.find.mockResolvedValue(
        [],
      );

      const result = await service.getReflectionPrompts(mockScenarioSessionId);

      expect(result.reflectionPrompts).toEqual([]);
    });

    it('should use empty string for prompt when promptId not in constants', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      const unknownPromptId = '00000000-0000-0000-0000-000000000000';
      const mockRows = [
        {
          id: 'response-row-1',
          promptId: unknownPromptId,
          response: 'Some answer',
        },
      ];
      scenarioSessionReflectionPromptResponseRepository.find.mockResolvedValue(
        mockRows as ScenarioSessionReflectionPromptResponse[],
      );

      const result = await service.getReflectionPrompts(mockScenarioSessionId);

      expect(result.reflectionPrompts[0].prompt).toBe('');
      expect(result.reflectionPrompts[0].promptId).toBe(unknownPromptId);
    });
  });

  describe('createReflectionPromptRecordsForSession', () => {
    it('should create 2 reflection prompt records for the session', async () => {
      scenarioSessionReflectionPromptResponseRepository.create.mockImplementation(
        (entity: any) => entity as any,
      );
      scenarioSessionReflectionPromptResponseRepository.save.mockResolvedValue(
        [] as any,
      );

      await service.createReflectionPromptRecordsForSession(
        mockScenarioSessionId,
        mockTenantId,
      );

      expect(
        scenarioSessionReflectionPromptResponseRepository.create,
      ).toHaveBeenCalledTimes(2);
      expect(
        scenarioSessionReflectionPromptResponseRepository.save,
      ).toHaveBeenCalledTimes(1);

      const saveArg = scenarioSessionReflectionPromptResponseRepository.save
        .mock.calls[0][0] as any[];
      expect(saveArg).toHaveLength(2);
      saveArg.forEach((item: any) => {
        expect(item).toMatchObject({
          scenarioSessionId: mockScenarioSessionId,
          tenantId: mockTenantId,
          response: undefined,
        });
        expect(item.promptId).toBeDefined();
        expect(typeof item.promptId).toBe('string');
      });
    });
  });

  describe('updateReflectionPromptResponse', () => {
    const reflectionPromptId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const dto = { response: 'Updated response text' };

    it('should update and return the reflection prompt response', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      const existingRow = {
        id: reflectionPromptId,
        promptId: '0ee957a5-36d3-49be-886f-a8c72242388e',
        scenarioSessionId: mockScenarioSessionId,
        response: 'old',
      };
      const savedRow = { ...existingRow, response: dto.response };
      scenarioSessionReflectionPromptResponseRepository.findOne.mockResolvedValue(
        existingRow as ScenarioSessionReflectionPromptResponse,
      );
      scenarioSessionReflectionPromptResponseRepository.save.mockResolvedValue(
        savedRow as ScenarioSessionReflectionPromptResponse,
      );

      const result = await service.updateReflectionPromptResponse(
        mockScenarioSessionId,
        reflectionPromptId,
        dto,
      );

      expect(result.response).toBe(dto.response);
      expect(
        scenarioSessionReflectionPromptResponseRepository.save,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ response: dto.response }),
      );
    });

    it('should throw NotFoundException when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateReflectionPromptResponse(
          mockScenarioSessionId,
          reflectionPromptId,
          dto,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(
        scenarioSessionReflectionPromptResponseRepository.findOne,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when reflection prompt not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);
      scenarioSessionReflectionPromptResponseRepository.findOne.mockResolvedValue(
        null,
      );

      await expect(
        service.updateReflectionPromptResponse(
          mockScenarioSessionId,
          reflectionPromptId,
          dto,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(
        scenarioSessionReflectionPromptResponseRepository.save,
      ).not.toHaveBeenCalled();
    });
  });

  describe('previewScenario', () => {
    it('should create preview scenario session successfully', async () => {
      const previewDto = { scenarioId: mockScenarioId, languageId: 1 };
      const mockStateInstructions = [
        {
          stateId: '1',
          name: 'Resistant',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
        },
        {
          stateId: '2',
          name: 'Engaged',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
        },
      ];
      // Expected formatted stateInstructions with score ranges from stateConfig
      const expectedFormattedStateInstructions = [
        {
          stateId: '1',
          name: 'Resistant',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
          scoreUpper: -50,
          scoreLower: undefined,
        },
        {
          stateId: '2',
          name: 'Engaged',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
          scoreUpper: 20,
          scoreLower: -50,
        },
      ];
      const mockScenarioWithMetadata = {
        ...mockScenario,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        status: ScenarioStatus.DRAFT,
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        competencyId: '123e4567-e89b-12d3-a456-426614174000',
        metadata: {
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
          experienceMode: ExperienceMode.FEEDBACK,
          checklistType: ChecklistType.GUIDED,
          timerMode: true,
          maxTimeValue: '1:20:00',
          stateInstructions: mockStateInstructions,
          behaviorInstructions: [],
          characterProfileText: 'Test character profile',
          stateNames: [],
        },
        isGlobal: false,
        isPublic: false,
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
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      scenarioSharedService.createRoomMetadata.mockResolvedValue({
        scenario: {
          ...mockScenarioWithMetadata,
          stateInstructions: expectedFormattedStateInstructions,
        },
      } as any);
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);

      const result = await service.previewScenario(
        previewDto as any,
        mockUserId,
      );

      expect(result.roomName).toMatch(/^preview-\d+-/);
      expect(result.accessToken).toEqual(mockTokenResponse);
      expect(livekitService.createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            scenario: expect.objectContaining({
              stateInstructions: expectedFormattedStateInstructions,
            }),
          }),
        }),
      );
    });
    it('should use default voice ID from languageVoices when not set in metadata', async () => {
      const mockStateInstructions = [
        {
          stateId: '1',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
        },
        {
          stateId: '2',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
        },
      ];
      const scenarioWithoutVoiceId = {
        ...mockScenario,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        competencyId: '123e4567-e89b-12d3-a456-426614174000',
        metadata: {
          voiceId: 'voice-123',
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
          experienceMode: ExperienceMode.FEEDBACK,
          checklistType: ChecklistType.GUIDED,
          timerMode: true,
          maxTimeValue: '1:20:00',
          stateInstructions: mockStateInstructions,
          behaviorInstructions: [],
          characterProfileText: 'Test character profile',
          stateNames: [],
        },
      };

      const mockTokenResponse = {
        token: 'access-token-123',
        roomName: 'preview-room',
        serverUrl: 'https://livekit.example.com',
      };

      const mockPreviewDto = { scenarioId: mockScenarioId, languageId: 1 };

      scenarioService.getAdminScenario.mockResolvedValue(
        scenarioWithoutVoiceId as any,
      );

      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );

      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );

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
        isPublic: false,
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

    it('should throw SimulationCapacityException when at max concurrent simulations', async () => {
      const previewDto = { scenarioId: mockScenarioId };
      const mockValidScenario = {
        ...mockScenario,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        status: ScenarioStatus.ACTIVE,
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        competencyId: '123e4567-e89b-12d3-a456-426614174000',
        metadata: {
          name: 'Test Client',
          age: 25,
          gender: 'female',
          currentLocation: 'New York',
          openingStatements: ['Opening'],
          languageVoices: { 1: 'voice-123' },
          experienceMode: ExperienceMode.FEEDBACK,
          behaviorInstructions: [],
          characterProfileText: 'Test character profile',
          stateNames: [],
          stateInstructions: [{ stateId: '1', instruction: 'Test' }],
        },
        isGlobal: true,
        isPublic: false,
      };

      scenarioService.getAdminScenario.mockResolvedValue(mockValidScenario);
      mockConfigService.simulationConcurrency.maxConcurrentSimulations = 2;
      livekitService.listRooms.mockResolvedValue([
        { name: 'room-1' },
        { name: 'room-2' },
      ] as any);

      await expect(
        service.previewScenario(previewDto as any, mockUserId),
      ).rejects.toThrow(SimulationCapacityException);

      mockConfigService.simulationConcurrency.maxConcurrentSimulations = 100;
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

  describe('previewScenario proactive dispatch', () => {
    const buildPreviewMocks = () => {
      const previewDto = { scenarioId: mockScenarioId, languageId: 1 };
      const mockValidScenario = {
        ...mockScenario,
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/cover.jpg',
        status: ScenarioStatus.ACTIVE,
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        competencyId: '123e4567-e89b-12d3-a456-426614174000',
        metadata: {
          voiceId: 'voice-123',
          languageVoices: { 1: 'voice-123' },
          name: 'Test Client',
          age: 25,
          gender: 'female',
          currentLocation: 'New York',
          context: 'Context',
          openingStatements: ['Hello'],
          experienceMode: ExperienceMode.FEEDBACK,
          stateInstructions: [],
          stateNames: [],
        },
        isGlobal: true,
        isPublic: false,
      };
      scenarioService.getAdminScenario.mockResolvedValue(mockValidScenario);
      scenarioService.getScenarioVoice.mockResolvedValue({
        id: 'voice-123',
        voiceId: 'openai-voice-id',
      } as any);
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventSharedService.findByIds.mockResolvedValue([]);
      scenarioSharedService.createRoomMetadata.mockResolvedValue({
        scenario: mockValidScenario,
      } as any);
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue({
        token: 'tok',
        roomName: 'preview-room',
        serverUrl: 'https://livekit.example.com',
      });
      return { previewDto };
    };

    it('should proactively dispatch the agent on preview start', async () => {
      const { previewDto } = buildPreviewMocks();
      const result = await service.previewScenario(
        previewDto as any,
        mockUserId,
      );

      expect(livekitService.preMarkProactiveDispatch).toHaveBeenCalledWith(
        result.roomName,
      );
      expect(livekitService.agentDispatch).toHaveBeenCalledWith(
        result.roomName,
        'Agent',
        expect.any(String),
      );
    });

    it('should clear the proactive flag when preview dispatch fails', async () => {
      const { previewDto } = buildPreviewMocks();
      livekitService.agentDispatch.mockRejectedValueOnce(
        new Error('preview dispatch failed'),
      );

      const result = await service.previewScenario(
        previewDto as any,
        mockUserId,
      );

      // Wait for the unawaited dispatch promise's .catch handler.
      await new Promise((resolve) => setImmediate(resolve));

      expect(livekitService.clearProactiveDispatch).toHaveBeenCalledWith(
        result.roomName,
      );
    });
  });

  describe('dispatchPreviewAgent idempotency', () => {
    beforeEach(() => {
      mockConfigService.allowDirectAgentDispatch = true;
    });
    afterEach(() => {
      mockConfigService.allowDirectAgentDispatch = false;
    });

    it('should skip dispatch when a proactive dispatch is still pending', async () => {
      livekitService.isProactiveDispatchPending.mockReturnValue(true);

      await service.dispatchPreviewAgent('preview-1-uuid');

      expect(livekitService.listParticipants).not.toHaveBeenCalled();
      expect(livekitService.agentDispatch).not.toHaveBeenCalled();
    });

    it('should skip dispatch when an agent has already joined the room', async () => {
      livekitService.isProactiveDispatchPending.mockReturnValue(false);
      livekitService.listParticipants.mockResolvedValue([
        { kind: ParticipantInfo_Kind.AGENT },
      ] as any);

      await service.dispatchPreviewAgent('preview-1-uuid');

      expect(livekitService.listParticipants).toHaveBeenCalledWith(
        'preview-1-uuid',
      );
      expect(livekitService.agentDispatch).not.toHaveBeenCalled();
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
        isPublic: false,
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
        languageId: 1,
      };
      const mockStateInstructions = [
        {
          stateId: '1',
          name: 'Resistant',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
        },
        {
          stateId: '2',
          name: 'Engaged',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
        },
      ];
      // Expected formatted stateInstructions with score ranges from stateConfig
      const expectedFormattedStateInstructions = [
        {
          stateId: '1',
          name: 'Resistant',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
          scoreUpper: -50,
          scoreLower: undefined,
        },
        {
          stateId: '2',
          name: 'Engaged',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
          scoreUpper: 20,
          scoreLower: -50,
        },
      ];
      const mockScenarioWithMetadata = {
        ...mockScenario,
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        metadata: {
          title: 'Test Scenario',
          description: 'Test Description',
          voiceId: 'test-voice',
          languageVoices: { 1: 'voice-123' },
          stateInstructions: mockStateInstructions,
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
      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioWithMetadata as any,
      );
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice as any);
      scenarioTenantService.getScenarioTenant.mockResolvedValue({
        id: 1,
        scenarioId: mockScenarioId,
        tenantId: mockTenantId,
      } as any);
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventSharedService.findByIds.mockResolvedValue([]);
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        consumedCredits: 0,
        creditLimit: 100,
      } as any);
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockCreatedSession,
      );
      scenarioSharedService.createRoomMetadata.mockResolvedValue({
        scenario: {
          ...mockScenarioWithMetadata,
          stateInstructions: expectedFormattedStateInstructions,
        },
      } as any);
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
          metadata: expect.objectContaining({
            scenario: expect.objectContaining({
              stateInstructions: expectedFormattedStateInstructions,
            }),
          }),
        }),
      );

      // Proactively dispatches the agent at session-create time so it can
      // initialize during the frontend's ringing-bell delay.
      expect(livekitService.preMarkProactiveDispatch).toHaveBeenCalledWith(
        mockCreatedSession.roomId,
      );
      expect(livekitService.agentDispatch).toHaveBeenCalledWith(
        mockCreatedSession.roomId,
        'Agent',
        expect.any(String),
      );
    });

    it('should clear the proactive flag when proactive dispatch fails so the webhook fallback can take over', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
        languageId: 1,
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        difficultyLevel: ScenarioDifficultyLevel.EASY,
        metadata: {
          title: 'Test Scenario',
          description: 'Test Description',
          voiceId: 'test-voice',
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
      scenarioService.getAdminScenario.mockResolvedValue(
        mockScenarioWithMetadata as any,
      );
      scenarioService.getScenarioVoice.mockResolvedValue(mockVoice as any);
      scenarioTenantService.getScenarioTenant.mockResolvedValue({
        id: 1,
        scenarioId: mockScenarioId,
        tenantId: mockTenantId,
      } as any);
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventSharedService.findByIds.mockResolvedValue([]);
      scenarioSessionRepository.getScenarioSessions.mockResolvedValue([]);
      simulationCreditsService.getSimulationCredits.mockResolvedValue({
        consumedCredits: 0,
        creditLimit: 100,
      } as any);
      scenarioSessionRepository.createScenarioSession.mockResolvedValue(
        mockCreatedSession,
      );
      scenarioSharedService.createRoomMetadata.mockResolvedValue({
        scenario: mockScenarioWithMetadata,
      } as any);
      livekitService.createRoom.mockResolvedValue({} as any);
      livekitService.generateAccessToken.mockResolvedValue(mockTokenResponse);
      livekitService.agentDispatch.mockRejectedValue(
        new Error('dispatch failed'),
      );

      await service.startScenarioSession(mockCounselorId, startDto as any);

      // Wait for the unawaited dispatch promise's .catch handler to run.
      await new Promise((resolve) => setImmediate(resolve));

      expect(livekitService.preMarkProactiveDispatch).toHaveBeenCalledWith(
        mockCreatedSession.roomId,
      );
      expect(livekitService.clearProactiveDispatch).toHaveBeenCalledWith(
        mockCreatedSession.roomId,
      );
    });

    it('should clean up session when room creation fails', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
        languageId: 1,
      };
      const mockScenarioWithMetadata = {
        ...mockScenario,
        metadata: {
          voiceId: 'voice-123',
          languageVoices: { 1: 'voice-123' },
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
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        mockSessionEvents,
      );
      sessionEventSharedService.findByIds.mockResolvedValue([]);
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

    it('should throw SimulationCapacityException when at max concurrent simulations', async () => {
      const startDto = {
        scenarioId: mockScenarioId,
        ttl: 3600,
      };

      scenarioService.getAdminScenario.mockResolvedValue(mockScenario as any);
      mockConfigService.simulationConcurrency.maxConcurrentSimulations = 2;
      livekitService.listRooms.mockResolvedValue([
        { name: 'room-1' },
        { name: 'room-2' },
      ] as any);

      await expect(
        service.startScenarioSession(mockCounselorId, startDto as any),
      ).rejects.toThrow(SimulationCapacityException);

      mockConfigService.simulationConcurrency.maxConcurrentSimulations = 100;
    });
  });

  describe('getLanguageDetailsForScenarioSession', () => {
    it('should return language details', async () => {
      scenarioSharedService.getLanguageDetailsForScenarioSession.mockResolvedValue(
        {
          enLanguageDetails: { id: 1, value: 'en' },
          languageDetails: { id: 1, value: 'en' },
        } as any,
      );
      const languageDetails = await (
        service as any
      ).getLanguageDetailsForScenarioSession(mockCounselorId);
      expect(languageDetails).toBeDefined();
    });
    it('should return null languageDetails if languageDetails is not found', async () => {
      const mockReturnData = {
        enLanguageDetails: undefined,
        languageDetails: null,
      };
      scenarioSharedService.getLanguageDetailsForScenarioSession.mockResolvedValue(
        mockReturnData as any,
      );
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
  describe('getScenarioSessionEventChecklist', () => {
    const setupSessionAndScenarioMocks = (experienceMode: ExperienceMode) => {
      permissionValidatorService.validatePermissions.mockResolvedValue(false);
      scenarioSessionRepository.findOne.mockResolvedValue(
        mockScenarioSession as any,
      );
      scenarioSessionFeedbacksRepository.findOne.mockResolvedValue(null);
      reviewSharedService.getReviewByScenarioSessionId.mockResolvedValue(
        null as any,
      );
      scenariosRepository.findOne.mockResolvedValue({
        id: mockScenarioId,
        metadata: { experienceMode },
      } as any);
    };

    it('should return empty checklist when experience mode is not CHECKLIST', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.FEEDBACK);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result).toEqual({ eventChecklist: [] });
      expect(scenarioEventsRepository.getEventChecklist).not.toHaveBeenCalled();
    });

    it('should return empty checklist when experience mode is NONE', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.NONE);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result).toEqual({ eventChecklist: [] });
      expect(scenarioEventsRepository.getEventChecklist).not.toHaveBeenCalled();
    });

    it('should return checklist with hasOccurred=true for events that occurred in the session', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-1',
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [
            {
              id: 'sse-1',
              eventId: 'event-1',
              scenarioSessionId: mockScenarioSessionId,
            },
          ],
        },
      ] as any);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result.eventChecklist).toHaveLength(1);
      expect(result.eventChecklist[0]).toEqual({
        id: 'event-1',
        name: 'Empathy Check',
        hasOccurred: true,
      });
    });

    it('should return checklist with hasOccurred=false for events that did not occur', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-2',
          checklistVisibilityStatus: true,
          events: { id: 'event-2', name: 'Greeting' },
          scenarioSessionEvent: [],
        },
      ] as any);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result.eventChecklist).toHaveLength(1);
      expect(result.eventChecklist[0]).toEqual({
        id: 'event-2',
        name: 'Greeting',
        hasOccurred: false,
      });
    });

    it('should return mixed checklist with both occurred and non-occurred events', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-1',
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [
            {
              id: 'sse-1',
              eventId: 'event-1',
              scenarioSessionId: mockScenarioSessionId,
            },
          ],
        },
        {
          eventId: 'event-2',
          checklistVisibilityStatus: true,
          events: { id: 'event-2', name: 'Greeting' },
          scenarioSessionEvent: [],
        },
        {
          eventId: 'event-3',
          checklistVisibilityStatus: false,
          events: { id: 'event-3', name: 'Unexpected Event' },
          scenarioSessionEvent: [
            {
              id: 'sse-2',
              eventId: 'event-3',
              scenarioSessionId: mockScenarioSessionId,
            },
          ],
        },
      ] as any);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result.eventChecklist).toHaveLength(3);
      expect(result.eventChecklist[0]).toEqual({
        id: 'event-1',
        name: 'Empathy Check',
        hasOccurred: true,
      });
      expect(result.eventChecklist[1]).toEqual({
        id: 'event-2',
        name: 'Greeting',
        hasOccurred: false,
      });
      expect(result.eventChecklist[2]).toEqual({
        id: 'event-3',
        name: 'Unexpected Event',
        hasOccurred: true,
      });
    });

    it('should return empty checklist when no events match the filter criteria', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([]);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(result).toEqual({ eventChecklist: [] });
      expect(scenarioEventsRepository.getEventChecklist).toHaveBeenCalledWith(
        mockScenarioSessionId,
        mockScenarioId,
        {},
      );
    });

    it('should use translated event name when languageCode is provided and translation exists', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-1',
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [{ id: 'sse-1' }],
        },
        {
          eventId: 'event-2',
          checklistVisibilityStatus: true,
          events: { id: 'event-2', name: 'Greeting' },
          scenarioSessionEvent: [],
        },
      ] as any);

      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue({
        id: 5,
        value: 'mr',
      } as any);

      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        [
          { id: 'event-1', name: 'सहानुभूती तपासणी' },
          { id: 'event-2', name: 'अभिवादन' },
        ] as any,
      );

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
        'mr',
      );

      expect(result.eventChecklist).toHaveLength(2);
      expect(result.eventChecklist[0]).toEqual({
        id: 'event-1',
        name: 'सहानुभूती तपासणी',
        hasOccurred: true,
      });
      expect(result.eventChecklist[1]).toEqual({
        id: 'event-2',
        name: 'अभिवादन',
        hasOccurred: false,
      });
      expect(
        sharedLanguageService.getLanguageByLanguageCode,
      ).toHaveBeenCalledWith('mr');
      expect(
        sessionEventTranslationService.getSessionEventsTranslationsByScenarioId,
      ).toHaveBeenCalledWith(mockScenarioId, 5);
    });

    it('should fall back to original name when no translation exists for an event', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-1',
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [],
        },
        {
          eventId: 'event-3',
          checklistVisibilityStatus: true,
          events: { id: 'event-3', name: 'Closing' },
          scenarioSessionEvent: [],
        },
      ] as any);

      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue({
        id: 5,
        value: 'mr',
      } as any);

      // Only event-1 has a translation; event-3 does not
      sessionEventTranslationService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        [{ id: 'event-1', name: 'सहानुभूती तपासणी' }] as any,
      );

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
        'mr',
      );

      expect(result.eventChecklist[0].name).toBe('सहानुभूती तपासणी');
      expect(result.eventChecklist[1].name).toBe('Closing');
    });

    it('should throw BadRequestException when languageCode is provided but language is not found', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([]);

      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(null);

      await expect(
        service.getScenarioSessionEventChecklist(
          mockScenarioSessionId,
          mockCounselorId,
          {},
          'xx',
        ),
      ).rejects.toThrow(new BadRequestException('Language not found'));

      expect(
        sessionEventTranslationService.getSessionEventsTranslationsByScenarioId,
      ).not.toHaveBeenCalled();
    });

    it('should not call translation service when languageCode is not provided', async () => {
      setupSessionAndScenarioMocks(ExperienceMode.CHECKLIST);
      scenarioEventsRepository.getEventChecklist.mockResolvedValue([
        {
          eventId: 'event-1',
          checklistVisibilityStatus: true,
          events: { id: 'event-1', name: 'Empathy Check' },
          scenarioSessionEvent: [],
        },
      ] as any);

      const result = await service.getScenarioSessionEventChecklist(
        mockScenarioSessionId,
        mockCounselorId,
        {},
      );

      expect(
        sharedLanguageService.getLanguageByLanguageCode,
      ).not.toHaveBeenCalled();
      expect(
        sessionEventTranslationService.getSessionEventsTranslationsByScenarioId,
      ).not.toHaveBeenCalled();
      expect(result.eventChecklist[0].name).toBe('Empathy Check');
    });
  });

  describe('isEnglishLanguage', () => {
    // isEnglishLanguage(languageId, languageValue, defaultLanguageId) from scenario.util
    it('should return true when languageId is missing (undefined/null)', () => {
      expect(isEnglishLanguage(undefined, 'fr', 1)).toBe(true);
      expect(isEnglishLanguage(null as any, 'fr', 1)).toBe(true);
    });

    it('should return true when languageId equals defaultLanguageId', () => {
      expect(isEnglishLanguage(1, 'fr', 1)).toBe(true);
      expect(isEnglishLanguage(5, 'custom', 5)).toBe(true);
    });

    it('should return true when languageValue starts with "en-" or equals "en" (case insensitive)', () => {
      expect(isEnglishLanguage(2, 'en', 1)).toBe(true);
      expect(isEnglishLanguage(2, 'en-US', 1)).toBe(true);
      expect(isEnglishLanguage(2, 'EN-GB', 1)).toBe(true);
      expect(isEnglishLanguage(2, 'eN-uk', 1)).toBe(true);
    });

    it('should return false for non-English language codes when IDs do not match', () => {
      expect(isEnglishLanguage(2, 'fr', 1)).toBe(false);
      expect(isEnglishLanguage(2, 'es-ES', 1)).toBe(false);
      expect(isEnglishLanguage(2, 'de', 1)).toBe(false);
    });

    it('should return false when languageValue is empty/invalid and IDs do not match', () => {
      expect(isEnglishLanguage(2, '', 1)).toBe(false);
      expect(isEnglishLanguage(2, undefined, 1)).toBe(false);
    });
  });

  describe('getStateNames', () => {
    it('should return empty array when currentState is false', () => {
      const stateInstructions = service.getStateNames(
        false,
        mockScenario.metadata.stateInstructions,
      );
      expect(stateInstructions).toEqual([]);
    });

    it('should return empty array when stateInstructions is empty', () => {
      const stateInstructions = service.getStateNames(true, []);
      expect(stateInstructions).toEqual([]);
    });

    it('should return stateInstructions when currentState is true and stateInstructions is not empty', () => {
      const stateInstructions = service.getStateNames(
        true,
        mockScenario.metadata?.stateInstructions,
      );
      expect(stateInstructions).toEqual(
        mockScenario.metadata.stateInstructions,
      );
    });
  });

  describe('addTurnMetrics', () => {
    const session = {
      id: 'sess-1',
      tenantId: 'tenant-1',
      roomId: 'ss_room-1',
      scenarioId: 42,
    } as ScenarioSessions;

    const metrics: LearnTurnMetricsData = {
      turn_index: 3,
      invocation_id: 'abc12345',
      response_latency_ms: 1320,
      eou_delay_ms: 180,
      llm_ttft_ms: 300,
      tts_ttfb_ms: 210,
      orchestration_ms: 120,
      llm_response_ms: 640,
      prosody_ms: 70,
      language: 'en-IN',
      llm_model: 'gpt-4o-mini',
      env: 'LOCAL',
      response_chars: 180,
      events_detected: 1,
      prosody_skipped: false,
    };

    let mockRepo: { create: jest.Mock; save: jest.Mock };

    beforeEach(() => {
      mockRepo = {
        create: jest.fn((row) => row),
        save: jest.fn().mockResolvedValue(undefined),
      };
      (dataSource.getRepository as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockRepo);
    });

    it('maps the payload onto a ScenarioSessionTurnMetrics row and saves it', async () => {
      const occurredAt = new Date('2026-06-10T05:00:00.000Z');

      await service.addTurnMetrics(session, metrics, occurredAt);

      expect(dataSource.getRepository).toHaveBeenCalledWith(
        ScenarioSessionTurnMetrics,
      );
      const created = mockRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        scenarioSessionId: 'sess-1',
        tenantId: 'tenant-1',
        roomId: 'ss_room-1',
        turnIndex: 3,
        invocationId: 'abc12345',
        responseLatencyMs: 1320,
        eouDelayMs: 180,
        llmTtftMs: 300,
        ttsTtfbMs: 210,
        orchestrationMs: 120,
        llmResponseMs: 640,
        prosodyMs: 70,
        language: 'en-IN',
        llmModel: 'gpt-4o-mini',
        env: 'LOCAL',
        responseChars: 180,
        eventsDetected: 1,
        prosodySkipped: false,
        scenarioId: 42,
        occurredAt,
      });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
    });

    it('falls back to the session scenarioId when the metric omits it', async () => {
      await service.addTurnMetrics(session, metrics);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.scenarioId).toBe(42); // from session, not the payload
    });

    it('defaults occurredAt to now() when not provided', async () => {
      await service.addTurnMetrics(session, metrics);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.occurredAt).toBeInstanceOf(Date);
    });

    it('defaults flag/count fields when the metric omits them', async () => {
      const sparse: LearnTurnMetricsData = {
        turn_index: 0,
        response_latency_ms: 900,
      };

      await service.addTurnMetrics(session, sparse);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.eventsDetected).toBe(0);
      expect(created.prosodySkipped).toBe(false);
      expect(created.llmTimedOut).toBe(false);
      expect(created.interrupted).toBe(false);
    });
  });
});
