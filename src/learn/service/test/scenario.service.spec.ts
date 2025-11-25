import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  Gender,
  GenderIdentity,
  SexualOrientation,
} from 'src/learn/enum/gender.enum';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  Repository,
  EntityManager,
  UpdateResult,
  In,
  DataSource,
} from 'typeorm';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { DeleteCoverVideoDto } from 'src/learn/dto/delete-cover-video.dto';
import { ScenarioVideoUploadRequestDto } from 'src/learn/dto/scenario-video-upload-request.dto';
import { ScenarioVideoUploadContentType } from 'src/learn/enum/scenario-video-upload-content-type';
import { TenantService } from 'src/tenant/service/tenant.service';

import { Pagination } from 'src/common/type/common.type';
import { CreateScenariosDto } from 'src/learn/dto/create-scenarios.dto';
import { UpdateScenarioDto } from 'src/learn/dto/update-scenario.dto';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/enum/scenario.status.enum';
import { ScenarioEventsRepository } from 'src/learn/repository/scenario-events.repository';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { ScenarioService } from '../scenario.service';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
  },
}));

describe('ScenarioService', () => {
  let service: ScenarioService;
  let repository: jest.Mocked<Repository<Scenarios>>;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let scenarioEventsRepository: jest.Mocked<ScenarioEventsRepository>;
  let sessionEventService: jest.Mocked<SessionEventService>;
  let scenarioVoiceRepository: jest.Mocked<ScenarioVoicesRepository>;
  let tenantService: jest.Mocked<TenantService>;
  let dataSource: jest.Mocked<DataSource>;

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
      agentGoal: 'Help client',
      name: 'Test Client',
      age: 30,
      voiceId: 'voice-123',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    createdBy: 1,
    updatedBy: 1,
  } as unknown as Scenarios;

  const mockCreateScenariosDto: CreateScenariosDto = {
    scenarios: [
      {
        title: 'New Scenario',
        description: 'New description',
        coverImageUrl: 'https://example.com/new-cover.jpg',
        status: ScenarioStatus.ACTIVE,
        prompt: 'You are a counselor helping a client with depression',
        agentGoal: 'Help the client overcome depression',
        lifeHistory: 'Life history of the client',
        name: 'Ahana',
        voiceId: '123e4567-e89b-12d3-a456-426614174000',
        age: 25,
        gender: Gender.FEMALE,
        genderIdentity: GenderIdentity.FEMALE_WOMAN,
        sexualOrientation: SexualOrientation.HETEROSEXUAL,
        currentLocation: 'New York, USA',
        profession: 'Software Engineer',
        context: 'Context of the client',
        sessionBehaviorGuidelines: 'Session behavior guidelines',
        coreMemories: 'Core memories of the client',
        personality: 'Personality of the client',
        startingState: 'Starting state of the client',
        emotionalNeeds: 'Emotional needs of the client',
        tone: 'Tone of the client',
        openingStatements: [
          'Opening statements of the client',
          'Opening statements of the client 2',
        ],
        isGlobal: false,
      },
    ],
  };

  const mockUpdateScenarioDto: UpdateScenarioDto = {
    title: 'Updated Scenario',
    prompt: 'Updated prompt for counselor guidance',
  };

  beforeEach(async () => {
    const mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockScenariosRepository = {
      getAdminScenarios: jest.fn(),
      getAdminScenarioById: jest.fn(),
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
      delete: jest.fn(),
      getScenarioEvents: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
    };

    const mockSessionEventService = {
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

    const mockS3Service = {
      generatePresignedUrl: jest.fn(),
      uploadFile: jest.fn(),
      deleteFile: jest.fn(),
      deleteObject: jest.fn(),
      sanitizeFileName: jest.fn((fileName) => fileName),
    };

    const mockConfigService = {
      s3: {
        learnMediaPublicBucket: 'test-bucket',
      },
      aws: {
        region: 'us-east-1',
      },
    };

    const mockTenantService = {
      findAll: jest.fn(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn(),
      transaction: jest.fn(),
    };

    // Setup ExecutionManager mock
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
          provide: SessionEventService,
          useValue: mockSessionEventService,
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
      ],
    }).compile();

    service = module.get<ScenarioService>(ScenarioService);
    repository = module.get(getRepositoryToken(Scenarios));
    scenariosRepository = module.get(ScenariosRepository);
    scenarioEventsRepository = module.get(ScenarioEventsRepository);
    sessionEventService = module.get(SessionEventService);
    scenarioVoiceRepository = module.get(ScenarioVoicesRepository);
    tenantService = module.get(TenantService);
    dataSource = module.get(DataSource);
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
      expect(sessionEventService).toBeDefined();
      expect(scenarioVoiceRepository).toBeDefined();
      expect(tenantService).toBeDefined();
    });
  });

  describe('getScenarios', () => {
    it('should return array of scenarios', async () => {
      const mockScenarios = [mockScenario];
      scenariosRepository.find.mockResolvedValue(mockScenarios);

      const result = await service.getScenarios();

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.find).toHaveBeenCalledWith({
        select: [
          'id',
          'title',
          'scenario',
          'description',
          'coverImageUrl',
          'coverVideoUrl',
          'status',
        ],
        where: {
          status: In([ScenarioStatus.ACTIVE, ScenarioStatus.COMING_SOON]),
        },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    });

    it('should return empty array when no scenarios exist', async () => {
      scenariosRepository.find.mockResolvedValue([]);

      const result = await service.getScenarios();

      expect(result).toEqual([]);
      expect(scenariosRepository.find).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      const error = new Error('Database error');
      scenariosRepository.find.mockRejectedValue(error);

      await expect(service.getScenarios()).rejects.toThrow('Database error');
    });
  });

  describe('getAdminScenarios', () => {
    const mockRawAdminScenariosData = [
      {
        scenario_id: 1,
        scenario_title: 'Scenario 1',
        scenario_createdAt: new Date('2025-01-01'),
        scenario_updatedAt: new Date('2025-01-02'),
        scenario_scenario: 'Content 1',
        scenario_description: 'Description 1',
        scenario_coverImageUrl: 'https://example.com/cover1.jpg',
        scenario_coverVideoUrl: null,
        scenario_metadata: {
          agentGoal: 'Help the user',
          lifeHistory: 'Life history content',
          voiceId: 'voice-123',
          name: 'John',
          age: 30,
          gender: 'Male',
          currentLocation: 'New York',
          context: 'Context content',
          openingStatements: ['Hello', 'Welcome'],
        },
        user_name: 'John Doe',
        scenario_status: 'ACTIVE',
        usage: 5,
        isAssignedToTenant: true,
      },
    ];

    it('should return scenarios without filters', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios();

      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(1);
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });

    it('should return scenarios with pagination options', async () => {
      const options: Pagination = {
        limit: 10,
        offset: 0,
      };

      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios(
        undefined,

        options,
      );

      expect(result.data).toBeDefined();
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        undefined,
        options,
      );
    });

    it('should return empty data array when no scenarios found', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue([]);

      const result = await service.getAdminScenarios();

      expect(result).toEqual({ data: [] });
    });
  });

  describe('getScenario', () => {
    it('should throw NotFoundException when scenario is not found', async () => {
      const scenarioId = 999;
      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(service.getScenario(scenarioId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenario(scenarioId)).rejects.toThrow(
        'Scenario not found',
      );
    });

    it('should return scenario by id without select parameter', async () => {
      const scenarioId = 1;
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getScenario(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        select: undefined,
        where: {
          id: scenarioId,
          status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
        },
      });
    });

    it('should return scenario by id with select parameter', async () => {
      const scenarioId = 1;
      const selectFields: (keyof Scenarios)[] = [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'status',
      ];
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getScenario(scenarioId, selectFields);

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        select: selectFields,
        where: {
          id: scenarioId,
          status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
        },
      });
    });

    it('should return scenario by id using EntityManager', async () => {
      const scenarioId = 1;
      const mockFindOne = jest.fn().mockResolvedValue(mockScenario);
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: mockFindOne,
        }),
      } as unknown as EntityManager;

      const result = await service.getScenario(
        scenarioId,
        undefined,
        mockEntityManager,
      );

      expect(result).toEqual(mockScenario);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockFindOne).toHaveBeenCalledWith({
        select: undefined,
        where: {
          id: scenarioId,
          status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
        },
      });
      expect(scenariosRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('createScenarios', () => {
    const mockUserId = 1;

    it('should create scenarios and handle global scenarios with tenant mappings', async () => {
      const globalScenarioDto: CreateScenariosDto = {
        scenarios: [
          {
            ...mockCreateScenariosDto.scenarios[0],
            isGlobal: true,
          },
        ],
      };

      const mockTenants = [
        { id: 'tenant-1', name: 'Tenant 1' },
        { id: 'tenant-2', name: 'Tenant 2' },
      ];

      const createdScenarios = [{ ...mockScenario, id: 1, isGlobal: true }];

      const mockScenariosRepo = {
        create: jest.fn().mockReturnValue(createdScenarios as any),
        save: jest.fn().mockResolvedValue(createdScenarios as any),
      };

      const mockScenarioEventsRepo = {
        create: jest.fn().mockReturnValue([]),
        save: jest.fn().mockResolvedValue([]),
      };

      const mockScenarioTenantsRepo = {
        create: jest.fn().mockImplementation((data) => data),
        save: jest.fn().mockResolvedValue([]),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return mockScenarioEventsRepo;
          }
          if (entity === ScenarioTenants) {
            return mockScenarioTenantsRepo;
          }
          return {};
        }),
      };

      const mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });

      const mockVoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Voice',
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      tenantService.findAll.mockResolvedValue(mockTenants as any);

      const result = await service.createScenarios(
        globalScenarioDto,
        mockUserId,
      );

      expect(result).toEqual(createdScenarios);
      expect(tenantService.findAll).toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.create).toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.save).toHaveBeenCalled();
    });

    it('should create scenarios without global tenant mappings', async () => {
      const nonGlobalDto: CreateScenariosDto = {
        scenarios: [
          {
            ...mockCreateScenariosDto.scenarios[0],
            isGlobal: false,
          },
        ],
      };

      const createdScenarios = [{ ...mockScenario, id: 1, isGlobal: false }];

      const mockScenariosRepo = {
        create: jest.fn().mockReturnValue(createdScenarios as any),
        save: jest.fn().mockResolvedValue(createdScenarios as any),
      };

      const mockScenarioEventsRepo = {
        create: jest.fn().mockReturnValue([]),
        save: jest.fn().mockResolvedValue([]),
      };

      const mockScenarioTenantsRepo = {
        create: jest.fn(),
        save: jest.fn(),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return mockScenarioEventsRepo;
          }
          if (entity === ScenarioTenants) {
            return mockScenarioTenantsRepo;
          }
          return {};
        }),
      };

      const mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });

      const mockVoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Voice',
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);

      const result = await service.createScenarios(nonGlobalDto, mockUserId);

      expect(result).toEqual(createdScenarios);
      expect(tenantService.findAll).not.toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.create).not.toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.save).not.toHaveBeenCalled();
    });

    it('should create auto-termination events when provided', async () => {
      const dtoWithTermination: CreateScenariosDto = {
        scenarios: [
          {
            ...mockCreateScenariosDto.scenarios[0],
            autoTerminationStatus: true,
            terminationEventId: 'event-123',
            terminationMessage: 'Session terminated',
          },
        ],
      };

      const createdScenarios = [{ ...mockScenario, id: 1 }];

      const mockScenariosRepo = {
        create: jest.fn().mockReturnValue(createdScenarios as any),
        save: jest.fn().mockResolvedValue(createdScenarios as any),
      };

      const mockTerminationEvents = [
        {
          scenarioId: 1,
          eventId: 'event-123',
          autoTerminationStatus: true,
          message: 'Session terminated',
        },
      ];

      const mockScenarioEventsRepo = {
        create: jest.fn().mockReturnValue(mockTerminationEvents),
        save: jest.fn().mockResolvedValue(mockTerminationEvents),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return mockScenarioEventsRepo;
          }
          return {};
        }),
      };

      const mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });

      const mockVoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Voice',
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);

      const result = await service.createScenarios(
        dtoWithTermination,
        mockUserId,
      );

      expect(result).toEqual(createdScenarios);
      expect(mockScenarioEventsRepo.create).toHaveBeenCalled();
      expect(mockScenarioEventsRepo.save).toHaveBeenCalledWith(
        mockTerminationEvents,
      );
    });

    it('should throw NotFoundException when voice not found', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createScenarios(mockCreateScenariosDto, mockUserId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createScenarios(mockCreateScenariosDto, mockUserId),
      ).rejects.toThrow('Scenario voice not found');
    });

    it('should throw BadRequestException for ACTIVE status without required fields', async () => {
      const invalidDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Test',
            status: ScenarioStatus.ACTIVE,
            prompt: 'Test prompt',
            isGlobal: false,
            // Missing required fields like agentGoal, lifeHistory, etc.
          },
        ],
      };

      await expect(
        service.createScenarios(invalidDto, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow DRAFT status with minimal fields', async () => {
      const draftDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Draft Scenario',
            status: ScenarioStatus.DRAFT,
            prompt: 'Draft prompt',
            isGlobal: false,
          },
        ],
      };

      const createdScenarios = [
        {
          ...mockScenario,
          id: 1,
          status: ScenarioStatus.DRAFT,
          title: 'Draft Scenario',
        },
      ];

      const mockScenariosRepo = {
        create: jest.fn().mockReturnValue(createdScenarios as any),
        save: jest.fn().mockResolvedValue(createdScenarios as any),
      };

      const mockScenarioEventsRepo = {
        create: jest.fn().mockReturnValue([]),
        save: jest.fn().mockResolvedValue([]),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return mockScenarioEventsRepo;
          }
          return {};
        }),
      };

      const mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });

      const result = await service.createScenarios(draftDto, mockUserId);

      expect(result).toEqual(createdScenarios);
    });
  });

  describe('updateScenario', () => {
    const mockUserId = 1;
    let mockTransaction: jest.Mock;
    let mockEntityManager: any;
    let mockScenariosRepo: any;
    let mockScenarioEventsRepo: any;
    let mockScenarioTenantsRepo: any;

    beforeEach(() => {
      mockScenariosRepo = {
        update: jest.fn(),
        findOne: jest.fn(),
      };
      mockScenarioEventsRepo = {
        update: jest.fn(),
        findOne: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      mockScenarioTenantsRepo = {
        create: jest.fn().mockImplementation((data) => data),
        save: jest.fn(),
        delete: jest.fn(),
      };
      mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === Scenarios) {
            return mockScenariosRepo;
          }
          if (entity === ScenarioEvents) {
            return mockScenarioEventsRepo;
          }
          if (entity === ScenarioTenants) {
            return mockScenarioTenantsRepo;
          }
          return {};
        }),
      };

      mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });
    });

    it('should throw NotFoundException when scenario to update is not found', async () => {
      const scenarioId = 999;
      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenario(scenarioId, mockUpdateScenarioDto, mockUserId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateScenario(scenarioId, mockUpdateScenarioDto, mockUserId),
      ).rejects.toThrow('Scenario not found');
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should update scenario and return true when affected > 0', async () => {
      const scenarioId = 1;
      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(mockScenario);

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockScenariosRepo.update).toHaveBeenCalledWith(
        scenarioId,
        expect.objectContaining({
          updatedBy: mockUserId,
        }),
      );
    });

    it('should update scenario and return false when affected = 0', async () => {
      const scenarioId = 1;
      const updateResult: UpdateResult = {
        affected: 0,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
        mockUserId,
      );

      expect(result).toBe(false);
      expect(mockScenariosRepo.update).toHaveBeenCalledWith(
        scenarioId,
        expect.objectContaining({
          updatedBy: mockUserId,
        }),
      );
    });

    it('should update scenario to global and create tenant mappings', async () => {
      const scenarioId = 1;
      const nonGlobalScenario = { ...mockScenario, isGlobal: false };
      const updatedGlobalScenario = { ...mockScenario, isGlobal: true };
      const updateDto: UpdateScenarioDto = {
        isGlobal: true,
      };

      const mockTenants = [
        { id: 'tenant-1', name: 'Tenant 1' },
        { id: 'tenant-2', name: 'Tenant 2' },
      ];

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(nonGlobalScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(updatedGlobalScenario);
      tenantService.findAll.mockResolvedValue(mockTenants as any);

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(tenantService.findAll).toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.save).toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.create).toHaveBeenCalledWith([
        { scenarioId, tenantId: 'tenant-1' },
        { scenarioId, tenantId: 'tenant-2' },
      ]);
    });

    it('should update scenario from global to non-global and delete tenant mappings', async () => {
      const scenarioId = 1;
      const globalScenario = { ...mockScenario, isGlobal: true };
      const updatedNonGlobalScenario = { ...mockScenario, isGlobal: false };
      const updateDto: UpdateScenarioDto = {
        isGlobal: false,
      };

      const mockTenants = [
        { id: 'tenant-1', name: 'Tenant 1' },
        { id: 'tenant-2', name: 'Tenant 2' },
      ];

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(globalScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(updatedNonGlobalScenario);
      tenantService.findAll.mockResolvedValue(mockTenants as any);

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(tenantService.findAll).toHaveBeenCalled();
      expect(mockScenarioTenantsRepo.delete).toHaveBeenCalledWith({
        scenarioId,
        tenantId: In(['tenant-1', 'tenant-2']),
      });
    });

    it('should update existing termination event message when same event ID', async () => {
      const scenarioId = 1;
      const existingTerminationEvent = {
        scenarioId: 1,
        eventId: 'event-1',
        autoTerminationStatus: true,
        message: 'Old message',
      };

      const updateDto: UpdateScenarioDto = {
        autoTerminationStatus: true,
        terminationEventId: 'event-1',
        terminationMessage: 'Updated termination message',
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(mockScenario);
      mockScenarioEventsRepo.findOne.mockResolvedValue(
        existingTerminationEvent,
      );
      mockScenarioEventsRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(mockScenarioEventsRepo.findOne).toHaveBeenCalledWith({
        where: { scenarioId, autoTerminationStatus: true },
      });
      expect(mockScenarioEventsRepo.update).toHaveBeenCalledWith(
        {
          scenarioId,
          eventId: 'event-1',
          autoTerminationStatus: true,
        },
        { message: 'Updated termination message' },
      );
      expect(mockScenarioEventsRepo.delete).not.toHaveBeenCalled();
    });

    it('should delete old termination event and create new one when event ID changes', async () => {
      const scenarioId = 1;
      const existingTerminationEvent = {
        scenarioId: 1,
        eventId: 'event-old',
        autoTerminationStatus: true,
        message: 'Old message',
      };

      const updateDto: UpdateScenarioDto = {
        autoTerminationStatus: true,
        terminationEventId: 'event-new',
        terminationMessage: 'New termination message',
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      const newTerminationEvent = {
        scenarioId: 1,
        eventId: 'event-new',
        autoTerminationStatus: true,
        message: 'New termination message',
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(mockScenario);
      mockScenarioEventsRepo.findOne.mockResolvedValue(
        existingTerminationEvent,
      );
      mockScenarioEventsRepo.create.mockReturnValue(newTerminationEvent);

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(mockScenarioEventsRepo.delete).toHaveBeenCalledWith({
        scenarioId,
        eventId: 'event-old',
        autoTerminationStatus: true,
      });
      expect(mockScenarioEventsRepo.create).toHaveBeenCalledWith({
        scenarioId,
        eventId: 'event-new',
        autoTerminationStatus: true,
        message: 'New termination message',
      });
    });

    it('should delete termination event when autoTerminationStatus is false', async () => {
      const scenarioId = 1;
      const existingTerminationEvent = {
        scenarioId: 1,
        eventId: 'event-1',
        autoTerminationStatus: true,
      };

      const updateDto: UpdateScenarioDto = {
        title: 'Updated Title',
        autoTerminationStatus: false,
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(mockScenario);
      mockScenarioEventsRepo.findOne.mockResolvedValue(
        existingTerminationEvent,
      );
      mockScenarioEventsRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(mockScenarioEventsRepo.findOne).toHaveBeenCalledWith({
        where: { scenarioId, autoTerminationStatus: true },
      });
      expect(mockScenarioEventsRepo.delete).toHaveBeenCalledWith({
        scenarioId,
        eventId: 'event-1',
        autoTerminationStatus: true,
      });
    });

    it('should handle metadata updates correctly', async () => {
      const scenarioId = 1;
      const updateDto: UpdateScenarioDto = {
        agentGoal: 'New agent goal',
        name: 'Updated Name',
        age: 35,
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      mockScenariosRepo.update.mockResolvedValue(updateResult);
      mockScenariosRepo.findOne.mockResolvedValue(mockScenario);

      const result = await service.updateScenario(
        scenarioId,
        updateDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(mockScenariosRepo.update).toHaveBeenCalledWith(
        scenarioId,
        expect.objectContaining({
          metadata: expect.objectContaining({
            agentGoal: 'New agent goal',
            name: 'Updated Name',
            age: 35,
          }),
          updatedBy: mockUserId,
        }),
      );
    });
  });

  describe('deleteAdminScenario', () => {
    const scenarioId = 1;

    it('should throw NotFoundException when scenario not found', async () => {
      scenariosRepository.getAdminScenarioById.mockResolvedValue(null);

      await expect(service.deleteAdminScenario(scenarioId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteAdminScenario(scenarioId)).rejects.toThrow(
        'Scenario not found',
      );
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

      mockS3Service.deleteObject = jest.fn().mockResolvedValue(true);
      mockLogger.warn = jest.fn();
      mockLogger.error = jest.fn();
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
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
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
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: https://invalid-url.com/test.jpg',
      );
      expect(mockS3Service.deleteObject).not.toHaveBeenCalled();
    });

    it('should return { success: false } and log warning for malformed S3 URL', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: 'not-a-valid-url',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: not-a-valid-url',
      );
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
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to delete uploaded cover image with error',
        ),
      );
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
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid or unrecognized S3 URL: ',
      );
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

      await service.deleteCoverImage(deleteCoverImageDto);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to delete uploaded cover image with error ${JSON.stringify(s3Error)}`,
      );
    });

    it('should return { success: false } for S3 URL without storage key', async () => {
      const deleteCoverImageDto = {
        coverImageUrl: 'https://test-bucket.s3.us-east-1.amazonaws.com/',
      };

      const result = await service.deleteCoverImage(deleteCoverImageDto);

      expect(result).toEqual({ success: false });
      expect(mockLogger.warn).toHaveBeenCalled();
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
});
