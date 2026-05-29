import { AuditLogService } from 'src/audit/service/audit-log.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { DeleteCoverVideoDto } from 'src/learn/dto/delete-cover-video.dto';
import { ScenarioVideoUploadRequestDto } from 'src/learn/dto/scenario-video-upload-request.dto';
import { ScenarioImageUploadRequestDto } from 'src/learn/dto/scenario-image-upload-request.dto';
import { ScenarioImageUploadContentType } from 'src/learn/enum/scenario-image-upload-content-type.enum';
import { ScenarioVideoUploadContentType } from 'src/learn/enum/scenario-video-upload-content-type';
import { TenantService } from 'src/tenant/service/tenant.service';
import { UpdateScenarioDto } from 'src/learn/dto/update-scenario.dto';
import { CreateScenarioDto } from 'src/learn/dto/create-scenario.dto';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import {
  ScenarioStatus,
  ScenarioDifficultyLevel,
  ExperienceMode,
} from 'src/learn/type/scenario.type';
import { ScenarioEventsRepository } from 'src/learn/repository/scenario-events.repository';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { ScenarioService } from '../scenario.service';
import { ScenarioTranslationNotificationService } from '../scenario-translation-notification.service';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import { TriggerWarningsService } from '../trigger-warnings.service';
import { ScenarioTriggerWarnings } from 'src/learn/entity/scenario-trigger-warnings.entity';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioEventsTranslationsRepository } from 'src/learn/repository/scenario-events-translations.repository';
import { ScenarioTranslationsRepository } from 'src/learn/repository/scenario-translations.repository';
import { ScenarioSharedService } from '../scenario-shared.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { ScenarioReportService } from 'src/scenario-report/service/scenario-report.service';
import { ScenarioBehaviorInstructionService } from '../scenario-behavior-instruction.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';
import { CompetencyService } from '../competency.service';
import { OpenAIAutofillService } from '../openai-autofil-service';
import { AnthropicAutofillService } from '../anthropic-autofill.service';
import { BehaviorService } from '../behavior.service';
import { GeneratableField } from 'src/learn/enum/generatable-field.enum';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TokenUser } from 'src/auth/type/auth.types';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getExecutionId: jest.fn().mockReturnValue('test-execution-id'), // Add this line
    getUserId: jest.fn(),
  },
}));

describe('ScenarioService', () => {
  let service: ScenarioService;
  let repository: jest.Mocked<Repository<Scenarios>>;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let scenarioEventsRepository: jest.Mocked<ScenarioEventsRepository>;
  let sessionEventSharedService: jest.Mocked<SessionEventSharedService>;
  let scenarioVoiceRepository: jest.Mocked<ScenarioVoicesRepository>;
  let tenantService: jest.Mocked<TenantService>;
  let dataSource: jest.Mocked<DataSource>;
  let scenarioPathSharedService: jest.Mocked<ScenarioPathSharedService>;
  let mockS3Service: any;
  let mockConfigService: any;
  let permissionsService: jest.Mocked<PermissionsService>;
  let scenarioTranslationsRepository: jest.Mocked<ScenarioTranslationsRepository>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let triggerWarningsService: jest.Mocked<TriggerWarningsService>;
  let openAIAutofillService: jest.Mocked<OpenAIAutofillService>;
  let anthropicAutofillService: jest.Mocked<AnthropicAutofillService>;
  let behaviorService: jest.Mocked<BehaviorService>;
  let scenarioBehaviorInstructionService: jest.Mocked<ScenarioBehaviorInstructionService>;

  const mockTenantId = 'tenant-123';

  const mockScenario: Scenarios = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test description',
    coverImageUrl: 'https://example.com/cover.jpg',
    coverVideoUrl: null,
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor helping a client with anxiety',
    isGlobal: false,
    metadata: {
      name: 'Test Client',
      age: 30,
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    createdBy: 1,
    updatedBy: 1,
  } as unknown as Scenarios;

  beforeEach(async () => {
    const mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const mockScenariosRepository = {
      getScenarios: jest.fn(),
      getAdminScenarios: jest.fn(),
      getAdminScenarioById: jest.fn(),
      getScenarioById: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn(),
    };

    const mockScenarioEventsRepository = {
      save: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      getScenarioEvents: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      softDelete: jest.fn(),
    };

    const mockSessionEventSharedService = {
      findByIds: jest.fn(),
      findSessionEventById: jest.fn(),
    };

    const mockScenarioVoiceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      getScenarioVoices: jest.fn(),
    };

    const s3CoverImageUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    mockS3Service = {
      generatePresignedUrl: jest.fn(),
      uploadFile: jest.fn(),
      deleteFile: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(true),
      sanitizeFileName: jest.fn((fileName) => fileName),
      getPresignedUrlForImageUpload: jest.fn().mockResolvedValue({
        presignedUrl: 'https://s3.amazonaws.com/presigned',
        imageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/123-test.jpg',
      }),
      deleteS3Image: jest.fn().mockImplementation(async function (
        this: { deleteObject: jest.Mock },
        bucket: string,
        imageUrl: string,
      ) {
        const match = imageUrl?.match(s3CoverImageUrlPattern);
        const key = match ? match[1] : null;
        if (!key) return { success: false };
        try {
          await this.deleteObject({ bucket, key });
          return { success: true };
        } catch {
          return { success: false };
        }
      }),
    };

    mockConfigService = {
      s3: {
        learnMediaPublicBucket: 'test-bucket',
      },
      aws: {
        region: 'us-east-1',
      },
      featureFlag: {
        scenarioCustomFields: true,
      },
      isMockScenarioCoverImageUpload: false,
      mockScenarioCoverImageUrl:
        'https://placehold.co/1920x1080/png?text=Local+dev+cover',
    };

    const mockTenantService = {
      findAll: jest.fn(),
      findById: jest.fn(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn(),
      transaction: jest.fn(),
    };

    const mockScenarioPathSharedService = {
      getScenarioPathItemByScenarioId: jest.fn(),
      getScenarioPathWithScenarios: jest.fn(),
    };

    const mockCaseSharedService = {
      getCaseItemByScenarioId: jest.fn(),
    };

    const mockTriggerWarningsService = {
      getTriggerWarnings: jest.fn(),
      getTriggerWarningsByIds: jest
        .fn()
        .mockImplementation((ids: string[]) =>
          Promise.resolve(ids.map((id) => ({ id }))),
        ),
      createTriggerWarning: jest.fn(),
      getTriggerWarningsByScenarioId: jest.fn(),
      assignTriggerWarningsToScenario: jest.fn(),
      addScenarioTriggerWarnings: jest.fn(),
    };

    const mockScenarioTranslationsRepository = {
      getScenarioTranslationsByScenarioId: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        metadata: { title: 'Prueba' },
      }),
      createScenarioTranslations: jest.fn(),
      updateScenarioTranslations: jest.fn(),
    };

    const mockGoogleTranslationsService = {
      translateObjectToLanguages: jest.fn(),
    };

    const mockSharedLanguageService = {
      getSharedLanguages: jest.fn(),
      getValidLanguages: jest.fn(),
      getLanguagesByIds: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioSharedService = {
      getScenarioByIds: jest.fn(),
      getScenarioSessionById: jest.fn(),
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
      getScenarioVoice: jest.fn(),
      getAdminScenario: jest.fn(),
      getBehaviorInstructionsByScenarioId: jest.fn(),
      hasAllActiveScenarioMandatoryFields: jest.fn().mockReturnValue(true),
    };

    const mockScenarioEventsTranslationsRepository = {
      getScenarioEventsTranslationsByScenarioId: jest.fn(),
      getScenarioEventsTranslationsByScenarioIdEventId: jest.fn(),
      createTranslations: jest.fn(),
      updateTranslations: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    const mockOpenAITranslationsService = {
      translateObjectToLanguages: jest.fn().mockResolvedValue({}),
      translateScenarioData: jest.fn().mockResolvedValue({}),
      isConfigured: jest.fn().mockReturnValue(true),
      getLanguageConfig: jest.fn(),
    };

    const mockScenarioBehaviorInstructionService = {
      validateBehaviorInstructions: jest.fn().mockResolvedValue(undefined),
      createBehaviorInstructions: jest.fn().mockResolvedValue(undefined),
      updateBehaviorInstructions: jest.fn().mockResolvedValue(undefined),
      getBehaviorInstructionsByScenarioId: jest
        .fn()
        .mockResolvedValue(undefined),
    };

    const mockCompetencyService = {
      validateCompetencyId: jest.fn().mockResolvedValue(undefined),
      getCompetency: jest.fn(),
      getCompetencies: jest.fn(),
      createCompetency: jest.fn(),
    };

    const mockOpenAIAutofillService = {
      generateFieldContent: jest.fn(),
      buildBehaviorIdMapping: jest.fn(),
      getAvailableModels: jest.fn().mockResolvedValue([]),
    };

    const mockAnthropicAutofillService = {
      generateFieldContent: jest.fn(),
      buildBehaviorIdMapping: jest.fn(),
      getAvailableModels: jest.fn().mockResolvedValue([]),
    };

    const mockBehaviorService = {
      getBehaviors: jest.fn().mockResolvedValue({ data: [], count: 0 }),
    };

    const mockPermissionsService = {
      isMultiTenantAdmin: jest.fn().mockResolvedValue(false),
    };

    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        ScenarioService,
        {
          provide: getRepositoryToken(Scenarios),
          useValue: mockRepository,
        },
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepository,
        },
        {
          provide: getRepositoryToken(ScenarioEvents),
          useValue: mockScenarioEventsRepository,
        },
        {
          provide: ScenarioVoicesRepository,
          useValue: mockScenarioVoiceRepository,
        },
        {
          provide: SessionEventSharedService,
          useValue: mockSessionEventSharedService,
        },
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ScenarioEventsRepository,
          useValue: mockScenarioEventsRepository,
        },
        {
          provide: ScenarioPathSharedService,
          useValue: mockScenarioPathSharedService,
        },
        {
          provide: CaseSharedService,
          useValue: mockCaseSharedService,
        },
        {
          provide: TriggerWarningsService,
          useValue: mockTriggerWarningsService,
        },
        {
          provide: ScenarioTranslationsRepository,
          useValue: mockScenarioTranslationsRepository,
        },
        {
          provide: GoogleTranslationsService,
          useValue: mockGoogleTranslationsService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: ScenarioEventsTranslationsRepository,
          useValue: mockScenarioEventsTranslationsRepository,
        },
        {
          provide: OpenAITranslationsService,
          useValue: mockOpenAITranslationsService,
        },
        {
          provide: ScenarioReportService,
          useValue: {
            checkForInProgressScenarioReports: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        {
          provide: ScenarioBehaviorInstructionService,
          useValue: mockScenarioBehaviorInstructionService,
        },
        {
          provide: CompetencyService,
          useValue: mockCompetencyService,
        },
        {
          provide: OpenAIAutofillService,
          useValue: mockOpenAIAutofillService,
        },
        {
          provide: AnthropicAutofillService,
          useValue: mockAnthropicAutofillService,
        },
        {
          provide: BehaviorService,
          useValue: mockBehaviorService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: ScenarioTranslationNotificationService,
          useValue: { notifyProgress: jest.fn() },
        },
        {
          provide: PromptSharedService,
          useValue: {
            // Defaults: no prompt found → validateStatesPairing short-circuits.
            // Individual tests can override via spy if they need a hasStates row.
            getPromptsByOptions: jest.fn().mockResolvedValue([]),
            getPromptByCode: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<ScenarioService>(ScenarioService);
    repository = module.get(getRepositoryToken(Scenarios));
    scenariosRepository = module.get(ScenariosRepository);
    scenarioEventsRepository = module.get(ScenarioEventsRepository);
    sessionEventSharedService = module.get(SessionEventSharedService);
    scenarioVoiceRepository = module.get(ScenarioVoicesRepository);
    tenantService = module.get(TenantService);
    dataSource = module.get(DataSource);
    scenarioPathSharedService = module.get(ScenarioPathSharedService);
    scenarioTranslationsRepository = module.get(ScenarioTranslationsRepository);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
    triggerWarningsService = module.get(TriggerWarningsService);
    openAIAutofillService = module.get(OpenAIAutofillService);
    anthropicAutofillService = module.get(AnthropicAutofillService);
    behaviorService = module.get(BehaviorService);
    scenarioBehaviorInstructionService = module.get(
      ScenarioBehaviorInstructionService,
    );
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect(repository).toBeDefined();
      expect(scenariosRepository).toBeDefined();
      expect(scenarioEventsRepository).toBeDefined();
      expect(sessionEventSharedService).toBeDefined();
      expect(scenarioVoiceRepository).toBeDefined();
      expect(tenantService).toBeDefined();
      expect(scenarioPathSharedService).toBeDefined();
    });
  });

  describe('validateUpdateScenario', () => {
    it('should throw BadRequestException when changing to DRAFT and scenario is part of a path', async () => {
      const scenarioId = 1;
      const updateDto: UpdateScenarioDto = {
        status: ScenarioStatus.DRAFT,
        title: 'Updated title',
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        { id: 'path-item-1', scenarioId: 1, scenarioPathId: 'path-1' } as any,
      );

      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(
        'This simulation is part of a Simulation Pathway and can’t be moved to draft. Please publish the changes.',
      );
      expect(
        scenarioPathSharedService.getScenarioPathItemByScenarioId,
      ).toHaveBeenCalledWith(scenarioId);
    });

    it('should throw BadRequestException when changing to ARCHIVED and scenario is part of a path', async () => {
      const scenarioId = 1;
      const updateDto: UpdateScenarioDto = {
        status: ScenarioStatus.ARCHIVED,
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        { id: 'path-item-1', scenarioId: 1 } as any,
      );

      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(
        'This simulation is part of a Simulation Pathway and can’t be moved to draft. Please publish the changes.',
      );
    });

    it('should allow status change to DRAFT when scenario is not part of a path', async () => {
      const scenarioId = 1;
      const updateDto: UpdateScenarioDto = {
        status: ScenarioStatus.DRAFT,
        title: 'Updated title',
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        null,
      );

      const result = await service.validateUpdateScenario(
        scenarioId,
        updateDto,
      );

      expect(result).toEqual(mockScenario);
      expect(
        scenarioPathSharedService.getScenarioPathItemByScenarioId,
      ).toHaveBeenCalledWith(scenarioId);
    });

    it('should throw NotFoundException when scenario does not exist', async () => {
      const scenarioId = 999;
      const updateDto: UpdateScenarioDto = {
        status: ScenarioStatus.DRAFT,
      };

      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAdminScenario', () => {
    it('should throw BadRequestException when scenario is part of a path', async () => {
      const scenarioId = 1;
      const mockScenarioData = { scenario_id: 1 };

      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData as any,
      );
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        { id: 'path-item-1', scenarioId: 1 } as any,
      );

      await expect(service.deleteAdminScenario(scenarioId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteAdminScenario(scenarioId)).rejects.toThrow('');
      expect(
        scenarioPathSharedService.getScenarioPathItemByScenarioId,
      ).toHaveBeenCalledWith(scenarioId);
    });

    it('should successfully delete scenario when not part of a path', async () => {
      const scenarioId = 1;
      const mockScenarioData = { scenario_id: 1 };

      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData as any,
      );
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        null,
      );

      const mockScenariosRepo = {
        softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const mockScenarioEventsRepo = {
        softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const mockScenarioTenantsRepo = {
        softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const mockScenarioTriggerWarningsRepo = {
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) return mockScenariosRepo;
          if (entity === ScenarioEvents) return mockScenarioEventsRepo;
          if (entity === ScenarioTenants) return mockScenarioTenantsRepo;
          if (entity === ScenarioTriggerWarnings)
            return mockScenarioTriggerWarningsRepo;
          return {};
        }),
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(mockEntityManager),
      );

      const result = await service.deleteAdminScenario(scenarioId);

      expect(result).toBe(true);
      expect(mockScenariosRepo.softDelete).toHaveBeenCalledWith(scenarioId);
      expect(mockScenarioEventsRepo.softDelete).toHaveBeenCalledWith({
        scenarioId,
      });
      expect(mockScenarioTenantsRepo.softDelete).toHaveBeenCalledWith({
        scenarioId,
      });
    });

    it('should throw ForbiddenException if multi-tenant admin tries to delete a roleplay they did not create', async () => {
      const scenarioId = 1;
      const mockUser: TokenUser = {
        id: 123,
        username: 'admin',
        tenantId: 'tenant-1',
      };
      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
        isPublic: false,
        createdBy: 456,
      };

      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData as any,
      );
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);

      await expect(
        service.deleteAdminScenario(scenarioId, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getScenarioEvents', () => {
    const scenarioId = 1;
    const mockPagination = { limit: 10, offset: 0 };

    it('should return scenario events with pagination', async () => {
      const mockRepositoryData = {
        data: [
          {
            eventId: 'event-1',
            feedbackStatus: true,
            emoji: '👍',
            message: 'Great job!',
            score: 85,
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
            sessionEvent: {
              name: 'Event 1',
              emoji: '👍',
              message: 'Great job!',
              score: 85,
              branchInstruction: 'Continue with next step',
            },
          },
        ],
        count: 1,
      };

      const expectedTransformedData = {
        data: [
          {
            eventId: 'event-1',
            name: 'Event 1',
            feedbackStatus: true,
            emoji: '👍',
            message: 'Great job!',
            score: 85,
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
        ],
        count: 1,
      };

      const mockScenarioEventsRepository = {
        getScenarioEvents: jest.fn().mockResolvedValue(mockRepositoryData),
      };

      // Replace the scenarioEventsRepository in the service
      (service as any).scenarioEventsRepository = mockScenarioEventsRepository;

      const result = await service.getScenarioEvents(
        scenarioId,
        mockPagination,
      );

      expect(result).toEqual(expectedTransformedData);
      expect(
        mockScenarioEventsRepository.getScenarioEvents,
      ).toHaveBeenCalledWith(scenarioId, mockPagination);
    });

    it('should return scenario events without pagination', async () => {
      const mockRepositoryData = {
        data: [
          {
            eventId: 'event-1',
            feedbackStatus: false,
            emoji: '🎯',
            message: 'Default message',
            score: 15,
            branchingStatus: false,
            branchInstruction: undefined,
            sessionEvent: {
              name: 'Event 1',
              emoji: '🎯',
              message: 'Default message',
              score: 10,
              branchInstruction: 'Default instruction',
            },
          },
        ],
        count: 1,
      };

      const expectedTransformedData = {
        data: [
          {
            eventId: 'event-1',
            name: 'Event 1',
            feedbackStatus: false,
            emoji: '🎯',
            message: 'Default message',
            score: 15,
            branchingStatus: false,
            branchInstruction: 'Default instruction',
          },
        ],
        count: 1,
      };

      const mockScenarioEventsRepository = {
        getScenarioEvents: jest.fn().mockResolvedValue(mockRepositoryData),
      };

      (service as any).scenarioEventsRepository = mockScenarioEventsRepository;

      const result = await service.getScenarioEvents(scenarioId);

      expect(result).toEqual(expectedTransformedData);
      expect(
        mockScenarioEventsRepository.getScenarioEvents,
      ).toHaveBeenCalledWith(scenarioId, undefined);
    });

    it('should handle mixed feedback and branching scenarios', async () => {
      const mockRepositoryData = {
        data: [
          {
            eventId: 'event-1',
            feedbackStatus: true,
            emoji: '👍',
            message: 'Great job!',
            score: 85,
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
            sessionEvent: {
              name: 'Event 1',
              emoji: '👍',
              message: 'Great job!',
              score: 85,
              branchInstruction: 'Continue with next step',
            },
          },
          {
            eventId: 'event-2',
            feedbackStatus: false,
            emoji: undefined,
            message: undefined,
            score: 10,
            branchingStatus: false,
            branchInstruction: undefined,
            sessionEvent: {
              name: 'Event 2',
              emoji: '🎯',
              message: 'Default message',
              score: 10,
              branchInstruction: 'Default instruction',
            },
          },
        ],
        count: 2,
      };

      const expectedTransformedData = {
        data: [
          {
            eventId: 'event-1',
            name: 'Event 1',
            feedbackStatus: true,
            emoji: '👍',
            message: 'Great job!',
            score: 85,
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
          {
            eventId: 'event-2',
            name: 'Event 2',
            feedbackStatus: false,
            emoji: '🎯',
            message: 'Default message',
            score: 10,
            branchingStatus: false,
            branchInstruction: 'Default instruction',
          },
        ],
        count: 2,
      };

      const mockScenarioEventsRepository = {
        getScenarioEvents: jest.fn().mockResolvedValue(mockRepositoryData),
      };

      (service as any).scenarioEventsRepository = mockScenarioEventsRepository;

      const result = await service.getScenarioEvents(scenarioId);

      expect(result).toEqual(expectedTransformedData);
    });

    it('should handle empty events', async () => {
      const mockEvents = { data: [], count: 0 };

      const mockScenarioEventsRepository = {
        getScenarioEvents: jest.fn().mockResolvedValue(mockEvents),
      };

      (service as any).scenarioEventsRepository = mockScenarioEventsRepository;

      const result = await service.getScenarioEvents(scenarioId);

      expect(result).toEqual(mockEvents);
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      const mockScenarioEventsRepository = {
        getScenarioEvents: jest.fn().mockRejectedValue(error),
      };

      (service as any).scenarioEventsRepository = mockScenarioEventsRepository;

      await expect(service.getScenarioEvents(scenarioId)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('deleteCoverImage', () => {
    let mockConfigService: any;
    let mockS3Service: any;
    let mockLogger: any;

    beforeEach(() => {
      mockConfigService = (service as any).configService;
      mockS3Service = (service as any).s3Service;
      mockLogger = (service as any).logger;

      mockConfigService.s3 = {
        learnMediaPublicBucket: 'test-bucket',
      };
      mockConfigService.isMockScenarioCoverImageUpload = false;

      mockS3Service.deleteObject = jest.fn().mockResolvedValue(true);
      mockLogger.warn = jest.fn();
      mockLogger.error = jest.fn();
    });

    it('should skip S3 when mock cover image upload is enabled', async () => {
      mockConfigService.isMockScenarioCoverImageUpload = true;
      const result = await service.deleteCoverImage({
        coverImageUrl: 'https://example.com/any.png',
      });
      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should successfully delete cover image and return { success: true }', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/12345-test.jpg',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-images/12345-test.jpg',
      });
    });

    it('should throw error when S3 bucket is not defined', async () => {
      mockConfigService.s3.learnMediaPublicBucket = undefined;

      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/12345-test.jpg',
      };

      await expect(
        service.deleteCoverImage(deleteCoverImageDto),
      ).rejects.toThrow(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    });

    it('should return { success: false } and log warning for invalid S3 URL format', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: 'https://invalid-url.com/test.jpg',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should return { success: false } and log warning for malformed S3 URL', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: 'not-a-valid-url',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
    });

    it('should return { success: false } and log error when S3 deletion fails', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/12345-test.jpg',
      };

      const s3Error = new Error('S3 deletion failed');
      mockS3Service.deleteObject.mockRejectedValue(s3Error);

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-images/12345-test.jpg',
      });
    });

    it('should handle different S3 URL formats correctly', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://another-bucket.s3.eu-west-1.amazonaws.com/images/photo.png',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'images/photo.png',
      });
    });

    it('should extract storage key correctly from S3 URL with nested paths', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/subfolder/12345-test.jpg',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-images/subfolder/12345-test.jpg',
      });
    });

    it('should return { success: false } for empty cover image URL', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: '',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
    });

    it('should handle S3 URL with special characters in key', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/test%20image%20(1).jpg',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-images/test%20image%20(1).jpg',
      });
    });

    it('should log error with stringified error object', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/12345-test.jpg',
      };

      const s3Error = { code: 'NoSuchKey', message: 'Key not found' };
      mockS3Service.deleteObject.mockRejectedValue(s3Error);

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
    });

    it('should return { success: false } for S3 URL without storage key', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: 'https://test-bucket.s3.us-east-1.amazonaws.com/',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
    });

    it('should handle bucket name mismatch gracefully', async () => {
      const deleteCoverImageDto = {
        coverImageUrl:
          'https://different-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/test.jpg',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket', // Uses configured bucket, not URL bucket
        key: 'scenario-cover-images/test.jpg',
      });
    });
  });
  describe('getPresignedUrlForScenarioCoverVideo', () => {
    let mockConfigService: any;
    let mockS3Service: any;

    beforeEach(() => {
      mockConfigService = (service as any).configService;
      mockS3Service = (service as any).s3Service;

      mockConfigService.s3 = {
        learnMediaPublicBucket: 'test-bucket',
      };
      mockConfigService.aws = {
        region: 'us-east-1',
      };

      mockS3Service.sanitizeFileName = jest.fn((fileName) => fileName);
      mockS3Service.generatePresignedUrl = jest
        .fn()
        .mockResolvedValue('https://presigned-url.com');
    });

    it('should generate presigned URL for valid video upload', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.mp4',
        fileSize: 5 * 1024 * 1024, // 5 MB
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 8,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverVideo(requestDto);

      expect(result).toEqual({
        presignedUrl: 'https://presigned-url.com',
        coverVideoUrl: expect.stringMatching(
          /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-videos\/\d+-test-video\.mp4$/,
        ),
      });
      expect(mockS3Service.sanitizeFileName).toHaveBeenCalledWith(
        'test-video.mp4',
      );
      expect(mockS3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'test-bucket',
          operation: 'put',
          expiresIn: 600,
          contentType: ScenarioVideoUploadContentType.MP4,
        }),
      );
    });

    it('should throw error when S3 bucket is not defined', async () => {
      mockConfigService.s3.learnMediaPublicBucket = undefined;

      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.mp4',
        fileSize: 1024,
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 5,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    });

    it('should throw BadRequestException for invalid content type', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.avi',
        fileSize: 1024 * 1024,
        contentType: 'video/avi' as any,
        duration: 5,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow('Invalid file type');
    });

    it('should throw BadRequestException when file size exceeds limit', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'large-video.mp4',
        fileSize: 100 * 1024 * 1024, // 100 MB
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 10,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(/File size must be less than/);
    });

    it('should throw BadRequestException when duration exceeds limit', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'long-video.mp4',
        fileSize: 5 * 1024 * 1024,
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 120, // Assuming limit is less than 120
      };

      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverVideo(requestDto),
      ).rejects.toThrow(/File duration must be less than/);
    });

    it('should handle MOV content type', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.mov',
        fileSize: 5 * 1024 * 1024,
        contentType: ScenarioVideoUploadContentType.MOV,
        duration: 8,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverVideo(requestDto);

      expect(result).toEqual({
        presignedUrl: 'https://presigned-url.com',
        coverVideoUrl: expect.stringMatching(
          /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-videos\/\d+-test-video\.mov$/,
        ),
      });
      expect(mockS3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: ScenarioVideoUploadContentType.MOV,
        }),
      );
    });

    it('should handle WEBM content type', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test-video.webm',
        fileSize: 5 * 1024 * 1024,
        contentType: ScenarioVideoUploadContentType.WEBM,
        duration: 8,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverVideo(requestDto);

      expect(result).toEqual({
        presignedUrl: 'https://presigned-url.com',
        coverVideoUrl: expect.stringMatching(
          /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-videos\/\d+-test-video\.webm$/,
        ),
      });
      expect(mockS3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: ScenarioVideoUploadContentType.WEBM,
        }),
      );
    });

    it('should sanitize file name before generating URL', async () => {
      const requestDto: ScenarioVideoUploadRequestDto = {
        fileName: 'test video with spaces.mp4',
        fileSize: 5 * 1024 * 1024,
        contentType: ScenarioVideoUploadContentType.MP4,
        duration: 8,
      };

      mockS3Service.sanitizeFileName.mockReturnValue(
        'test_video_with_spaces.mp4',
      );

      await service.getPresignedUrlForScenarioCoverVideo(requestDto);

      expect(mockS3Service.sanitizeFileName).toHaveBeenCalledWith(
        'test video with spaces.mp4',
      );
    });
  });

  describe('deleteCoverVideo', () => {
    let mockConfigService: any;
    let mockS3Service: any;
    let mockLogger: any;

    beforeEach(() => {
      mockConfigService = (service as any).configService;
      mockS3Service = (service as any).s3Service;
      mockLogger = (service as any).logger;

      mockConfigService.s3 = {
        learnMediaPublicBucket: 'test-bucket',
      };

      mockS3Service.deleteObject = jest.fn().mockResolvedValue(true);
      mockLogger.warn = jest.fn();
      mockLogger.error = jest.fn();
    });

    it('should successfully delete cover video and return { success: true }', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/12345-test.mp4',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-videos/12345-test.mp4',
      });
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should throw error when S3 bucket is not defined', async () => {
      mockConfigService.s3.learnMediaPublicBucket = undefined;

      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/12345-test.mp4',
      };

      await expect(
        service.deleteCoverVideo(deleteCoverVideoDto),
      ).rejects.toThrow(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    });

    it('should return { success: false } and log warning for invalid S3 URL format', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl: 'https://invalid-url.com/test.mp4',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: https://invalid-url.com/test.mp4',
      );
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should return { success: false } and log warning for malformed S3 URL', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl: 'not-a-valid-url',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: not-a-valid-url',
      );
    });

    it('should return { success: false } and log error when S3 deletion fails', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/12345-test.mp4',
      };

      const s3Error = new Error('S3 deletion failed');
      mockS3Service.deleteObject.mockRejectedValue(s3Error);

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to delete uploaded cover video with error',
        ),
      );
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-videos/12345-test.mp4',
      });
    });

    it('should handle different S3 URL formats correctly', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://another-bucket.s3.eu-west-1.amazonaws.com/videos/video.webm',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'videos/video.webm',
      });
    });

    it('should extract storage key correctly from S3 URL with nested paths', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/subfolder/12345-test.mov',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-videos/subfolder/12345-test.mov',
      });
    });

    it('should return { success: false } for empty cover video URL', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl: '',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: ',
      );
    });

    it('should handle S3 URL with special characters in key', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/test%20video%20(1).mp4',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'scenario-cover-videos/test%20video%20(1).mp4',
      });
    });

    it('should log error with stringified error object', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/12345-test.mp4',
      };

      const s3Error = { code: 'NoSuchKey', message: 'Key not found' };
      mockS3Service.deleteObject.mockRejectedValue(s3Error);

      await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to delete uploaded cover video with error ${JSON.stringify(s3Error)}`,
      );
    });

    it('should return { success: false } for S3 URL without storage key', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl: 'https://test-bucket.s3.us-east-1.amazonaws.com/',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle bucket name mismatch gracefully', async () => {
      const deleteCoverVideoDto: DeleteCoverVideoDto = {
        coverVideoUrl:
          'https://different-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/test.mp4',
      };

      const result = await service.deleteCoverVideo(deleteCoverVideoDto);

      expect(result).toEqual({ success: true });
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-bucket', // Uses configured bucket, not URL bucket
        key: 'scenario-cover-videos/test.mp4',
      });
    });
  });

  describe('getScenarios', () => {
    it('should return list of active and coming soon scenarios', async () => {
      const mockScenarios = [
        { ...mockScenario, status: ScenarioStatus.ACTIVE },
        { ...mockScenario, id: 2, status: ScenarioStatus.COMING_SOON },
      ];
      scenariosRepository.getScenarios.mockResolvedValue({
        data: mockScenarios,
        count: mockScenarios.length,
      });

      const result = await service.getScenarios();

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.getScenarios).toHaveBeenCalled();
    });

    it('should return empty array when no scenarios found', async () => {
      scenariosRepository.getScenarios.mockResolvedValue({
        data: [],
        count: 0,
      });

      const result = await service.getScenarios();

      expect(result).toEqual([]);
      expect(scenariosRepository.getScenarios).toHaveBeenCalled();
    });
  });

  describe('getPublicScenarios', () => {
    it('should return paginated public scenarios', async () => {
      const mockScenarios = [
        { ...mockScenario, status: ScenarioStatus.ACTIVE },
      ];
      const mockResponse = {
        data: mockScenarios,
        count: mockScenarios.length,
      };
      scenariosRepository.getScenarios.mockResolvedValue(mockResponse);

      const result = await service.getPublicScenarios();

      expect(result).toEqual(mockResponse);
      expect(scenariosRepository.getScenarios).toHaveBeenCalled();
    });
  });

  describe('getScenariosV2', () => {
    it('should return paginated scenarios filtered by tenant', async () => {
      const mockScenarios = [
        {
          ...mockScenario,
          status: ScenarioStatus.ACTIVE,
          metadata: {
            ...mockScenario.metadata,
            languageVoices: {
              '1': ['voice-1'],
              '2': ['voice-2'],
            },
          },
        },
      ];
      const mockResponse = {
        data: mockScenarios,
        count: mockScenarios.length,
      };
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        { id: 1, label: 'English (India)', value: 'en-IN' },
        { id: 2, label: 'Spanish (Argentina)', value: 'es-AR' },
      ] as any);
      scenariosRepository.getScenarios.mockResolvedValue(mockResponse);

      const result = await service.getScenariosV2();

      expect(result).toEqual({
        data: [
          expect.objectContaining({
            availableLanguages: [
              {
                language_id: 1,
                label: 'English (India)',
                value: 'en-IN',
              },
              {
                language_id: 2,
                label: 'Spanish (Argentina)',
                value: 'es-AR',
              },
            ],
          }),
        ],
        count: mockScenarios.length,
      });
      expect(scenariosRepository.getScenarios).toHaveBeenCalledWith({
        tenantId: mockTenantId,
      });
      expect(sharedLanguageService.getLanguagesByIds).toHaveBeenCalledWith([
        1, 2,
      ]);
    });

    it('should apply translations when languageCode is provided', async () => {
      const mockScenarios = [
        {
          ...mockScenario,
          status: ScenarioStatus.ACTIVE,
          metadata: {
            ...mockScenario.metadata,
            languageVoices: {
              '2': ['voice-2'],
            },
          },
          translations: { mr: { title: 'Marathi Title' } },
        },
      ];
      const mockResponse = {
        data: mockScenarios,
        count: mockScenarios.length,
      };
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        { id: 2, label: 'Marathi', value: 'mr-IN' },
      ] as any);
      scenariosRepository.getScenarios.mockResolvedValue(mockResponse as any);

      const result = await service.getScenariosV2('mr');

      expect(result.data[0].title).toEqual('Marathi Title');
      expect((result.data[0] as any).availableLanguages).toEqual([
        {
          language_id: 2,
          label: 'Marathi',
          value: 'mr-IN',
        },
      ]);
      expect((result.data[0] as any).translations).toBeUndefined();
      expect(scenariosRepository.getScenarios).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        languageCode: 'mr',
      });
    });

    it('should throw BadRequestException when tenantId is not available', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);

      await expect(service.getScenariosV2()).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getScenariosV2()).rejects.toThrow(
        'Tenant ID is required',
      );
    });
  });

  describe('getAdminScenarios', () => {
    it('should return admin scenarios with filters', async () => {
      const mockAdminScenarios = [
        {
          scenario_id: 1,
          scenario_title: 'Test',
          scenario_createdAt: new Date(),
          scenario_updatedAt: new Date(),
          scenario_scenario: 'content',
          scenario_description: 'desc',
          scenario_coverImageUrl: null,
          scenario_coverVideoUrl: null,
          user_name: 'Admin',
          scenario_status: ScenarioStatus.ACTIVE,
          usage: 5,
          isAssignedToTenant: true,
          scenario_metadata: {
            name: 'Test',
            age: 30,
            gender: 'male',
            currentLocation: 'NY',
            context: 'context',
            openingStatements: ['hi'],
          },
          scenario_prompt: 'prompt',
        },
      ];
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockAdminScenarios as any,
      );

      const result = await service.getAdminScenarios(
        { status: ScenarioStatus.ACTIVE },
        { offset: 0, limit: 10 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('isPreviewEnabled');
    });

    it('should pass isMultiTenantAdmin and userId filters for multi-tenant admin', async () => {
      const mockUser: TokenUser = {
        id: 123,
        username: 'admin',
        tenantId: 'tenant-1',
      };
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      scenariosRepository.getAdminScenarios.mockResolvedValue([]);

      await service.getAdminScenarios({}, {}, mockUser);

      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        expect.objectContaining({
          isMultiTenantAdmin: true,
          userId: 123,
        }),
        expect.anything(),
      );
    });

    it('should throw NotFoundException when tenant not found', async () => {
      tenantService.findById.mockResolvedValue(null);

      await expect(
        service.getAdminScenarios({ tenantId: 'invalid' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getAdminScenarios({ tenantId: 'invalid' }),
      ).rejects.toThrow('Tenant not found');
    });
  });

  describe('getScenario', () => {
    it('should return scenario when found', async () => {
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);

      const result = await service.getScenario(1);

      expect(result).toEqual(mockScenario);
    });

    it('should apply translations when languageCode is provided', async () => {
      const scenarioWithTranslations = {
        ...mockScenario,
        translations: { mr: { title: 'Marathi Title' } },
      };
      scenariosRepository.getScenarioById.mockResolvedValue(
        scenarioWithTranslations as any,
      );

      const result = await service.getScenario(1, undefined, 'mr');

      expect(result.title).toEqual('Marathi Title');
      expect((result as any).translations).toBeUndefined();
      expect(scenariosRepository.getScenarioById).toHaveBeenCalledWith(1, {
        languageCode: 'mr',
      });
    });

    it('should throw NotFoundException when scenario not found', async () => {
      scenariosRepository.getScenarioById.mockResolvedValue(null);

      await expect(service.getScenario(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAdminScenario', () => {
    it('should throw NotFoundException when scenario not found', async () => {
      scenarioSharedService.getAdminScenario.mockRejectedValue(
        new NotFoundException('Scenario not found'),
      );

      await expect(service.getAdminScenario(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return scenario with behavior instructions when they exist', async () => {
      const scenarioId = 1;

      const mockBehaviorInstructions = [
        {
          id: 'instruction-1',
          category: BehaviorInstructionCategory.SHOULD_DO,
          stateInstructions: [
            { stateId: '1', instruction: 'Listen actively' },
            { stateId: '2', instruction: 'Show empathy' },
          ],
          behaviors: [
            {
              id: 'behavior-1',
              name: 'Active Listening',
            },
            {
              id: 'behavior-2',
              name: 'Empathy',
            },
          ],
        },
        {
          id: 'instruction-2',
          category: BehaviorInstructionCategory.SHOULD_NOT_DO,
          stateInstructions: [
            { stateId: '1', instruction: 'Interrupt the client' },
          ],
          behaviors: [
            {
              id: 'behavior-3',
              name: 'Patience',
            },
          ],
        },
      ];

      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
        behaviorInstructions: mockBehaviorInstructions,
      };

      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData,
      );

      const result = await service.getAdminScenario(scenarioId);

      expect(result.id).toBe(scenarioId);
      expect(result.behaviorInstructions).toEqual(mockBehaviorInstructions);
      expect(scenarioSharedService.getAdminScenario).toHaveBeenCalledWith(
        scenarioId,
      );
    });

    it('should throw ForbiddenException if multi-tenant admin tries to view a private roleplay they did not create', async () => {
      const scenarioId = 1;
      const mockUser: TokenUser = {
        id: 123,
        username: 'admin',
        tenantId: 'tenant-1',
      };
      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
        isPublic: false,
        createdBy: 456, // Different user
      };

      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData as any,
      );

      await expect(
        service.getAdminScenario(scenarioId, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow multi-tenant admin to view their own private roleplay', async () => {
      const scenarioId = 1;
      const mockUser: TokenUser = {
        id: 123,
        username: 'admin',
        tenantId: 'tenant-1',
      };
      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
        isPublic: false,
        createdBy: 123, // Same user
      };

      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);
      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData as any,
      );

      const result = await service.getAdminScenario(scenarioId, mockUser);
      expect(result).toBeDefined();
    });

    it('should return scenario without behavior instructions when they do not exist', async () => {
      const scenarioId = 1;
      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
      };

      scenarioSharedService.getAdminScenario.mockResolvedValue(
        mockScenarioData,
      );

      const result = await service.getAdminScenario(scenarioId);

      expect(result.id).toBe(scenarioId);
      expect(result.behaviorInstructions).toBeUndefined();
      expect(scenarioSharedService.getAdminScenario).toHaveBeenCalledWith(
        scenarioId,
      );
    });
  });

  describe('getPresignedUrlForScenarioCoverImage', () => {
    it('should generate presigned URL for valid image upload', async () => {
      const requestDto: ScenarioImageUploadRequestDto = {
        fileName: 'test.jpg',
        fileSize: 1024 * 1024, // 1MB
        contentType: ScenarioImageUploadContentType.JPEG,
      };
      const mockPresignedUrl = 'https://s3.amazonaws.com/presigned';
      const mockImageUrl =
        'https://test-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/123-test.jpg';
      mockS3Service.getPresignedUrlForImageUpload.mockResolvedValue({
        presignedUrl: mockPresignedUrl,
        imageUrl: mockImageUrl,
      });

      const result =
        await service.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result.presignedUrl).toBe(mockPresignedUrl);
      expect(result.coverImageUrl).toBe(mockImageUrl);
      expect(mockS3Service.getPresignedUrlForImageUpload).toHaveBeenCalledWith(
        'test-bucket',
        'scenario-cover-images',
        requestDto.fileName,
        requestDto.fileSize,
        requestDto.contentType,
      );
    });

    it('should throw BadRequestException for invalid file type', async () => {
      const requestDto: ScenarioImageUploadRequestDto = {
        fileName: 'test.txt',
        fileSize: 1024,
        contentType: 'text/plain' as ScenarioImageUploadContentType,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('Invalid file type');
    });

    it('should throw BadRequestException when file size exceeds limit', async () => {
      const requestDto: ScenarioImageUploadRequestDto = {
        fileName: 'test.jpg',
        fileSize: 3 * 1024 * 1024, // 3MB (exceeds 2MB limit)
        contentType: ScenarioImageUploadContentType.JPEG,
      };
      mockS3Service.getPresignedUrlForImageUpload.mockRejectedValue(
        new BadRequestException('File size must be less than 2 MB'),
      );

      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('File size must be less than 2 MB');
    });

    it('should return placeholder URL and skip S3 when mock cover upload is enabled', async () => {
      mockConfigService.isMockScenarioCoverImageUpload = true;
      mockConfigService.mockScenarioCoverImageUrl =
        'https://example.com/mock-cover.png';

      const requestDto: ScenarioImageUploadRequestDto = {
        fileName: 'test.jpg',
        fileSize: 1024,
        contentType: ScenarioImageUploadContentType.JPEG,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result.presignedUrl).toBe('');
      expect(result.coverImageUrl).toBe('https://example.com/mock-cover.png');
      expect(
        mockS3Service.getPresignedUrlForImageUpload,
      ).not.toHaveBeenCalled();

      mockConfigService.isMockScenarioCoverImageUpload = false;
    });
  });

  describe('getScenarioVoices', () => {
    it('should return scenario voices', async () => {
      const mockVoices = [
        { id: 'voice-1', name: 'Voice 1' },
        { id: 'voice-2', name: 'Voice 2' },
      ];
      scenarioVoiceRepository.getScenarioVoices.mockResolvedValue(
        mockVoices as any,
      );

      const result = await service.getScenarioVoices('', '', '', {
        offset: 0,
        limit: 10,
      });

      expect(result).toEqual(mockVoices);
    });
  });

  describe('getScenarioVoice', () => {
    it('should return scenario voice when found', async () => {
      const mockVoice = { id: 'voice-1', name: 'Test Voice' };
      scenarioSharedService.getScenarioVoice.mockResolvedValue(
        mockVoice as any,
      );

      const result = await service.getScenarioVoice('voice-1');

      expect(result).toEqual(mockVoice);
      expect(scenarioSharedService.getScenarioVoice).toHaveBeenCalledWith(
        'voice-1',
      );
    });

    it('should throw NotFoundException when voice not found', async () => {
      scenarioSharedService.getScenarioVoice.mockRejectedValue(
        new NotFoundException('Scenario voice not found'),
      );

      await expect(service.getScenarioVoice('invalid')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenarioVoice('invalid')).rejects.toThrow(
        'Scenario voice not found',
      );
    });
  });

  describe('createScenarioVoices', () => {
    it('should create multiple scenario voices', async () => {
      const createDto = {
        voices: [
          { id: 'voice-1', name: 'Voice 1' },
          { id: 'voice-2', name: 'Voice 2' },
        ],
      };
      scenarioVoiceRepository.create.mockReturnValue(createDto.voices as any);
      scenarioVoiceRepository.save.mockResolvedValue(createDto.voices as any);

      const result = await service.createScenarioVoices(createDto as any);

      expect(result).toEqual(createDto.voices);
      expect(scenarioVoiceRepository.save).toHaveBeenCalled();
    });
  });

  describe('updateScenarioVoice', () => {
    it('should update scenario voice successfully', async () => {
      const mockVoice = { id: 'voice-1', name: 'Old Name' };
      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenarioVoiceRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateScenarioVoice('voice-1', {
        name: 'New Name',
      } as any);

      expect(result).toBe(true);
    });

    it('should return false when update affects no rows', async () => {
      const mockVoice = { id: 'voice-1', name: 'Test' };
      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenarioVoiceRepository.update.mockResolvedValue({ affected: 0 } as any);

      const result = await service.updateScenarioVoice('voice-1', {
        name: 'New Name',
      } as any);

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when voice not found', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenarioVoice('invalid', { name: 'Test' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteScenarioEvents', () => {
    it('should delete scenario events successfully', async () => {
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 2 } as any);

      const result = await service.deleteScenarioEvents({
        scenarioId: 1,
        eventIds: ['event-1', 'event-2'],
      });

      expect(result).toBe(2);
    });

    it('should throw BadRequestException when eventIds array is empty', async () => {
      await expect(
        service.deleteScenarioEvents({ scenarioId: 1, eventIds: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.deleteScenarioEvents({ scenarioId: 1, eventIds: [] }),
      ).rejects.toThrow('Event IDs array cannot be empty');
    });

    it('should throw BadRequestException when no events found to delete', async () => {
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 0 } as any);

      await expect(
        service.deleteScenarioEvents({
          scenarioId: 1,
          eventIds: ['event-1'],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.deleteScenarioEvents({
          scenarioId: 1,
          eventIds: ['event-1'],
        }),
      ).rejects.toThrow('No scenario events found to delete');
    });
  });

  describe('mapEventsToScenario', () => {
    it('should map events to scenario successfully', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            feedbackStatus: true,
            score: 10,
            emoji: '😊',
            message: 'Great!',
            branchingStatus: false,
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          save: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null), // Event not already mapped
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.mapEventsToScenario(createDto as any);

      expect(result).toHaveProperty('scenarioId', 1);
      expect(result).toHaveProperty('events');
    });

    it('should throw BadRequestException when events array is empty', async () => {
      await expect(
        service.mapEventsToScenario({ scenarioId: 1, events: [] } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario({ scenarioId: 1, events: [] } as any),
      ).rejects.toThrow('Events array cannot be empty');
    });

    it('should throw BadRequestException when invalid event IDs provided', async () => {
      const createDto = {
        scenarioId: 1,
        events: [{ id: 'invalid-event' }],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([]);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Invalid event IDs: invalid-event');
    });

    it('should throw BadRequestException when detectionConfig startTime is null', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            detectionConfig: {
              startTime: null,
            },
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Start time cannot be null');
    });

    it('should throw BadRequestException when startTime is greater than endTime', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            detectionConfig: {
              startTime: 100,
              endTime: 50,
            },
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Start time cannot be greater than end time');
    });

    it('should throw BadRequestException when minGapTime is less than 0', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            detectionConfig: {
              minGapTime: -5,
            },
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Minimum gap time cannot be less than 0');
    });

    it('should throw BadRequestException when maxOccurrences is less than 0', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            detectionConfig: {
              maxOccurrences: -1,
            },
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Maximum occurrences cannot be less than 0');
    });

    it('should throw BadRequestException when minScore is greater than maxScore', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            detectionConfig: {
              minScore: 90,
              maxScore: 50,
            },
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow('Minimum score cannot be greater than maximum score');
    });

    it('should throw NotFoundException when scenario not found', async () => {
      const createDto = {
        scenarioId: 999,
        events: [{ id: 'event-1' }],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(null);

      await expect(
        service.mapEventsToScenario(createDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use existing scenarioEvent values when event already mapped', async () => {
      const createDto = {
        scenarioId: 1,
        events: [
          {
            id: 'event-1',
            feedbackStatus: true,
            score: 10,
            emoji: '😊',
            message: 'Great!',
            branchingStatus: false,
          },
        ],
      };
      scenariosRepository.getScenarioById.mockResolvedValue(mockScenario);
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
      ] as any);
      const existingScenarioEvent = {
        id: 1,
        scenarioId: 1,
        eventId: 'event-1',
        score: 5, // existing score
        detectionConfig: { startTime: 10 }, // existing config
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          save: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(existingScenarioEvent),
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.mapEventsToScenario(createDto as any);

      expect(result).toHaveProperty('scenarioId', 1);
      expect(result).toHaveProperty('events');
    });
  });

  describe('validateCreateScenario', () => {
    it('should validate scenario successfully', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        languageVoices: { '1': 'voice-1' },
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        profession: 'Doctor',
        optGuardrails: true,
        currentState: true,
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });

    it('should throw error when a language voice is not found', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        optGuardrails: true,
        currentState: true,
        languageVoices: { '1': 'invalid-voice' },
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        profession: 'Doctor',
        openingStatements: ['Hi'],
      };
      scenarioSharedService.getScenarioVoice.mockRejectedValue(
        new NotFoundException('Scenario voice not found'),
      );

      await expect(service.validateCreateScenario(createDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not throw when ACTIVE scenario omits prompt', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.ACTIVE,
        isGlobal: false,
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        coverImageUrl: 'https://img.png',
        difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
        experienceMode: ExperienceMode.FEEDBACK,
        competencyId: '1',
        stateNames: [{ stateId: '1', name: 'state1' }],
        profession: 'Doctor',
        languageVoices: { '1': 'voice-1' },
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });

    it('should not throw when ACTIVE scenario omits characterProfileText', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.ACTIVE,
        isGlobal: false,
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        coverImageUrl: 'https://img.png',
        difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
        experienceMode: ExperienceMode.FEEDBACK,
        competencyId: '1',
        stateNames: [{ stateId: '1', name: 'state1' }],
        profession: 'Doctor',
        languageVoices: { '1': 'voice-1' },
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });

    it('should not throw when ACTIVE scenario omits behaviorInstructions', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.ACTIVE,
        isGlobal: false,
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        coverImageUrl: 'https://img.png',
        difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
        experienceMode: ExperienceMode.FEEDBACK,
        competencyId: '1',
        stateNames: [{ stateId: '1', name: 'state1' }],
        profession: 'Doctor',
        languageVoices: { '1': 'voice-1' },
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });

    it('should not throw when ACTIVE scenario omits linguisticStyleSamples', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.ACTIVE,
        isGlobal: false,
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        coverImageUrl: 'https://img.png',
        difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
        experienceMode: ExperienceMode.FEEDBACK,
        competencyId: '1',
        stateNames: [{ stateId: '1', name: 'state1' }],
        profession: 'Doctor',
        languageVoices: { '1': 'voice-1' },
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });

    it('should not throw when ACTIVE scenario has linguisticStyleSamples for only some languages', async () => {
      const createDto: CreateScenarioDto = {
        title: 'Test',
        description: 'Desc',
        status: ScenarioStatus.ACTIVE,
        isGlobal: false,
        name: 'Test',
        age: 30,
        gender: 'Male' as any,
        currentLocation: 'NY',
        openingStatements: ['Hi'],
        coverImageUrl: 'https://img.png',
        difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
        experienceMode: ExperienceMode.FEEDBACK,
        competencyId: '1',
        stateNames: [{ stateId: '1', name: 'state1' }],
        profession: 'Doctor',
        languageVoices: { '1': 'voice-1', '2': 'voice-2' },
        linguisticStyleSamples: { '1': ['sample one'] },
      };
      scenarioSharedService.getScenarioVoice.mockResolvedValue({
        id: 'voice-1',
      } as any);

      await expect(
        service.validateCreateScenario(createDto),
      ).resolves.not.toThrow();
    });
  });

  describe('createScenarios', () => {
    it('should create scenarios and add termination events successfully', async () => {
      const mockStateInstructions = [
        {
          id: 1,
          name: 'Resistant',
          instruction: 'Express mild doubt about if talking is helping',
          dialogues: [
            'I highly doubt if this is helping',
            'I think we should stop talking',
          ],
        },
        {
          id: 2,
          name: 'Engaged',
          instruction: 'Show more engagement',
          dialogues: ['Tell me more', 'I understand'],
        },
      ];
      const createDto = {
        scenarios: [
          {
            title: 'Test',
            description: 'Desc',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt',
            isGlobal: false,
            languageVoices: { 1: 'voice-1' },
            name: 'Test',
            age: 30,
            gender: 'Male',
            currentLocation: 'NY',
            openingStatements: ['Hi'],
            terminationEvents: [
              { id: 'event-1', message: 'Termination message 1' },
              { id: 'event-2', message: 'Termination message 2' },
              { id: 'event-3', message: 'Termination message 3' },
            ],
          },
        ],
      };
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
      } as any);

      // Mock sessionEventSharedService.findByIds to validate termination events
      sessionEventSharedService.findByIds.mockResolvedValue([
        { id: 'event-1' },
        { id: 'event-2' },
        { id: 'event-3' },
      ] as any);

      const mockScenarioEventsRepo = {
        create: jest.fn().mockImplementation((data) => data),
        save: jest.fn().mockResolvedValue([]),
      };

      const mockScenariosRepo = {
        create: jest.fn().mockImplementation((data) => data),
        save: jest.fn().mockResolvedValue([
          {
            id: 1,
            isGlobal: false,
            metadata: { stateInstructions: mockStateInstructions },
          },
        ]),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity: any) => {
          if (entity === Scenarios) return mockScenariosRepo;
          if (entity === ScenarioEvents) return mockScenarioEventsRepo;
          return {
            create: jest.fn().mockReturnValue([]),
            save: jest.fn().mockResolvedValue([]),
          };
        }),
      };
      mockConfigService.featureFlag = {
        ...mockConfigService.featureFlag,
        multipleTerminationEvents: true,
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.createScenarios(createDto as any, 1);

      expect(result).toHaveLength(1);

      expect(mockScenariosRepo.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Test',
            metadata: expect.objectContaining({
              name: 'Test',
              openingStatements: ['Hi'],
            }),
          }),
        ]),
      );

      // Verify create was called with termination events list
      expect(mockScenarioEventsRepo.create).toHaveBeenCalledWith([
        {
          scenarioId: 1,
          eventId: 'event-1',
          autoTerminationStatus: true,
          message: 'Termination message 1',
        },
        {
          scenarioId: 1,
          eventId: 'event-2',
          autoTerminationStatus: true,
          message: 'Termination message 2',
        },
        {
          scenarioId: 1,
          eventId: 'event-3',
          autoTerminationStatus: true,
          message: 'Termination message 3',
        },
      ]);

      // Verify save was called
      expect(mockScenarioEventsRepo.save).toHaveBeenCalled();
    });

    it('should create global scenarios and assign to tenants', async () => {
      const createDto = {
        scenarios: [
          {
            title: 'Global Scenario',
            description: 'Desc',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt',
            isGlobal: true,
            languageVoices: { 1: 'voice-1' },
            name: 'Test',
            age: 30,
            gender: 'Male',
            currentLocation: 'NY',
            openingStatements: ['Hi'],
          },
        ],
      };
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
      } as any);
      tenantService.findAll.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
      ] as any);
      const mockEntityManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Scenarios) {
            return {
              create: jest.fn().mockReturnValue([{ id: 1, isGlobal: true }]),
              save: jest.fn().mockResolvedValue([{ id: 1, isGlobal: true }]),
            };
          }
          if (entity === ScenarioTenants) {
            return {
              create: jest.fn().mockReturnValue([]),
              save: jest.fn().mockResolvedValue([]),
            };
          }
          return {
            create: jest.fn().mockReturnValue([]),
            save: jest.fn().mockResolvedValue([]),
          };
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.createScenarios(createDto as any, 1);

      expect(result).toHaveLength(1);
      expect(tenantService.findAll).toHaveBeenCalled();
    });

    it('should save trigger warnings when triggerWarningList is filled', async () => {
      const createDto = {
        scenarios: [
          {
            title: 'Test',
            description: 'Desc',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt',
            isGlobal: false,
            languageVoices: { 1: 'voice-1' },
            name: 'Test',
            age: 30,
            gender: 'Male',
            currentLocation: 'NY',
            openingStatements: ['Hi'],
            triggerWarningIds: ['uuid-1', 'uuid-2'],
          },
        ],
      };
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
      } as any);
      const mockScenarioTriggerWarningsRepo = {
        create: jest.fn().mockReturnValue([
          { scenarioId: 1, triggerWarningId: 'uuid-1' },
          { scenarioId: 1, triggerWarningId: 'uuid-2' },
        ]),
        save: jest.fn().mockResolvedValue([
          { scenarioId: 1, triggerWarningId: 'uuid-1' },
          { scenarioId: 1, triggerWarningId: 'uuid-2' },
        ]),
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Scenarios) {
            return {
              create: jest.fn().mockReturnValue([{ id: 1 }]),
              save: jest.fn().mockResolvedValue([{ id: 1, isGlobal: false }]),
            };
          }
          if (entity === ScenarioEvents) {
            return {
              find: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockReturnValue([]),
              save: jest.fn().mockResolvedValue([]),
            };
          }
          if (entity === ScenarioTriggerWarnings) {
            return mockScenarioTriggerWarningsRepo;
          }
          return {
            create: jest.fn().mockReturnValue([]),
            save: jest.fn().mockResolvedValue([]),
          };
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      await service.createScenarios(createDto as any, 1);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioTriggerWarnings,
      );
      expect(mockScenarioTriggerWarningsRepo.create).toHaveBeenCalledWith([
        { scenarioId: 1, triggerWarningId: 'uuid-1' },
        { scenarioId: 1, triggerWarningId: 'uuid-2' },
      ]);
      expect(mockScenarioTriggerWarningsRepo.save).toHaveBeenCalled();
    });

    it('should not save trigger warnings when feature flag is true but triggerWarningList is empty', async () => {
      const createDto = {
        scenarios: [
          {
            title: 'Test',
            description: 'Desc',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt',
            isGlobal: false,
            languageVoices: { 1: 'voice-1' },
            name: 'Test',
            age: 30,
            gender: 'Male',
            currentLocation: 'NY',
            openingStatements: ['Hi'],
            triggerWarningIds: [],
          },
        ],
      };
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
      } as any);
      const mockScenarioTriggerWarningsRepo = {
        create: jest.fn(),
        save: jest.fn(),
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Scenarios) {
            return {
              create: jest.fn().mockReturnValue([{ id: 1 }]),
              save: jest.fn().mockResolvedValue([{ id: 1, isGlobal: false }]),
            };
          }
          if (entity === ScenarioEvents) {
            return {
              find: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockReturnValue([]),
              save: jest.fn().mockResolvedValue([]),
            };
          }
          if (entity === ScenarioTriggerWarnings) {
            return mockScenarioTriggerWarningsRepo;
          }
          return {
            create: jest.fn().mockReturnValue([]),
            save: jest.fn().mockResolvedValue([]),
          };
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      await service.createScenarios(createDto as any, 1);

      expect(mockScenarioTriggerWarningsRepo.create).not.toHaveBeenCalled();
      expect(mockScenarioTriggerWarningsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateScenario', () => {
    it('should update scenario successfully', async () => {
      const updateDto: UpdateScenarioDto = {
        title: 'Updated Title',
        name: 'Updated Name',
      };
      const existingScenario = { ...mockScenario, isGlobal: false };
      scenariosRepository.findOne.mockResolvedValue(existingScenario);
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        null,
      );
      const mockScenariosRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        findOne: jest.fn().mockResolvedValue(existingScenario),
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }
          if (entity === ScenarioTriggerWarnings) {
            return {
              find: jest.fn().mockResolvedValue([]),
              create: jest.fn(),
              save: jest.fn(),
              delete: jest.fn(),
            };
          }
          return {
            findOne: jest.fn().mockResolvedValue(null),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            save: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockReturnValue([]),
          };
        }),
      };

      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.updateScenario(1, updateDto, 1);

      expect(result).toBe(true);
      expect(mockScenariosRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: 'Updated Title',
          metadata: expect.objectContaining({
            name: 'Updated Name',
          }),
        }),
      );
    });

    it('should throw ForbiddenException if multi-tenant admin tries to update a roleplay they did not create', async () => {
      const scenarioId = 1;
      const userId = 123;
      const updateDto: UpdateScenarioDto = { title: 'New Title' };
      const mockScenarioData = {
        ...mockScenario,
        id: scenarioId,
        createdBy: 456, // Different user
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenarioData);
      permissionsService.isMultiTenantAdmin.mockResolvedValue(true);

      await expect(
        service.updateScenario(scenarioId, updateDto, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return false when update affects no rows', async () => {
      const updateDto: UpdateScenarioDto = {
        title: 'Updated Title',
      };
      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
        null,
      );
      const mockEntityManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Scenarios) {
            return {
              update: jest.fn().mockResolvedValue({ affected: 0 }),
              findOne: jest.fn().mockResolvedValue(mockScenario),
            };
          }
          if (entity === ScenarioEvents) {
            return {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              update: jest.fn().mockResolvedValue({ affected: 0 }),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
            };
          }
          if (entity === ScenarioTriggerWarnings) {
            return {
              find: jest.fn().mockResolvedValue([]),
              create: jest.fn(),
              save: jest.fn(),
              delete: jest.fn(),
            };
          }
          return {
            findOne: jest.fn().mockResolvedValue(null),
          };
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) =>
        cb(mockEntityManager as any),
      );

      const result = await service.updateScenario(1, updateDto, 1);

      expect(result).toBe(false);
    });

    describe('custom fields', () => {
      it('should set customFields as undefined in metadata when customFields is not provided', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          name: 'Updated Name',
        };
        const existingScenario = { ...mockScenario, isGlobal: false };
        scenariosRepository.findOne.mockResolvedValue(existingScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );

        let capturedUpdateData: any;
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockImplementation((id, data) => {
                  capturedUpdateData = data;
                  return { affected: 1 };
                }),
                findOne: jest.fn().mockResolvedValue(existingScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return {
                find: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                save: jest.fn(),
                delete: jest.fn(),
              };
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(capturedUpdateData.metadata.customFields).toBeUndefined();
      });

      it('should trim extra properties from customFields and keep only name and value', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          customFields: [
            {
              name: 'Field 1',
              value: 'Value 1',
              extraProp: 'should be trimmed',
              anotherExtra: 123,
              useInDefaultPrompt: true,
            } as any,
            {
              name: 'Field 2',
              value: 'Value 2',
              id: 'some-id',
              metadata: { nested: 'data' },
              useInDefaultPrompt: true,
            } as any,
          ],
        };
        const existingScenario = { ...mockScenario, isGlobal: false };
        scenariosRepository.findOne.mockResolvedValue(existingScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );

        let capturedUpdateData: any;
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockImplementation((id, data) => {
                  capturedUpdateData = data;
                  return { affected: 1 };
                }),
                findOne: jest.fn().mockResolvedValue(existingScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return {
                find: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                save: jest.fn(),
                delete: jest.fn(),
              };
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(capturedUpdateData.metadata.customFields).toEqual([
          { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
          { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
        ]);
        expect(capturedUpdateData.metadata.customFields).toHaveLength(2);
        expect(capturedUpdateData.metadata.customFields[0]).not.toHaveProperty(
          'extraProp',
        );
        expect(capturedUpdateData.metadata.customFields[0]).not.toHaveProperty(
          'anotherExtra',
        );
        expect(capturedUpdateData.metadata.customFields[1]).not.toHaveProperty(
          'id',
        );
        expect(capturedUpdateData.metadata.customFields[1]).not.toHaveProperty(
          'metadata',
        );
      });

      it('should handle empty customFields array', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          customFields: [],
        };
        const existingScenario = { ...mockScenario, isGlobal: false };
        scenariosRepository.findOne.mockResolvedValue(existingScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );

        let capturedUpdateData: any;
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockImplementation((id, data) => {
                  capturedUpdateData = data;
                  return { affected: 1 };
                }),
                findOne: jest.fn().mockResolvedValue(existingScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return {
                find: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                save: jest.fn(),
                delete: jest.fn(),
              };
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(capturedUpdateData.metadata.customFields).toEqual([]);
      });

      it('should map customFields with only name and value properties', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          customFields: [
            { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
            { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
          ],
        };
        const existingScenario = { ...mockScenario, isGlobal: false };
        scenariosRepository.findOne.mockResolvedValue(existingScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );

        let capturedUpdateData: any;
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockImplementation((id, data) => {
                  capturedUpdateData = data;
                  return { affected: 1 };
                }),
                findOne: jest.fn().mockResolvedValue(existingScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return {
                find: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                save: jest.fn(),
                delete: jest.fn(),
              };
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(capturedUpdateData.metadata.customFields).toEqual([
          { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
          { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
        ]);
      });
    });

    describe('trigger warnings', () => {
      it('should skip trigger warning updates when no triggerWarningIds provided', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          save: jest.fn(),
          delete: jest.fn(),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.create).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.save).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).not.toHaveBeenCalled();
      });

      it('should create all trigger warnings when none exist', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          triggerWarningIds: ['uuid-1', 'uuid-2'],
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockReturnValue([
            { scenarioId: 1, triggerWarningId: 'uuid-1' },
            { scenarioId: 1, triggerWarningId: 'uuid-2' },
          ]),
          save: jest.fn().mockResolvedValue([]),
          delete: jest.fn(),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalledWith({
          where: { scenarioId: 1 },
        });
        expect(mockScenarioTriggerWarningsRepo.create).toHaveBeenCalledTimes(2);
        expect(mockScenarioTriggerWarningsRepo.save).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).not.toHaveBeenCalled();
      });

      it('should skip updates when trigger warnings are unchanged', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          triggerWarningIds: ['uuid-1', 'uuid-2'],
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const existingTriggerWarnings = [
          { id: 'stw-1', scenarioId: 1, triggerWarningId: 'uuid-1' },
          { id: 'stw-2', scenarioId: 1, triggerWarningId: 'uuid-2' },
        ];
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue(existingTriggerWarnings),
          create: jest.fn(),
          save: jest.fn(),
          delete: jest.fn(),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.create).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.save).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).not.toHaveBeenCalled();
      });

      it('should remove trigger warnings not in the incoming list', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          triggerWarningIds: ['uuid-1'],
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const existingTriggerWarnings = [
          { id: 'stw-1', scenarioId: 1, triggerWarningId: 'uuid-1' },
          { id: 'stw-2', scenarioId: 1, triggerWarningId: 'uuid-2' },
        ];
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue(existingTriggerWarnings),
          create: jest.fn(),
          save: jest.fn(),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.create).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.save).not.toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).toHaveBeenCalledWith([
          'stw-2',
        ]);
      });

      it('should add new trigger warnings from the incoming list', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          triggerWarningIds: ['uuid-1', 'uuid-2'],
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const existingTriggerWarnings = [
          { id: 'stw-1', scenarioId: 1, triggerWarningId: 'uuid-1' },
        ];
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue(existingTriggerWarnings),
          create: jest
            .fn()
            .mockReturnValue([{ scenarioId: 1, triggerWarningId: 'uuid-2' }]),
          save: jest.fn().mockResolvedValue([]),
          delete: jest.fn(),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.create).toHaveBeenCalledTimes(1);
        expect(mockScenarioTriggerWarningsRepo.save).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).not.toHaveBeenCalled();
      });

      it('should sync trigger warnings by adding new ones and removing old ones', async () => {
        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          triggerWarningIds: ['uuid-1', 'uuid-3'],
        };
        scenariosRepository.findOne.mockResolvedValue(mockScenario);
        scenarioPathSharedService.getScenarioPathItemByScenarioId.mockResolvedValue(
          null,
        );
        const existingTriggerWarnings = [
          { id: 'stw-1', scenarioId: 1, triggerWarningId: 'uuid-1' },
          { id: 'stw-2', scenarioId: 1, triggerWarningId: 'uuid-2' },
        ];
        const mockScenarioTriggerWarningsRepo = {
          find: jest.fn().mockResolvedValue(existingTriggerWarnings),
          create: jest
            .fn()
            .mockReturnValue([{ scenarioId: 1, triggerWarningId: 'uuid-3' }]),
          save: jest.fn().mockResolvedValue([]),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        const mockEntityManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === Scenarios) {
              return {
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOne: jest.fn().mockResolvedValue(mockScenario),
              };
            }
            if (entity === ScenarioEvents) {
              return {
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockReturnValue([]),
              };
            }
            if (entity === ScenarioTriggerWarnings) {
              return mockScenarioTriggerWarningsRepo;
            }
            return {
              findOne: jest.fn().mockResolvedValue(null),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };
        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        expect(mockScenarioTriggerWarningsRepo.find).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.create).toHaveBeenCalledTimes(1);
        expect(mockScenarioTriggerWarningsRepo.save).toHaveBeenCalled();
        expect(mockScenarioTriggerWarningsRepo.delete).toHaveBeenCalledWith([
          'stw-2',
        ]);
      });
    });

    describe('updateScenarioTerminationEvents', () => {
      it('should add new events, update existing events message, and delete removed events', async () => {
        // Input: termination events a, b, c, d
        // Already saved in DB: b, e, f
        // Expected:
        //   - a, c, d should be ADDED (new)
        //   - b's message should be UPDATED (existing)
        //   - e, f should be DELETED (removed)

        const updateDto: UpdateScenarioDto = {
          title: 'Updated Title',
          terminationEvents: [
            { id: 'event-a', message: 'Message A' },
            { id: 'event-b', message: 'Updated Message B' },
            { id: 'event-c', message: 'Message C' },
            { id: 'event-d', message: 'Message D' },
          ],
        };

        // Existing termination events in DB: b, e, f
        const existingTerminationEvents = [
          {
            id: 'scenario-event-b',
            scenarioId: 1,
            eventId: 'event-b',
            autoTerminationStatus: true,
            message: 'Old Message B',
          },
          {
            id: 'scenario-event-e',
            scenarioId: 1,
            eventId: 'event-e',
            autoTerminationStatus: true,
            message: 'Message E',
          },
          {
            id: 'scenario-event-f',
            scenarioId: 1,
            eventId: 'event-f',
            autoTerminationStatus: true,
            message: 'Message F',
          },
        ];

        const mockScenarioEventsRepo = {
          find: jest.fn().mockResolvedValue(existingTerminationEvents),
          delete: jest.fn().mockResolvedValue({ affected: 2 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
          save: jest
            .fn()
            .mockImplementation((events) => Promise.resolve(events)),
          create: jest.fn().mockImplementation((data) => data),
        };

        const mockScenariosRepo = {
          findOne: jest.fn().mockResolvedValue(mockScenario),
          save: jest.fn().mockResolvedValue({
            ...mockScenario,
            ...updateDto,
          }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity: any) => {
            if (entity === Scenarios) return mockScenariosRepo;
            if (entity === ScenarioEvents) return mockScenarioEventsRepo;
            return {
              find: jest.fn().mockResolvedValue([]),
              delete: jest.fn().mockResolvedValue({ affected: 0 }),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
              save: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockReturnValue([]),
            };
          }),
        };

        // Enable the feature flag for multiple termination events
        mockConfigService.featureFlag = {
          ...mockConfigService.featureFlag,
          multipleTerminationEvents: true,
        };

        // Mock scenariosRepository.findOne for validateUpdateScenario
        scenariosRepository.findOne.mockResolvedValue(mockScenario as any);

        // Mock sessionEventSharedService.findByIds to validate termination events
        sessionEventSharedService.findByIds.mockResolvedValue([
          { id: 'event-a' },
          { id: 'event-b' },
          { id: 'event-c' },
          { id: 'event-d' },
        ] as any);

        dataSource.transaction.mockImplementation((cb: any) =>
          cb(mockEntityManager as any),
        );

        await service.updateScenario(1, updateDto, 1);

        // Verify: e and f should be deleted (events not in input but in DB)
        expect(mockScenarioEventsRepo.delete).toHaveBeenCalledWith([
          'scenario-event-e',
          'scenario-event-f',
        ]);

        // Verify: a, c, d should be added (new events)
        expect(mockScenarioEventsRepo.create).toHaveBeenCalledTimes(3);
        expect(mockScenarioEventsRepo.create).toHaveBeenCalledWith({
          scenarioId: 1,
          eventId: 'event-a',
          autoTerminationStatus: true,
          message: 'Message A',
        });
        expect(mockScenarioEventsRepo.create).toHaveBeenCalledWith({
          scenarioId: 1,
          eventId: 'event-c',
          autoTerminationStatus: true,
          message: 'Message C',
        });
        expect(mockScenarioEventsRepo.create).toHaveBeenCalledWith({
          scenarioId: 1,
          eventId: 'event-d',
          autoTerminationStatus: true,
          message: 'Message D',
        });

        // Verify: save was called for new events
        expect(mockScenarioEventsRepo.save).toHaveBeenCalled();

        // Verify: b's message should be updated
        expect(mockScenarioEventsRepo.update).toHaveBeenCalledWith(
          'scenario-event-b',
          { message: 'Updated Message B' },
        );
      });
    });

    describe('duplicateScenario', () => {
      const scenarioId = 1;
      const mockUserId = 123;

      beforeEach(() => {
        (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
      });

      it('should successfully duplicate a scenario with all related data', async () => {
        const mockScenarioEvents = [
          {
            id: 1,
            scenarioId: 1,
            eventId: 'event-1',
            autoTerminationStatus: false,
            branchingStatus: true,
            branchInstruction: 'Branch instruction',
            emoji: '👍',
            feedbackStatus: true,
            message: 'Great job!',
            score: 85,
          },
          {
            id: 2,
            scenarioId: 1,
            eventId: 'event-2',
            autoTerminationStatus: true,
            branchingStatus: false,
            branchInstruction: null,
            emoji: '⚠️',
            feedbackStatus: false,
            message: 'Session terminated',
            score: 0,
          },
        ];

        const mockTriggerWarnings = [
          {
            id: 1,
            scenarioId: 1,
            triggerWarningId: 'warning-1',
          },
          {
            id: 2,
            scenarioId: 1,
            triggerWarningId: 'warning-2',
          },
        ];

        const mockTenants = [
          { id: 'tenant-1', name: 'Tenant 1' },
          { id: 'tenant-2', name: 'Tenant 2' },
        ];

        const mockBehaviorInstructions = [
          {
            id: 'instruction-1',
            category: BehaviorInstructionCategory.SHOULD_DO,
            stateInstructions: [
              { stateId: '1', instruction: 'Listen actively' },
              { stateId: '2', instruction: 'Show empathy' },
            ],
            behaviors: [
              { id: 'behavior-1', name: 'Active Listening' },
              { id: 'behavior-2', name: 'Empathy' },
            ],
          },
          {
            id: 'instruction-2',
            category: BehaviorInstructionCategory.SHOULD_NOT_DO,
            stateInstructions: [
              { stateId: '1', instruction: 'Do not interrupt' },
              { stateId: '2', instruction: 'Avoid judgmental language' },
            ],
            behaviors: [{ id: 'behavior-3', name: 'Non-judgmental' }],
          },
        ];

        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          description: mockScenario.description,
          coverImageUrl: mockScenario.coverImageUrl,
          coverVideoUrl: mockScenario.coverVideoUrl,
          status: ScenarioStatus.DRAFT,
          prompt: mockScenario.prompt,
          metadata: mockScenario.metadata,
          isGlobal: true,
          scenario: mockScenario.scenario,
          createdBy: mockUserId,
          updatedBy: mockUserId,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue({
          ...mockScenario,
          isGlobal: true,
        } as any);
        scenarioEventsRepository.find.mockResolvedValue(
          mockScenarioEvents as any,
        );
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          mockTriggerWarnings as any,
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          mockBehaviorInstructions as any,
        );
        tenantService.findAll.mockResolvedValue(mockTenants as any);

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockScenarioEventRepo = {
          create: jest.fn((data) => data),
          save: jest.fn().mockResolvedValue([]),
        };

        const mockTriggerWarningsRepo = {
          create: jest.fn((data) => data),
          save: jest.fn().mockResolvedValue([]),
        };

        const mockScenarioTenantRepo = {
          create: jest.fn((data) => data),
          save: jest.fn().mockResolvedValue([]),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            if (entity === ScenarioEvents) return mockScenarioEventRepo;
            if (entity === ScenarioTriggerWarnings)
              return mockTriggerWarningsRepo;
            if (entity === ScenarioTenants) return mockScenarioTenantRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(result).toEqual(mockNewScenario);
        expect(scenarioSharedService.getAdminScenario).toHaveBeenCalledWith(
          scenarioId,
        );
        expect(scenarioEventsRepository.find).toHaveBeenCalledWith({
          where: { scenarioId },
        });
        expect(
          triggerWarningsService.getTriggerWarningsByScenarioId,
        ).toHaveBeenCalledWith(scenarioId);
        expect(
          scenarioSharedService.getBehaviorInstructionsByScenarioId,
        ).toHaveBeenCalledWith(scenarioId);

        expect(mockScenarioRepo.save).toHaveBeenCalledWith({
          title: 'Copy of Test Scenario',
          description: mockScenario.description,
          coverImageUrl: mockScenario.coverImageUrl,
          coverVideoUrl: mockScenario.coverVideoUrl,
          status: ScenarioStatus.DRAFT,
          prompt: mockScenario.prompt,
          metadata: mockScenario.metadata,
          isGlobal: true,
          scenario: mockScenario.scenario,
          competencyId: mockScenario.competencyId,
          createdBy: mockUserId,
          updatedBy: mockUserId,
        });

        expect(mockScenarioEventRepo.save).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              scenarioId: 2,
              eventId: 'event-1',
              autoTerminationStatus: false,
              branchingStatus: true,
              branchInstruction: 'Branch instruction',
              emoji: '👍',
              feedbackStatus: true,
              message: 'Great job!',
              score: 85,
            }),
            expect.objectContaining({
              scenarioId: 2,
              eventId: 'event-2',
              autoTerminationStatus: true,
              branchingStatus: false,
              emoji: '⚠️',
              feedbackStatus: false,
              message: 'Session terminated',
              score: 0,
            }),
          ]),
        );

        expect(mockTriggerWarningsRepo.save).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              scenarioId: 2,
              triggerWarningId: 'warning-1',
            }),
            expect.objectContaining({
              scenarioId: 2,
              triggerWarningId: 'warning-2',
            }),
          ]),
        );

        expect(tenantService.findAll).toHaveBeenCalled();
        expect(mockScenarioTenantRepo.save).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              scenarioId: 2,
              tenantId: 'tenant-1',
            }),
            expect.objectContaining({
              scenarioId: 2,
              tenantId: 'tenant-2',
            }),
          ]),
        );

        expect(
          scenarioBehaviorInstructionService.createBehaviorInstructions,
        ).toHaveBeenCalledWith(
          [
            {
              scenarioId: 2,
              behaviorInstructions: [
                {
                  category: BehaviorInstructionCategory.SHOULD_DO,
                  stateInstructions: [
                    { stateId: '1', instruction: 'Listen actively' },
                    { stateId: '2', instruction: 'Show empathy' },
                  ],
                  behaviors: ['behavior-1', 'behavior-2'],
                },
                {
                  category: BehaviorInstructionCategory.SHOULD_NOT_DO,
                  stateInstructions: [
                    { stateId: '1', instruction: 'Do not interrupt' },
                    {
                      stateId: '2',
                      instruction: 'Avoid judgmental language',
                    },
                  ],
                  behaviors: ['behavior-3'],
                },
              ],
            },
          ],
          mockEntityManager,
        );
      });

      it('should throw NotFoundException when scenario does not exist', async () => {
        scenarioSharedService.getAdminScenario.mockResolvedValue(null as any);

        await expect(service.duplicateScenario(scenarioId)).rejects.toThrow(
          NotFoundException,
        );
        await expect(service.duplicateScenario(scenarioId)).rejects.toThrow(
          'Scenario not found',
        );

        expect(scenarioSharedService.getAdminScenario).toHaveBeenCalledWith(
          scenarioId,
        );
      });

      it('should duplicate scenario without events when no events exist', async () => {
        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue(
          mockScenario as any,
        );
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockScenarioEventRepo = {
          create: jest.fn(),
          save: jest.fn(),
        };

        const mockTriggerWarningsRepo = {
          create: jest.fn(),
          save: jest.fn(),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            if (entity === ScenarioEvents) return mockScenarioEventRepo;
            if (entity === ScenarioTriggerWarnings)
              return mockTriggerWarningsRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(result).toEqual(mockNewScenario);
        expect(mockScenarioEventRepo.save).not.toHaveBeenCalled();
        expect(tenantService.findAll).not.toHaveBeenCalled();
      });

      it('should duplicate scenario without trigger warnings when none exist', async () => {
        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue(
          mockScenario as any,
        );
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockTriggerWarningsRepo = {
          create: jest.fn(),
          save: jest.fn(),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            if (entity === ScenarioTriggerWarnings)
              return mockTriggerWarningsRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(result).toEqual(mockNewScenario);
        expect(mockTriggerWarningsRepo.save).not.toHaveBeenCalled();
      });

      it('should not create tenant mappings when isGlobal is false', async () => {
        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue({
          ...mockScenario,
          isGlobal: false,
        } as any);
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockScenarioTenantRepo = {
          create: jest.fn(),
          save: jest.fn(),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            if (entity === ScenarioTenants) return mockScenarioTenantRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(result).toEqual(mockNewScenario);
        expect(tenantService.findAll).not.toHaveBeenCalled();
        expect(mockScenarioTenantRepo.save).not.toHaveBeenCalled();
      });

      it('should use ExecutionManager.getUserId for createdBy and updatedBy', async () => {
        const customUserId = 999;
        (ExecutionManager.getUserId as jest.Mock).mockReturnValue(customUserId);

        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
          createdBy: customUserId,
          updatedBy: customUserId,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue(
          mockScenario as any,
        );
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        await service.duplicateScenario(scenarioId);

        expect(mockScenarioRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            createdBy: customUserId,
            updatedBy: customUserId,
          }),
        );
      });

      it('should prepend "Copy of" to the scenario title', async () => {
        const mockNewScenario = {
          id: 2,
          title: 'Copy of My Awesome Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue({
          ...mockScenario,
          title: 'My Awesome Scenario',
        } as any);
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(mockScenarioRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Copy of My Awesome Scenario',
          }),
        );
        expect(result.title).toBe('Copy of My Awesome Scenario');
      });

      it('should always set status to DRAFT for duplicated scenario', async () => {
        const mockNewScenario = {
          id: 2,
          title: 'Copy of Test Scenario',
          status: ScenarioStatus.DRAFT,
          isGlobal: false,
        };

        scenarioSharedService.getAdminScenario.mockResolvedValue({
          ...mockScenario,
          status: ScenarioStatus.ACTIVE,
        } as any);
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockScenarioRepo = {
          save: jest.fn().mockResolvedValue(mockNewScenario),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        const result = await service.duplicateScenario(scenarioId);

        expect(mockScenarioRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            status: ScenarioStatus.DRAFT,
          }),
        );
        expect(result.status).toBe(ScenarioStatus.DRAFT);
      });

      it('should handle transaction rollback on error', async () => {
        scenarioSharedService.getAdminScenario.mockResolvedValue(
          mockScenario as any,
        );
        scenarioEventsRepository.find.mockResolvedValue([]);
        triggerWarningsService.getTriggerWarningsByScenarioId.mockResolvedValue(
          [],
        );
        scenarioSharedService.getBehaviorInstructionsByScenarioId.mockResolvedValue(
          undefined,
        );

        const mockError = new Error('Database error');
        const mockScenarioRepo = {
          save: jest.fn().mockRejectedValue(mockError),
        };

        const mockEntityManager = {
          getRepository: jest.fn((entity) => {
            if (entity === Scenarios) return mockScenarioRepo;
            return {};
          }),
        };

        (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(mockEntityManager),
        );

        await expect(service.duplicateScenario(scenarioId)).rejects.toThrow(
          'Database error',
        );
      });
    });
  });

  describe('persistTranslationsForScenarios', () => {
    let persistTranslationsForScenarios: (
      scenarios: any[],
      metadataExtractor: (scenario: any) => Record<string, any>,
    ) => Promise<void>;
    let mockLogger: any;

    beforeEach(() => {
      persistTranslationsForScenarios = (
        service as any
      ).persistTranslationsForScenarios.bind(service);

      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      (service as any).logger = mockLogger;

      (service as any).sanitizeMetadata = jest.fn((data) => ({ ...data }));

      (service as any).buildTranslatedMetadataForLanguageCodes = jest.fn(
        async (data, codes) =>
          codes.reduce((acc: any, code: string) => {
            acc[code] = { ...data };
            return acc;
          }, {}),
      );

      sharedLanguageService.getLanguagesByIds = jest.fn().mockResolvedValue([]);

      dataSource.getRepository = jest.fn().mockReturnValue({
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      });

      scenarioTranslationsRepository.createScenarioTranslations = jest.fn();
      scenarioTranslationsRepository.updateScenarioTranslations = jest.fn();
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId =
        jest.fn();
    });

    it('should skip scenarios with empty metadata', async () => {
      const scenarios = [{ id: 1 }];

      const metadataExtractor = jest.fn(() => ({}));

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(metadataExtractor).toHaveBeenCalledWith(scenarios[0]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('no non-empty metadata, skipping'),
      );

      expect(
        scenarioTranslationsRepository.createScenarioTranslations,
      ).not.toHaveBeenCalled();
      expect(
        scenarioTranslationsRepository.updateScenarioTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should skip scenarios with no valid languages', async () => {
      const scenarios = [
        {
          id: 1,
          metadata: { languageVoices: { '1': 'voice-1' } },
        },
      ];

      const metadataExtractor = jest.fn(() => ({
        title: 'Test',
        description: 'Test',
      }));

      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        {
          id: 1,
          translationCode: '',
          value: 'en-US',
          label: 'English (US)',
          active: true,
        },
      ] as any);

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no valid languages, skipping'),
      );

      expect(
        scenarioTranslationsRepository.createScenarioTranslations,
      ).not.toHaveBeenCalled();
      expect(
        scenarioTranslationsRepository.updateScenarioTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should create translations for new language IDs', async () => {
      const scenarios = [
        {
          id: 1,
          name: 'Scenario 1',
          metadata: { languageVoices: { '1': 'v1', '2': 'v2' } },
        },
      ];

      const metadataExtractor = jest.fn(() => ({
        title: 'Test Title',
        description: 'Test Description',
      }));

      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        {
          id: 1,
          translationCode: 'en',
          value: 'en-IN',
          label: 'English (India)',
          active: true,
        },
        {
          id: 2,
          translationCode: 'es',
          value: 'es-ES',
          label: 'Spanish (Spain)',
          active: true,
        },
      ] as any);

      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [],
      );

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(
        scenarioTranslationsRepository.createScenarioTranslations,
      ).toHaveBeenCalledWith([
        {
          scenarioId: 1,
          languageId: 2,
          metadata: {
            title: 'Test Title',
            description: 'Test Description',
          },
        },
      ]);

      expect(
        scenarioTranslationsRepository.updateScenarioTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should update existing translations', async () => {
      const scenarios = [
        {
          id: 1,
          name: 'Scenario 1',
          metadata: { languageVoices: { '2': 'v2' } },
        },
      ];

      const metadataExtractor = jest.fn(() => ({
        title: 'Updated Title',
        description: 'Updated Description',
      }));

      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        {
          id: 2,
          translationCode: 'hi',
          value: 'hi-IN',
          label: 'Hindi',
          active: true,
        },
      ] as any);

      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 2,
            id: '2',
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      );

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(
        scenarioTranslationsRepository.updateScenarioTranslations,
      ).toHaveBeenCalledWith([
        {
          scenarioId: 1,
          languageId: 2,
          metadata: expect.objectContaining({
            title: 'Updated Title',
            description: 'Updated Description',
          }),
        },
      ]);

      expect(
        scenarioTranslationsRepository.createScenarioTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should not let auto-translate output overwrite translation openingStatements', async () => {
      const scenarios = [
        {
          id: 1,
          metadata: { languageVoices: { '2': 'v' } },
        },
      ];

      const metadataExtractor = jest.fn(() => ({
        title: 'T',
        description: 'D',
      }));

      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        {
          id: 2,
          translationCode: 'hi',
          value: 'hi-IN',
          label: 'Hindi',
          active: true,
        },
      ] as any);

      (
        service as any
      ).buildTranslatedMetadataForLanguageCodes.mockResolvedValue({
        hi: {
          title: 'T-hi',
          description: 'D-hi',
          openingStatements: ['should not be persisted from auto-translate'],
        },
      });

      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 2,
            id: '2',
            metadata: { openingStatements: ['manual hi line'] },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      );

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(
        scenarioTranslationsRepository.updateScenarioTranslations,
      ).toHaveBeenCalledWith([
        expect.objectContaining({
          languageId: 2,
          metadata: expect.objectContaining({
            title: 'T-hi',
            description: 'D-hi',
            openingStatements: ['manual hi line'],
          }),
        }),
      ]);
    });

    it('should continue processing when one scenario throws an error', async () => {
      const scenarios = [
        {
          id: 1,
          name: 'Scenario 1',
          metadata: { languageVoices: { '2': 'v' } },
        },
        {
          id: 2,
          name: 'Scenario 2',
          metadata: { languageVoices: { '2': 'v' } },
        },
      ];

      const metadataExtractor = jest.fn(() => ({ title: 'Test' }));

      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        {
          id: 2,
          translationCode: 'hi',
          value: 'hi-IN',
          label: 'Hindi (India)',
          active: true,
        },
      ] as any);

      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Database error'));

      await persistTranslationsForScenarios(scenarios, metadataExtractor);

      expect(
        scenarioTranslationsRepository.createScenarioTranslations,
      ).toHaveBeenCalledTimes(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('unexpected error processing scenario 2'),
        expect.any(Object),
      );
    });
  });

  describe('createUpdateScenarioEventsTranslations', () => {
    let mockLogger: any;

    beforeEach(() => {
      mockLogger = {
        warn: jest.fn(),
        debug: jest.fn(),
      };

      (service as any).logger = mockLogger;

      // Mock the persistScenarioEventTranslations method
      (service as any).persistScenarioEventTranslations = jest.fn();
    });

    it('should skip when no valid language codes are found', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [],
      );

      await service.createUpdateScenarioEventsTranslations([{ id: 1 }]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no valid languages, skipping'),
      );
      expect(service.persistScenarioEventTranslations).not.toHaveBeenCalled();
    });

    it('should skip when no valid languages are returned from shared service', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1, 2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [],
        languagesMap: {},
      });

      await service.createUpdateScenarioEventsTranslations([{ id: 1 }]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no valid languages, skipping'),
      );
      expect(service.persistScenarioEventTranslations).not.toHaveBeenCalled();
    });

    it('should call persistScenarioEventTranslations with correct parameters', async () => {
      const scenarioEvents = [
        {
          id: 1,
          scenarioId: 100,
          eventId: 'event-1',
          message: 'Test message',
          branchInstruction: 'Test branch',
        },
      ];

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1, 2],
      );
      const mockLanguages = [
        {
          id: 1,
          value: 'en',
          label: 'English',
          active: true,
          translationCode: 'en',
          createdAt: new Date(),
          updatedAt: new Date(),
          llmProviderConfig: {},
          sttProviderConfig: {},
        },
        {
          id: 2,
          value: 'es',
          label: 'Spanish',
          active: true,
          translationCode: 'es',
          createdAt: new Date(),
          updatedAt: new Date(),
          llmProviderConfig: {},
          sttProviderConfig: {},
        },
      ];

      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: mockLanguages,
        languagesMap: mockLanguages.reduce(
          (acc, lang) => ({
            ...acc,
            [lang.translationCode]: lang,
          }),
          {},
        ),
      });

      await service.createUpdateScenarioEventsTranslations(scenarioEvents);

      expect(service.persistScenarioEventTranslations).toHaveBeenCalledWith(
        scenarioEvents,
        expect.any(Function),
        expect.arrayContaining([
          expect.objectContaining({ id: 1, translationCode: 'en' }),
          expect.objectContaining({ id: 2, translationCode: 'es' }),
        ]),
      );

      // Test the metadata extractor function
      const metadataExtractor = (
        service.persistScenarioEventTranslations as jest.Mock
      ).mock.calls[0][1];
      const metadata = metadataExtractor(scenarioEvents[0]);
      expect(metadata).toEqual({
        message: 'Test message',
        branchInstruction: 'Test branch',
      });
    });

    // it('should handle errors gracefully', async () => {
    //   // Mock the error to be thrown
    //   scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockRejectedValue(
    //     new Error('DB error'),
    //   );

    //   // Mock the logger to prevent actual logging during test
    //   mockLogger.warn.mockImplementation(() => {});

    //   // The method should handle the error internally and not throw
    //   await service.createUpdateScenarioEventsTranslations([{ id: 1 }]);

    //   // Verify the error was logged
    //   expect(mockLogger.warn).toHaveBeenCalledWith(
    //     expect.stringContaining('no valid languages, skipping'),
    //   );

    //   // Verify no further processing happened
    //   expect(service.persistScenarioEventTranslations).not.toHaveBeenCalled();
    // });
  });

  describe('sanitizeMetadata', () => {
    it('should remove null and undefined values from metadata', () => {
      const input = {
        title: 'Test Title',
        description: null,
        tags: undefined,
        active: true,
      };

      const result = (service as any).sanitizeMetadata(input);

      expect(result).toEqual({
        title: 'Test Title',
        active: true,
      });
    });

    it('should trim string values', () => {
      const input = {
        title: '  Test Title  ',
        description: '  Some description  ',
        active: true,
      };

      const result = (service as any).sanitizeMetadata(input);

      expect(result).toEqual({
        title: 'Test Title',
        description: 'Some description',
        active: true,
      });
    });

    it('should handle empty objects', () => {
      const input = {};
      const result = (service as any).sanitizeMetadata(input);
      expect(result).toEqual({});
    });

    it('should handle null or undefined input', () => {
      expect((service as any).sanitizeMetadata(null)).toEqual({});
      expect((service as any).sanitizeMetadata(undefined)).toEqual({});
    });
  });

  describe('buildTranslatedMetadataForLanguageCodes', () => {
    let mockGoogleTranslationsService: any;
    let mockOpenAITranslationsService: any;
    let mockLogger: any;
    let buildTranslatedMetadataForLanguageCodes: (
      metadata: Record<string, any>,
      languageCodes: string[],
    ) => Promise<Record<string, any>>;

    beforeEach(() => {
      mockGoogleTranslationsService = {
        translateObjectToLanguages: jest.fn(),
      };
      mockOpenAITranslationsService = {
        translateScenarioData: jest.fn(),
      };
      mockLogger = {
        debug: jest.fn(),
        error: jest.fn(),
      };

      (service as any).googleTranslationsService =
        mockGoogleTranslationsService;
      (service as any).openaiTranslationsService =
        mockOpenAITranslationsService;
      (service as any).logger = mockLogger;

      // Get reference to the private method
      buildTranslatedMetadataForLanguageCodes = (
        service as any
      ).buildTranslatedMetadataForLanguageCodes.bind(service);
    });

    it('should return empty object when no language codes are provided', async () => {
      const result = await buildTranslatedMetadataForLanguageCodes(
        { title: 'Test' },
        [],
      );

      expect(result).toEqual({});
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('no language codes provided'),
      );
    });

    it('should return empty object when metadata is empty', async () => {
      const result = await buildTranslatedMetadataForLanguageCodes({}, [
        'en',
        'es',
      ]);

      expect(result).toEqual({});
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('no metadata to translate'),
      );
    });

    it('should call translation service with correct parameters', async () => {
      const metadata = { title: 'Test Title', description: 'Test Description' };
      const languageCodes = ['en', 'es'];

      mockOpenAITranslationsService.translateScenarioData.mockResolvedValue({
        en: { ...metadata, translated: true },
        es: { ...metadata, translated: true },
      });

      const result = await buildTranslatedMetadataForLanguageCodes(
        metadata,
        languageCodes,
      );

      expect(
        mockOpenAITranslationsService.translateScenarioData,
      ).toHaveBeenCalledWith(metadata, ['en', 'es'], undefined, undefined);
      expect(result).toEqual({
        en: { ...metadata, translated: true },
        es: { ...metadata, translated: true },
      });
    });

    it('should handle translation service errors gracefully', async () => {
      const metadata = { title: 'Test' };
      const error = new Error('Translation failed');

      mockOpenAITranslationsService.translateScenarioData.mockRejectedValue(
        error,
      );

      const result = await buildTranslatedMetadataForLanguageCodes(metadata, [
        'en',
      ]);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('translation call failed'),
        expect.objectContaining({
          err: error,
          languageCodes: ['en'],
        }),
      );
    });

    it('should trim and filter invalid language codes', async () => {
      const metadata = { title: 'Test' };
      const languageCodes = [' en ', '  ', 'es', 123, null, undefined];

      mockOpenAITranslationsService.translateScenarioData.mockResolvedValue({
        en: { ...metadata, translated: true },
        es: { ...metadata, translated: true },
      });

      await buildTranslatedMetadataForLanguageCodes(
        metadata,
        languageCodes as any,
      );

      expect(
        mockOpenAITranslationsService.translateScenarioData,
      ).toHaveBeenCalledWith(metadata, ['en', 'es'], undefined, undefined);
    });

    it('should handle empty response from translation service', async () => {
      const metadata = { title: 'Test' };

      mockOpenAITranslationsService.translateScenarioData.mockResolvedValue({});
      mockGoogleTranslationsService.translateObjectToLanguages.mockResolvedValue(
        null,
      );

      const result = await buildTranslatedMetadataForLanguageCodes(metadata, [
        'en',
      ]);

      expect(
        mockGoogleTranslationsService.translateObjectToLanguages,
      ).toHaveBeenCalledWith(metadata, ['en'], { mimeType: 'text/html' });
      expect(result).toEqual({});
    });
  });

  describe('getBranchingInstructionDynamicShortcuts', () => {
    const defaultShortcuts = [
      'chat_summary',
      'last_helper_utterance',
      'llm_response()',
      'Your context',
    ];

    it('should return default dynamic branch shortcuts when no scenarioId is provided', async () => {
      const result = await service.getBranchingInstructionDynamicShortcuts();

      expect(result).toEqual(defaultShortcuts);
      expect(scenariosRepository.getScenarioById).not.toHaveBeenCalled();
    });

    it('should return default shortcuts when scenario has no custom fields', async () => {
      const scenarioId = 1;
      const scenarioWithoutCustomFields = {
        ...mockScenario,
        metadata: {
          name: 'Test Client',
        },
      };

      scenariosRepository.getScenarioById.mockResolvedValue(
        scenarioWithoutCustomFields,
      );

      const result =
        await service.getBranchingInstructionDynamicShortcuts(scenarioId);

      expect(result).toEqual(defaultShortcuts);
    });

    it('should return default shortcuts plus custom field names when scenario has custom fields', async () => {
      const scenarioId = 1;
      const scenarioWithCustomFields = {
        ...mockScenario,
        metadata: {
          name: 'Test Client',
          customFields: [
            { name: 'custom_field_1', value: 'value1' },
            { name: 'custom_field_2', value: 'value2' },
          ],
        },
      };

      scenariosRepository.getScenarioById.mockResolvedValue(
        scenarioWithCustomFields,
      );

      const result =
        await service.getBranchingInstructionDynamicShortcuts(scenarioId);

      expect(result).toEqual([
        ...defaultShortcuts,
        'custom_field_1',
        'custom_field_2',
      ]);
    });

    it('should return default shortcuts when custom fields is empty array', async () => {
      const scenarioId = 1;
      const scenarioWithEmptyCustomFields = {
        ...mockScenario,
        metadata: {
          customFields: [],
        },
      };

      scenariosRepository.getScenarioById.mockResolvedValue(
        scenarioWithEmptyCustomFields,
      );

      const result =
        await service.getBranchingInstructionDynamicShortcuts(scenarioId);

      expect(result).toEqual(defaultShortcuts);
    });

    it('should throw NotFoundException when scenario does not exist', async () => {
      const scenarioId = 999;

      scenariosRepository.getScenarioById.mockResolvedValue(null);

      await expect(
        service.getBranchingInstructionDynamicShortcuts(scenarioId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateField', () => {
    const scenarioContext = {
      title: 'Anxiety Counseling',
      name: 'John',
      age: 30,
      gender: 'Male',
    };

    it('should return generated string content for CHARACTER_PROFILE_TEXT', async () => {
      const dto = {
        fieldName: GeneratableField.CHARACTER_PROFILE_TEXT,
        scenarioContext,
      };
      const generatedContent = 'A 30-year-old male named John...';

      openAIAutofillService.generateFieldContent.mockResolvedValue(
        generatedContent,
      );

      const result = await service.generateField(dto);

      expect(result).toEqual({
        fieldName: GeneratableField.CHARACTER_PROFILE_TEXT,
        content: generatedContent,
      });
      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        expect.any(String),
        scenarioContext,
        undefined,
        undefined,
      );
    });

    it('should pass model override to OpenAIAutofillService when provided', async () => {
      const dto = {
        fieldName: GeneratableField.CHARACTER_PROFILE_TEXT,
        scenarioContext,
        model: 'gpt-4o',
      };
      openAIAutofillService.generateFieldContent.mockResolvedValue('Generated');

      await service.generateField(dto);

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        expect.any(String),
        scenarioContext,
        undefined,
        'gpt-4o',
      );
    });

    it('should return generated string content for DESCRIPTION', async () => {
      const dto = {
        fieldName: GeneratableField.DESCRIPTION,
        scenarioContext,
      };
      const generatedContent = 'This scenario covers anxiety counseling...';

      openAIAutofillService.generateFieldContent.mockResolvedValue(
        generatedContent,
      );

      const result = await service.generateField(dto);

      expect(result).toEqual({
        fieldName: GeneratableField.DESCRIPTION,
        content: generatedContent,
      });
    });

    it('should return generated array content for OPENING_STATEMENTS', async () => {
      const dto = {
        fieldName: GeneratableField.OPENING_STATEMENTS,
        scenarioContext: {
          ...scenarioContext,
          languageId: '9',
          languageCode: 'hi-IN',
          languageName: 'Hindi',
        },
      };
      const generatedContent = [
        'Hello, I have been feeling anxious lately.',
        'Hi, I need help with my anxiety.',
      ];

      sharedLanguageService.getLanguagesByIds.mockResolvedValueOnce([
        {
          id: 9,
          value: 'hi-IN',
          label: 'Hindi (India)',
          translationCode: 'hi',
        } as any,
      ]);

      openAIAutofillService.generateFieldContent.mockResolvedValue(
        generatedContent,
      );

      const result = await service.generateField(dto);

      expect(result).toEqual({
        fieldName: GeneratableField.OPENING_STATEMENTS,
        content: generatedContent,
      });
      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.OPENING_STATEMENTS,
        expect.any(String),
        expect.objectContaining({
          languageId: '9',
          languageCode: 'hi-IN',
          languageName: 'Hindi',
        }),
        undefined,
        undefined,
      );
    });

    it('should resolve languageCode from DB for OPENING_STATEMENTS when client omits code', async () => {
      const dto = {
        fieldName: GeneratableField.OPENING_STATEMENTS,
        scenarioContext: {
          ...scenarioContext,
          languageId: '9',
          languageCode: '',
          languageName: '',
        },
      };
      sharedLanguageService.getLanguagesByIds.mockResolvedValueOnce([
        {
          id: 9,
          value: 'hi-IN',
          label: 'Hindi (India)',
          translationCode: 'hi',
        } as any,
      ]);
      openAIAutofillService.generateFieldContent.mockResolvedValue(['line']);

      await service.generateField(dto);

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.OPENING_STATEMENTS,
        expect.any(String),
        expect.objectContaining({
          languageCode: 'hi-IN',
          languageName: 'Hindi (India)',
        }),
        undefined,
        undefined,
      );
    });

    it('should use English filler prompt when languageCode is English for ALLOWED_FILLER_WORDS', async () => {
      const ctx = {
        ...scenarioContext,
        languageId: '5',
        languageCode: 'en-IN',
        languageName: 'English (India)',
        characterProfileText: 'Profile',
        challengeDescription: 'Challenge',
        currentLocation: 'Mumbai',
      };
      openAIAutofillService.generateFieldContent.mockResolvedValue([
        'um',
        'well',
      ]);

      await service.generateField({
        fieldName: GeneratableField.ALLOWED_FILLER_WORDS,
        scenarioContext: ctx,
      });

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.ALLOWED_FILLER_WORDS,
        'openai_simulation_allowed_filler_words_english',
        expect.objectContaining({
          language_code: 'en-IN',
          language_name: 'English (India)',
        }),
        undefined,
        undefined,
      );
      const calls = openAIAutofillService.generateFieldContent.mock.calls;
      const passedContext = calls[calls.length - 1]?.[2];
      expect(passedContext).not.toHaveProperty('emotional_state');
    });

    it('should use default filler prompt when languageCode is not English for ALLOWED_FILLER_WORDS', async () => {
      const ctx = {
        ...scenarioContext,
        languageId: '3',
        languageCode: 'ml-IN',
        languageName: 'Malayalam',
        characterProfileText: 'Profile',
        challengeDescription: 'Challenge',
        currentLocation: 'Kochi',
      };
      openAIAutofillService.generateFieldContent.mockResolvedValue(['അ']);

      await service.generateField({
        fieldName: GeneratableField.ALLOWED_FILLER_WORDS,
        scenarioContext: ctx,
      });

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalledWith(
        GeneratableField.ALLOWED_FILLER_WORDS,
        'openai_simulation_allowed_filler_words',
        expect.objectContaining({
          language_code: 'ml-IN',
        }),
        undefined,
        undefined,
      );
      const calls = openAIAutofillService.generateFieldContent.mock.calls;
      const passedContext = calls[calls.length - 1]?.[2];
      expect(passedContext).not.toHaveProperty('emotional_state');
    });

    it('should return generated object content for STATE_INSTRUCTIONS', async () => {
      const dto = {
        fieldName: GeneratableField.STATE_INSTRUCTIONS,
        scenarioContext,
      };
      const generatedContent = [
        {
          stateId: '1',
          instruction: 'Start calm',
          dialogues: ['I feel okay right now.'],
        },
        {
          stateId: '2',
          instruction: 'Show mild anxiety',
          dialogues: ['I am a bit nervous.'],
        },
        {
          stateId: '3',
          instruction: 'Escalate anxiety',
          dialogues: ['I cannot control my thoughts.'],
        },
        {
          stateId: '4',
          instruction: 'Crisis mode',
          dialogues: ['I feel like I cannot breathe.'],
        },
      ];

      openAIAutofillService.generateFieldContent.mockResolvedValue(
        generatedContent,
      );

      const result = await service.generateField(dto);

      expect(result).toEqual({
        fieldName: GeneratableField.STATE_INSTRUCTIONS,
        content: generatedContent,
      });
    });

    it('should set predefinedBehaviorInstructionsDoc and only relevant behaviors when competency has a predefined template', async () => {
      const context = {
        ...scenarioContext,
        competency: 'Promote Realistic Hope',
      };
      const dto = {
        fieldName: GeneratableField.BEHAVIOR_INSTRUCTIONS,
        scenarioContext: context,
      };

      const mockBehaviors = [
        { id: 'uuid-1', name: 'Gives unrealistic promises' },
        { id: 'uuid-2', name: 'Provides no hope for change' },
        { id: 'uuid-3', name: 'Shames client doubts' },
        { id: 'uuid-4', name: 'Expresses pessimism about change' },
        { id: 'uuid-5', name: 'Praises help-seeking behaviour' },
        { id: 'uuid-6', name: 'Encourages realistic optimism' },
        { id: 'uuid-7', name: 'Explores and addresses doubts' },
        { id: 'uuid-8', name: 'Clarifies limits of treatment realistically' },
        { id: 'uuid-9', name: 'Some unrelated behavior' },
      ];

      const mapping = new Map(
        mockBehaviors.map((b, i) => [i + 1, { id: b.id, name: b.name }]),
      );

      behaviorService.getBehaviors.mockResolvedValue({
        data: mockBehaviors as any,
        count: mockBehaviors.length,
      });
      openAIAutofillService.buildBehaviorIdMapping.mockReturnValue({
        mapping,
        formattedList: mockBehaviors
          .map((b, i) => `${i + 1}. ${b.name}`)
          .join('\n'),
      });
      openAIAutofillService.generateFieldContent.mockResolvedValue({
        instructions: [],
        stateNames: [],
      });

      await service.generateField(dto);

      const passedContext =
        openAIAutofillService.generateFieldContent.mock.calls[0][2];

      const predefinedDoc = JSON.parse(
        passedContext.predefinedBehaviorInstructionsDoc!,
      );
      expect(predefinedDoc.SHOULD_NOT_DO).toEqual([1, 2, 3, 4]);
      expect(predefinedDoc.SHOULD_DO).toEqual([5, 6, 7, 8]);

      expect(passedContext.allowedHelperBehaviorsList).not.toContain(
        'Some unrelated behavior',
      );
      expect(passedContext.allowedHelperBehaviorsList).toContain(
        'Gives unrealistic promises',
      );
    });

    it('should use full behavior list when competency has no predefined template', async () => {
      const context = {
        ...scenarioContext,
        competency: 'Unknown Competency',
      };
      const dto = {
        fieldName: GeneratableField.BEHAVIOR_INSTRUCTIONS,
        scenarioContext: context,
      };

      const mockBehaviors = [
        { id: 'uuid-1', name: 'Behavior A' },
        { id: 'uuid-2', name: 'Behavior B' },
      ];

      const fullList = '1. Behavior A\n2. Behavior B';
      const mapping = new Map(
        mockBehaviors.map((b, i) => [i + 1, { id: b.id, name: b.name }]),
      );

      behaviorService.getBehaviors.mockResolvedValue({
        data: mockBehaviors as any,
        count: mockBehaviors.length,
      });
      openAIAutofillService.buildBehaviorIdMapping.mockReturnValue({
        mapping,
        formattedList: fullList,
      });
      openAIAutofillService.generateFieldContent.mockResolvedValue({
        instructions: [],
        stateNames: [],
      });

      await service.generateField(dto);

      const passedContext =
        openAIAutofillService.generateFieldContent.mock.calls[0][2];

      expect(passedContext.predefinedBehaviorInstructionsDoc).toBeUndefined();
      expect(passedContext.allowedHelperBehaviorsList).toBe(fullList);
    });

    it('should throw BadRequestException when no competency is provided for BEHAVIOR_INSTRUCTIONS', async () => {
      const dto = {
        fieldName: GeneratableField.BEHAVIOR_INSTRUCTIONS,
        scenarioContext: { ...scenarioContext },
      };

      await expect(service.generateField(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(behaviorService.getBehaviors).not.toHaveBeenCalled();
    });

    it('should skip unresolvable behavior names from predefined template', async () => {
      const context = {
        ...scenarioContext,
        competency: 'Promote Realistic Hope',
      };
      const dto = {
        fieldName: GeneratableField.BEHAVIOR_INSTRUCTIONS,
        scenarioContext: context,
      };

      const mockBehaviors = [
        { id: 'uuid-1', name: 'Gives unrealistic promises' },
        { id: 'uuid-5', name: 'Praises help-seeking behaviour' },
      ];

      const mapping = new Map(
        mockBehaviors.map((b, i) => [i + 1, { id: b.id, name: b.name }]),
      );

      behaviorService.getBehaviors.mockResolvedValue({
        data: mockBehaviors as any,
        count: mockBehaviors.length,
      });
      openAIAutofillService.buildBehaviorIdMapping.mockReturnValue({
        mapping,
        formattedList: mockBehaviors
          .map((b, i) => `${i + 1}. ${b.name}`)
          .join('\n'),
      });
      openAIAutofillService.generateFieldContent.mockResolvedValue({
        instructions: [],
        stateNames: [],
      });

      await service.generateField(dto);

      const passedContext =
        openAIAutofillService.generateFieldContent.mock.calls[0][2];

      const predefinedDoc = JSON.parse(
        passedContext.predefinedBehaviorInstructionsDoc!,
      );
      expect(predefinedDoc.SHOULD_NOT_DO).toEqual([1]);
      expect(predefinedDoc.SHOULD_DO).toEqual([2]);
    });

    it('should throw BadRequestException for unsupported field name', async () => {
      const dto = {
        fieldName: 'unsupportedField' as GeneratableField,
        scenarioContext,
      };

      await expect(service.generateField(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(openAIAutofillService.generateFieldContent).not.toHaveBeenCalled();
    });

    it('should propagate errors from OpenAIAutofillService', async () => {
      const dto = {
        fieldName: GeneratableField.CHARACTER_PROFILE_TEXT,
        scenarioContext,
      };

      openAIAutofillService.generateFieldContent.mockRejectedValue(
        new Error('OpenAI API error'),
      );

      await expect(service.generateField(dto)).rejects.toThrow(
        'OpenAI API error',
      );
    });
  });

  describe('persistScenarioEventTranslations', () => {
    let mockOpenAITranslationsService: any;
    let mockScenarioEventTranslationsRepository: any;
    let mockLogger: any;

    const languages = [
      { id: 1, translationCode: 'hi-IN', value: 'hi-IN' },
      { id: 2, translationCode: 'ml-IN', value: 'ml-IN' },
    ];

    const metadataExtractor = (event: any) => ({
      message: event.message,
      branchInstruction: event.branchInstruction,
    });

    beforeEach(() => {
      mockOpenAITranslationsService = {
        translateObjectToLanguages: jest.fn(),
      };
      mockScenarioEventTranslationsRepository = {
        getScenarioEventsTranslationsByScenarioIdEventId: jest.fn(),
        createTranslations: jest.fn(),
        updateTranslations: jest.fn(),
      };
      mockLogger = {
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      (service as any).openaiTranslationsService =
        mockOpenAITranslationsService;
      (service as any).scenarioEventTranslationsRepository =
        mockScenarioEventTranslationsRepository;
      (service as any).logger = mockLogger;
    });

    it('should call OpenAI with OPENAI_SESSION_EVENT_TRANSLATION_PROMPT_CODE', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Great job!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockResolvedValue(
        {},
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockOpenAITranslationsService.translateObjectToLanguages,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Great job!' }),
        ['hi-IN', 'ml-IN'],
        toPromptCode('openai_translation', 'session_event'),
      );
    });

    it('should create new translations when none exist', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Well done!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockResolvedValue(
        {
          'hi-IN': { message: 'शाबाश!' },
          'ml-IN': { message: 'നന്നായി!' },
        },
      );

      mockScenarioEventTranslationsRepository.getScenarioEventsTranslationsByScenarioIdEventId.mockResolvedValue(
        [],
      );
      mockScenarioEventTranslationsRepository.createTranslations.mockResolvedValue(
        undefined,
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            scenarioId: 1,
            eventId: 10,
            languageId: 1,
            message: 'शाबाश!',
          }),
          expect.objectContaining({
            scenarioId: 1,
            eventId: 10,
            languageId: 2,
            message: 'നന്നായി!',
          }),
        ]),
      );
      expect(
        mockScenarioEventTranslationsRepository.updateTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should update existing translations when they already exist', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Good!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockResolvedValue(
        {
          'hi-IN': { message: 'अच्छा!' },
          'ml-IN': { message: 'നല്ലത്!' },
        },
      );

      // Both language translations already exist
      mockScenarioEventTranslationsRepository.getScenarioEventsTranslationsByScenarioIdEventId.mockResolvedValue(
        [
          { eventId: 10, languageId: 1 },
          { eventId: 10, languageId: 2 },
        ],
      );
      mockScenarioEventTranslationsRepository.updateTranslations.mockResolvedValue(
        undefined,
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockScenarioEventTranslationsRepository.updateTranslations,
      ).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            eventId: 10,
            languageId: 1,
            message: 'अच्छा!',
          }),
          expect.objectContaining({
            eventId: 10,
            languageId: 2,
            message: 'നല്ലത്!',
          }),
        ]),
      );
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should split into create and update when some translations exist', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Try again!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockResolvedValue(
        {
          'hi-IN': { message: 'फिर कोशिश करो!' },
          'ml-IN': { message: 'വീണ്ടും ശ്രമിക്കൂ!' },
        },
      );

      // Only hi-IN exists already
      mockScenarioEventTranslationsRepository.getScenarioEventsTranslationsByScenarioIdEventId.mockResolvedValue(
        [{ eventId: 10, languageId: 1 }],
      );
      mockScenarioEventTranslationsRepository.createTranslations.mockResolvedValue(
        undefined,
      );
      mockScenarioEventTranslationsRepository.updateTranslations.mockResolvedValue(
        undefined,
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockScenarioEventTranslationsRepository.updateTranslations,
      ).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ eventId: 10, languageId: 1 }),
        ]),
      );
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ eventId: 10, languageId: 2 }),
        ]),
      );
    });

    it('should skip DB ops when OpenAI returns empty result', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Hello!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockResolvedValue(
        {},
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).not.toHaveBeenCalled();
      expect(
        mockScenarioEventTranslationsRepository.updateTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should skip DB ops when OpenAI throws an error', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Hello!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages.mockRejectedValue(
        new Error('OpenAI error'),
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('translation call failed'),
        expect.objectContaining({ languageCodes: ['hi-IN', 'ml-IN'] }),
      );
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).not.toHaveBeenCalled();
      expect(
        mockScenarioEventTranslationsRepository.updateTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should skip event when metadata is empty (no message, no branchInstruction)', async () => {
      const scenarioEvents = [
        { scenarioId: 1, eventId: 10, message: '', branchInstruction: '' },
      ];

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockOpenAITranslationsService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should skip event when languages list is empty', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'Hello!',
          branchInstruction: undefined,
        },
      ];

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        [], // no languages
      );

      expect(
        mockOpenAITranslationsService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).not.toHaveBeenCalled();
    });

    it('should process multiple scenario events independently', async () => {
      const scenarioEvents = [
        {
          scenarioId: 1,
          eventId: 10,
          message: 'First event!',
          branchInstruction: undefined,
        },
        {
          scenarioId: 1,
          eventId: 11,
          message: 'Second event!',
          branchInstruction: undefined,
        },
      ];

      mockOpenAITranslationsService.translateObjectToLanguages
        .mockResolvedValueOnce({
          'hi-IN': { message: 'पहला!' },
          'ml-IN': { message: 'ആദ്യ!' },
        })
        .mockResolvedValueOnce({
          'hi-IN': { message: 'दूसरा!' },
          'ml-IN': { message: 'രണ്ടാമത്!' },
        });

      mockScenarioEventTranslationsRepository.getScenarioEventsTranslationsByScenarioIdEventId.mockResolvedValue(
        [],
      );
      mockScenarioEventTranslationsRepository.createTranslations.mockResolvedValue(
        undefined,
      );

      await service.persistScenarioEventTranslations(
        scenarioEvents,
        metadataExtractor,
        languages,
      );

      expect(
        mockOpenAITranslationsService.translateObjectToLanguages,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockScenarioEventTranslationsRepository.createTranslations,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('hasTranslatableFieldsChanged', () => {
    it('should return true if translations do not exist or are empty', () => {
      const sanitized = { title: 'Title' };

      const scenarioEmpty = { id: 1, title: 'Title', translations: {} } as any;
      expect(
        (service as any).hasTranslatableFieldsChanged(scenarioEmpty, sanitized),
      ).toBe(true);

      const scenarioMissing = { id: 1, title: 'Title' } as any;
      expect(
        (service as any).hasTranslatableFieldsChanged(
          scenarioMissing,
          sanitized,
        ),
      ).toBe(true);
    });

    it('should return false if translatable fields have not changed', () => {
      const scenario = {
        id: 1,
        title: 'Original Title',
        description: 'Original Description',
        metadata: {
          tone: 'Friendly',
          customFields: [{ name: 'Test', value: 'Test' }],
        },
        translations: { hi: { title: 'Translated' } },
      } as any;

      const sanitized = {
        title: 'Original Title',
        description: 'Original Description',
        tone: 'Friendly',
        customFields: [{ name: 'Test', value: 'Test' }],
      };

      expect(
        (service as any).hasTranslatableFieldsChanged(scenario, sanitized),
      ).toBe(false);
    });

    it('should return true if a root field (title or description) has changed', () => {
      const scenario = {
        id: 1,
        title: 'Original Title',
        description: 'Original Description',
        translations: { hi: { title: 'Translated' } },
      } as any;

      const sanitizedTitleChanged = {
        title: 'New Title',
        description: 'Original Description',
      };
      expect(
        (service as any).hasTranslatableFieldsChanged(
          scenario,
          sanitizedTitleChanged,
        ),
      ).toBe(true);

      const sanitizedDescChanged = {
        title: 'Original Title',
        description: 'New Description',
      };
      expect(
        (service as any).hasTranslatableFieldsChanged(
          scenario,
          sanitizedDescChanged,
        ),
      ).toBe(true);
    });

    it('should return true if a metadata field has changed', () => {
      const scenario = {
        id: 1,
        title: 'Original Title',
        metadata: { tone: 'Friendly' },
        translations: { hi: { title: 'Translated' } },
      } as any;

      const sanitizedToneChanged = {
        title: 'Original Title',
        tone: 'Professional',
      };

      expect(
        (service as any).hasTranslatableFieldsChanged(
          scenario,
          sanitizedToneChanged,
        ),
      ).toBe(true);
    });

    it('should correctly handle deep JSON equality checks for arrays/objects', () => {
      const scenario = {
        id: 1,
        metadata: {
          customFields: [
            { name: 'Field 1', value: 'Value 1' },
            { name: 'Field 2', value: 'Value 2' },
          ],
        },
        translations: { hi: { title: 'Translated' } },
      } as any;

      const sanitizedSame = {
        customFields: [
          { name: 'Field 1', value: 'Value 1' },
          { name: 'Field 2', value: 'Value 2' },
        ],
      };
      expect(
        (service as any).hasTranslatableFieldsChanged(scenario, sanitizedSame),
      ).toBe(false);

      const sanitizedDifferent = {
        customFields: [
          { name: 'Field 1', value: 'Value 1' },
          { name: 'Field X', value: 'Value X' },
        ],
      };
      expect(
        (service as any).hasTranslatableFieldsChanged(
          scenario,
          sanitizedDifferent,
        ),
      ).toBe(true);
    });
  });

  describe('getAvailableModels', () => {
    it('should merge OpenAI and Anthropic models into a single list', async () => {
      const openaiModels = [
        { value: 'gpt-4o', label: 'gpt-4o', provider: 'openai' },
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini', provider: 'openai' },
      ];
      const anthropicModels = [
        {
          value: 'claude-sonnet-4-6',
          label: 'claude-sonnet-4-6',
          provider: 'anthropic',
        },
      ];

      openAIAutofillService.getAvailableModels.mockResolvedValue(openaiModels);
      anthropicAutofillService.getAvailableModels.mockResolvedValue(
        anthropicModels,
      );

      const result = await service.getAvailableModels();

      expect(result).toEqual([...openaiModels, ...anthropicModels]);
    });

    it('should preserve provider tags from each service', async () => {
      openAIAutofillService.getAvailableModels.mockResolvedValue([
        { value: 'gpt-4o', label: 'gpt-4o', provider: 'openai' },
      ]);
      anthropicAutofillService.getAvailableModels.mockResolvedValue([
        {
          value: 'claude-sonnet-4-6',
          label: 'claude-sonnet-4-6',
          provider: 'anthropic',
        },
      ]);

      const result = await service.getAvailableModels();

      expect(result.find((m) => m.value === 'gpt-4o')?.provider).toBe('openai');
      expect(
        result.find((m) => m.value === 'claude-sonnet-4-6')?.provider,
      ).toBe('anthropic');
    });

    it('should return only OpenAI models when Anthropic returns empty list', async () => {
      const openaiModels = [
        { value: 'gpt-4o', label: 'gpt-4o', provider: 'openai' },
      ];
      openAIAutofillService.getAvailableModels.mockResolvedValue(openaiModels);
      anthropicAutofillService.getAvailableModels.mockResolvedValue([]);

      const result = await service.getAvailableModels();

      expect(result).toEqual(openaiModels);
    });
  });

  describe('generateField - provider routing', () => {
    const scenarioContext = { title: 'Test', name: 'John', age: 30 };

    it('should route to OpenAIAutofillService when provider is openai', async () => {
      openAIAutofillService.generateFieldContent.mockResolvedValue(
        'openai result',
      );

      await service.generateField({
        fieldName: GeneratableField.DESCRIPTION,
        scenarioContext,
        provider: 'openai',
      });

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalled();
      expect(
        anthropicAutofillService.generateFieldContent,
      ).not.toHaveBeenCalled();
    });

    it('should route to AnthropicAutofillService when provider is anthropic', async () => {
      anthropicAutofillService.generateFieldContent.mockResolvedValue(
        'anthropic result',
      );

      await service.generateField({
        fieldName: GeneratableField.DESCRIPTION,
        scenarioContext,
        provider: 'anthropic',
      });

      expect(anthropicAutofillService.generateFieldContent).toHaveBeenCalled();
      expect(openAIAutofillService.generateFieldContent).not.toHaveBeenCalled();
    });

    it('should default to OpenAIAutofillService when provider is not specified', async () => {
      openAIAutofillService.generateFieldContent.mockResolvedValue(
        'default result',
      );

      await service.generateField({
        fieldName: GeneratableField.DESCRIPTION,
        scenarioContext,
      });

      expect(openAIAutofillService.generateFieldContent).toHaveBeenCalled();
      expect(
        anthropicAutofillService.generateFieldContent,
      ).not.toHaveBeenCalled();
    });

    it('should pass model override to AnthropicAutofillService', async () => {
      anthropicAutofillService.generateFieldContent.mockResolvedValue('result');

      await service.generateField({
        fieldName: GeneratableField.DESCRIPTION,
        scenarioContext,
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      });

      expect(
        anthropicAutofillService.generateFieldContent,
      ).toHaveBeenCalledWith(
        GeneratableField.DESCRIPTION,
        expect.any(String),
        scenarioContext,
        undefined,
        'claude-haiku-4-5',
      );
    });
  });
});
