import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScenarioService } from '../scenario.service';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { CreateScenariosDto } from '../../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../../dto/update-scenario.dto';
import { Pagination } from 'src/common/type/common.type';
import { CreateScenarioEventsDto } from '../../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../../dto/delete-scenario-events.dto';
import { ScenarioEvents } from '../../entity/scenario-events.entity';
import { ScenarioVoicesRepository } from '../../repository/scenario-voices.repository';
import { ScenarioEventsRepository } from '../../repository/scenario-events.repository';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
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
  let scenarioEventsRepository: jest.Mocked<Repository<ScenarioEvents>>;
  let sessionEventService: jest.Mocked<SessionEventService>;
  let scenarioVoiceRepository: jest.Mocked<ScenarioVoicesRepository>;

  const mockTenantId = 'tenant-123';
  const mockScenarioId = 1;

  const mockScenario: Scenarios = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test description',
    coverImageUrl: 'https://example.com/cover.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor helping a client with anxiety',
    metadata: {
      difficulty: 'intermediate',
      tags: ['anxiety', 'counseling'],
      duration: 30,
      objectives: ['active listening', 'empathy building'],
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    tenantId: 1,
    createdBy: 1,
  } as Scenarios;

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
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockScenarioEventsRepository = {
      save: jest.fn(),
      delete: jest.fn(),
      getScenarioEvents: jest.fn(),
    };

    const mockSessionEventService = {
      findByIds: jest.fn(),
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
    };

    const mockConfigService = {
      get: jest.fn(),
      scenarioCoverImageBucket: 'test-bucket',
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have scenarioRepository injected', () => {
      expect(repository).toBeDefined();
    });

    it('should have scenariosRepository injected', () => {
      expect(scenariosRepository).toBeDefined();
    });

    it('should have scenarioEventsRepository injected', () => {
      expect(scenarioEventsRepository).toBeDefined();
    });

    it('should have sessionEventService injected', () => {
      expect(sessionEventService).toBeDefined();
    });

    it('should have scenarioVoiceRepository injected', () => {
      expect(scenarioVoiceRepository).toBeDefined();
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

    it('should call find with correct select fields', async () => {
      scenariosRepository.find.mockResolvedValue([mockScenario]);

      await service.getScenarios();

      expect(scenariosRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.arrayContaining([
            'id',
            'title',
            'scenario',
            'description',
            'coverImageUrl',
            'status',
          ]),
          where: {
            status: In([ScenarioStatus.ACTIVE, ScenarioStatus.COMING_SOON]),
          },
        }),
      );
    });

    it('should call find with correct order', async () => {
      scenariosRepository.find.mockResolvedValue([mockScenario]);

      await service.getScenarios();

      expect(scenariosRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database error');
      scenariosRepository.find.mockRejectedValue(error);

      await expect(service.getScenarios()).rejects.toThrow('Database error');
    });
  });

  describe('getAdminScenarios', () => {
    // Raw data from repository with snake_case column names
    const mockRawAdminScenariosData = [
      {
        scenario_id: 1,
        scenario_title: 'Scenario 1',
        scenario_createdAt: new Date('2025-01-01'),
        scenario_updatedAt: new Date('2025-01-02'),
        scenario_scenario: 'Content 1',
        scenario_description: 'Description 1',
        scenario_coverImageUrl: 'https://example.com/cover1.jpg',
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
      },
      {
        scenario_id: 2,
        scenario_title: 'Scenario 2',
        scenario_createdAt: new Date('2025-01-03'),
        scenario_updatedAt: new Date('2025-01-04'),
        scenario_scenario: 'Content 2',
        scenario_description: 'Description 2',
        scenario_coverImageUrl: 'https://example.com/cover2.jpg',
        scenario_metadata: {
          agentGoal: 'Help the user 2',
          lifeHistory: 'Life history content 2',
          voiceId: 'voice-456',
          name: 'Jane',
          age: 25,
          gender: 'Female',
          currentLocation: 'Los Angeles',
          context: 'Context content 2',
          openingStatements: ['Hi', 'Greetings'],
        },
        user_name: 'Jane Smith',
        scenario_status: 'INACTIVE',
        usage: 3,
      },
    ];

    // Expected mapped data with transformed field names
    const mockMappedAdminScenariosData = [
      {
        id: 1,
        title: 'Scenario 1',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
        scenario: 'Content 1',
        description: 'Description 1',
        coverImageUrl: 'https://example.com/cover1.jpg',
        createdBy: 'John Doe',
        status: 'ACTIVE',
        usage: 5,
        isPreviewEnabled: true,
      },
      {
        id: 2,
        title: 'Scenario 2',
        createdAt: new Date('2025-01-03'),
        updatedAt: new Date('2025-01-04'),
        scenario: 'Content 2',
        description: 'Description 2',
        coverImageUrl: 'https://example.com/cover2.jpg',
        createdBy: 'Jane Smith',
        status: 'INACTIVE',
        usage: 3,
        isPreviewEnabled: true,
      },
    ];

    it('should return scenarios without filters', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios();

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it('should return scenarios with status filter', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios('ACTIVE');

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        'ACTIVE',
        undefined,
      );
    });

    it('should return scenarios with multiple status filters', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios('ACTIVE,INACTIVE');

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        'ACTIVE,INACTIVE',
        undefined,
      );
    });

    it('should return scenarios with pagination options', async () => {
      const options: Pagination = {
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        order: 'DESC',
      };

      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios(undefined, options);

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        undefined,
        options,
      );
    });

    it('should return scenarios with both status and pagination', async () => {
      const options: Pagination = {
        limit: 5,
        offset: 10,
        sortBy: 'name',
        order: 'ASC',
      };

      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios('ACTIVE,DRAFT', options);

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        'ACTIVE,DRAFT',
        options,
      );
    });

    it('should return empty data array when no scenarios found', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue([]);

      const result = await service.getAdminScenarios();

      expect(result).toEqual({ data: [] });
    });

    it('should handle repository errors', async () => {
      const error = new Error('Repository error');
      scenariosRepository.getAdminScenarios.mockRejectedValue(error);

      await expect(service.getAdminScenarios()).rejects.toThrow(
        'Repository error',
      );
    });

    it('should pass all pagination parameters correctly', async () => {
      const options: Pagination = {
        limit: 20,
        offset: 40,
        sortBy: 'updatedAt',
        order: 'ASC',
      };

      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      await service.getAdminScenarios('DRAFT', options);

      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        'DRAFT',
        expect.objectContaining({
          limit: 20,
          offset: 40,
          sortBy: 'updatedAt',
          order: 'ASC',
        }),
      );
    });

    it('should handle empty string status filter', async () => {
      scenariosRepository.getAdminScenarios.mockResolvedValue(
        mockRawAdminScenariosData,
      );

      const result = await service.getAdminScenarios('');

      expect(result).toEqual({ data: mockMappedAdminScenariosData });
      expect(scenariosRepository.getAdminScenarios).toHaveBeenCalledWith(
        '',
        undefined,
      );
    });

    it('should correctly map all fields from repository response', async () => {
      const singleItemRaw = [mockRawAdminScenariosData[0]];
      const singleItemMapped = [mockMappedAdminScenariosData[0]];

      scenariosRepository.getAdminScenarios.mockResolvedValue(singleItemRaw);

      const result = await service.getAdminScenarios();

      expect(result.data[0]).toMatchObject({
        id: singleItemMapped[0].id,
        title: singleItemMapped[0].title,
        createdAt: singleItemMapped[0].createdAt,
        updatedAt: singleItemMapped[0].updatedAt,
        scenario: singleItemMapped[0].scenario,
        description: singleItemMapped[0].description,
        coverImageUrl: singleItemMapped[0].coverImageUrl,
        createdBy: singleItemMapped[0].createdBy,
        status: singleItemMapped[0].status,
        usage: singleItemMapped[0].usage,
        isPreviewEnabled: singleItemMapped[0].isPreviewEnabled,
      });
    });
  });

  describe('getScenario', () => {
    it('should throw NotFoundException when scenario is not found', async () => {
      const scenarioId = 999;
      repository.findOne.mockResolvedValue(null);

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
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('should return scenario by id using EntityManager with select parameter', async () => {
      const scenarioId = 1;
      const selectFields: (keyof Scenarios)[] = ['id', 'title', 'prompt'];
      const mockFindOne = jest.fn().mockResolvedValue(mockScenario);
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: mockFindOne,
        }),
      } as unknown as EntityManager;

      const result = await service.getScenario(
        scenarioId,
        selectFields,
        mockEntityManager,
      );

      expect(result).toEqual(mockScenario);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockFindOne).toHaveBeenCalledWith({
        select: selectFields,
        where: {
          id: scenarioId,
          status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
        },
      });
    });

    it('should throw NotFoundException when scenario is not found with EntityManager', async () => {
      const scenarioId = 999;
      const mockFindOne = jest.fn().mockResolvedValue(null);
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: mockFindOne,
        }),
      } as unknown as EntityManager;

      await expect(
        service.getScenario(scenarioId, undefined, mockEntityManager),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getScenario(scenarioId, undefined, mockEntityManager),
      ).rejects.toThrow('Scenario not found');
    });

    it('should use default repository when EntityManager is not provided', async () => {
      const scenarioId = 1;
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      await service.getScenario(scenarioId);

      expect(scenariosRepository.findOne).toHaveBeenCalled();
    });

    it('should handle different scenario ids', async () => {
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      await service.getScenario(5);

      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        select: undefined,
        where: {
          id: 5,
          status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
        },
      });
    });

    it('should handle database errors', async () => {
      const error = new Error('Database query failed');
      scenariosRepository.findOne.mockRejectedValue(error);

      await expect(service.getScenario(1)).rejects.toThrow(
        'Database query failed',
      );
    });
  });

  describe('createScenarios', () => {
    const mockUserId = 1;

    it('should create and return scenarios', async () => {
      const mockVoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const expectedScenarioDtos = [
        {
          createdBy: mockUserId,
          updatedBy: mockUserId,
          title: 'New Scenario',
          scenario: '',
          description: 'New description',
          coverImageUrl: 'https://example.com/new-cover.jpg',
          status: ScenarioStatus.ACTIVE,
          prompt: 'You are a counselor helping a client with depression',
          metadata: {
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
          },
        },
      ];

      const createdScenarios = [mockScenario];

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenariosRepository.create.mockReturnValue(createdScenarios as any);
      scenariosRepository.save.mockResolvedValue(createdScenarios as any);

      const result = await service.createScenarios(
        mockCreateScenariosDto,
        mockUserId,
      );

      expect(result).toEqual(createdScenarios);
      expect(scenarioVoiceRepository.findOne).toHaveBeenCalledWith({
        where: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });
      expect(scenariosRepository.create).toHaveBeenCalledWith(
        expectedScenarioDtos,
      );
      expect(scenariosRepository.save).toHaveBeenCalledWith(createdScenarios);
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

    it('should create multiple scenarios', async () => {
      const multipleDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Scenario 1',
            description: 'Desc 1',
            coverImageUrl: 'url1',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt 1',
          },
          {
            title: 'Scenario 2',
            description: 'Desc 2',
            coverImageUrl: 'url2',
            status: ScenarioStatus.DRAFT,
            prompt: 'Prompt 2',
          },
        ],
      };

      const mockScenarios = [mockScenario, { ...mockScenario, id: 2 }];
      scenariosRepository.create.mockReturnValue(mockScenarios as any);
      scenariosRepository.save.mockResolvedValue(mockScenarios as any);

      const result = await service.createScenarios(multipleDto, mockUserId);

      expect(result).toEqual(mockScenarios);
    });

    it('should handle empty scenarios array', async () => {
      const emptyDto: CreateScenariosDto = { scenarios: [] };

      scenariosRepository.create.mockReturnValue([] as any);
      scenariosRepository.save.mockResolvedValue([] as any);

      const result = await service.createScenarios(emptyDto, mockUserId);

      expect(result).toEqual([]);
      expect(scenariosRepository.create).toHaveBeenCalledWith([]);
    });

    it('should handle save errors', async () => {
      const error = new Error('Failed to save scenarios');
      const draftDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Test Scenario',
            status: ScenarioStatus.DRAFT,
            prompt: 'Test prompt',
          },
        ],
      };

      scenariosRepository.create.mockReturnValue([mockScenario] as any);
      scenariosRepository.save.mockRejectedValue(error);

      await expect(
        service.createScenarios(draftDto, mockUserId),
      ).rejects.toThrow('Failed to save scenarios');
    });

    it('should preserve metadata when creating scenarios', async () => {
      const mockVoice = { id: '123e4567-e89b-12d3-a456-426614174000' };
      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenariosRepository.create.mockReturnValue([mockScenario] as any);
      scenariosRepository.save.mockResolvedValue([mockScenario] as any);

      await service.createScenarios(mockCreateScenariosDto, mockUserId);

      expect(scenariosRepository.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.any(Object),
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        ]),
      );
    });
  });

  describe('validateCreateScenario', () => {
    it('should validate voiceId if provided', async () => {
      const mockVoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Voice',
      };
      const draftScenario = {
        title: 'Test Scenario',
        status: ScenarioStatus.DRAFT,
        prompt: 'Test prompt',
        voiceId: '123e4567-e89b-12d3-a456-426614174000',
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);

      await service.validateCreateScenario(draftScenario as any);

      expect(scenarioVoiceRepository.findOne).toHaveBeenCalledWith({
        where: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });
    });

    it('should not validate voiceId if not provided', async () => {
      const createDto = {
        title: 'Test',
        description: 'Test',
        status: ScenarioStatus.DRAFT,
        prompt: 'Test',
      };

      await service.validateCreateScenario(createDto as any);

      expect(scenarioVoiceRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateScenario', () => {
    const mockUserId = 1;

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
      expect(scenariosRepository.update).not.toHaveBeenCalled();
    });

    it('should update scenario and return true when affected > 0', async () => {
      const scenarioId = 1;
      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenariosRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
      expect(scenariosRepository.update).toHaveBeenCalledWith(
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
      scenariosRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
        mockUserId,
      );

      expect(result).toBe(false);
      expect(scenariosRepository.update).toHaveBeenCalledWith(
        scenarioId,
        expect.objectContaining({
          updatedBy: mockUserId,
        }),
      );
    });

    it('should update scenario with partial data', async () => {
      const scenarioId = 1;
      const partialUpdate: UpdateScenarioDto = {
        title: 'Only Title Updated',
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenariosRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(
        scenarioId,
        partialUpdate,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(scenariosRepository.update).toHaveBeenCalledWith(
        scenarioId,
        expect.objectContaining({
          title: 'Only Title Updated',
          updatedBy: mockUserId,
        }),
      );
    });

    it('should handle update database errors', async () => {
      const error = new Error('Database update failed');
      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenariosRepository.update.mockRejectedValue(error);

      await expect(
        service.updateScenario(1, mockUpdateScenarioDto, mockUserId),
      ).rejects.toThrow('Database update failed');
    });

    it('should return true when affected is undefined', async () => {
      const updateResult: UpdateResult = {
        affected: undefined,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenariosRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(
        1,
        mockUpdateScenarioDto,
        mockUserId,
      );
      expect(result).toBe(true);
    });

    it('should check scenario existence before updating', async () => {
      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenario(1, mockUpdateScenarioDto, mockUserId),
      ).rejects.toThrow(NotFoundException);

      expect(scenariosRepository.findOne).toHaveBeenCalled();
      expect(scenariosRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle null values in scenario data', async () => {
      const scenarioWithNulls = { ...mockScenario, description: null };
      scenariosRepository.find.mockResolvedValue([scenarioWithNulls as any]);

      const result = await service.getScenarios();

      expect(result).toEqual([scenarioWithNulls]);
    });

    it('should handle very large scenario ids', async () => {
      const largeId = 999999999;
      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(service.getScenario(largeId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle special characters in scenario data', async () => {
      const mockUserId = 1;
      const updateDto: UpdateScenarioDto = {
        title: 'Test <script>alert("xss")</script>',
        description: 'Test with \' quotes and " double quotes',
      };

      const updateResult: UpdateResult = {
        affected: 1,
        generatedMaps: [],
        raw: {},
      };

      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenariosRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateScenario(1, updateDto, mockUserId);

      expect(result).toBe(true);
    });
  });

  describe('mapEventsToScenario', () => {
    const mockCreateDto: CreateScenarioEventsDto = {
      scenarioId: mockScenarioId,
      events: [{ id: 'event-1' }, { id: 'event-2' }],
    };

    it('should throw BadRequestException when events array is empty', async () => {
      const emptyDto = { ...mockCreateDto, events: [] };

      await expect(service.mapEventsToScenario(emptyDto)).rejects.toThrow(
        new BadRequestException('Events array cannot be empty'),
      );
    });

    it('should throw BadRequestException when invalid event IDs provided', async () => {
      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
      ];
      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);

      await expect(service.mapEventsToScenario(mockCreateDto)).rejects.toThrow(
        new BadRequestException('Invalid event IDs: event-2'),
      );
    });

    it('should successfully map events to scenario', async () => {
      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
        {
          id: 'event-2',
          name: 'Event 2',
          description: 'Second event',
          score: 15,
          emoji: '🚀',
          message: 'Event 2 message',
        } as SessionEvents,
      ];
      const expectedScenarioEvents = [
        {
          scenarioId: mockScenarioId,
          eventId: 'event-1',
          tenantId: mockTenantId,
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
        {
          scenarioId: mockScenarioId,
          eventId: 'event-2',
          tenantId: mockTenantId,
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
      ];

      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);
      scenarioEventsRepository.save.mockResolvedValue(
        expectedScenarioEvents as any,
      );

      const result = await service.mapEventsToScenario(mockCreateDto);

      expect(result).toEqual({
        scenarioId: mockScenarioId,
        events: expectedScenarioEvents.map((event) => ({
          id: event.eventId,
          feedbackStatus: event.feedbackStatus,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          branchingStatus: event.branchingStatus,
          branchInstruction: event.branchInstruction,
        })),
      });
      expect(scenarioEventsRepository.save).toHaveBeenCalledWith(
        expectedScenarioEvents,
      );
    });

    it('should successfully map events to scenario with event-specific feedback and branching data', async () => {
      const mockCreateDtoWithEventSpecificData: CreateScenarioEventsDto = {
        scenarioId: mockScenarioId,
        events: [
          {
            id: 'event-1',
            feedbackStatus: true,
            score: 85,
            emoji: '👍',
            message: 'Great job on event 1!',
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
          {
            id: 'event-2',
            feedbackStatus: false,
            branchingStatus: false,
          },
        ],
      };

      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
        {
          id: 'event-2',
          name: 'Event 2',
          description: 'Second event',
          score: 15,
          emoji: '🚀',
          message: 'Event 2 message',
        } as SessionEvents,
      ];

      const expectedScenarioEvents = [
        {
          scenarioId: mockScenarioId,
          eventId: 'event-1',
          tenantId: mockTenantId,
          feedbackStatus: true,
          score: 85,
          emoji: '👍',
          message: 'Great job on event 1!',
          branchingStatus: true,
          branchInstruction: 'Continue with next step',
        },
        {
          scenarioId: mockScenarioId,
          eventId: 'event-2',
          tenantId: mockTenantId,
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
      ];

      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);
      scenarioEventsRepository.save.mockResolvedValue(
        expectedScenarioEvents as any,
      );

      const result = await service.mapEventsToScenario(
        mockCreateDtoWithEventSpecificData,
      );

      expect(result).toEqual({
        scenarioId: mockScenarioId,
        events: expectedScenarioEvents.map((event) => ({
          id: event.eventId,
          feedbackStatus: event.feedbackStatus,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          branchingStatus: event.branchingStatus,
          branchInstruction: event.branchInstruction,
        })),
      });
      expect(scenarioEventsRepository.save).toHaveBeenCalledWith(
        expectedScenarioEvents,
      );
    });

    it('should successfully map events to scenario with feedback and branching data', async () => {
      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
          score: 10,
          emoji: '🎯',
          message: 'Event 1 message',
        } as SessionEvents,
      ];
      const mockCreateDtoWithFeedback: CreateScenarioEventsDto = {
        scenarioId: mockScenarioId,
        events: [
          {
            id: 'event-1',
            feedbackStatus: true,
            score: 85,
            emoji: '👍',
            message: 'Great job!',
            branchingStatus: true,
            branchInstruction: 'Continue with next step',
          },
        ],
      };
      const expectedScenarioEvents = [
        {
          scenarioId: mockScenarioId,
          eventId: 'event-1',
          tenantId: mockTenantId,
          feedbackStatus: true,
          score: 85,
          emoji: '👍',
          message: 'Great job!',
          branchingStatus: true,
          branchInstruction: 'Continue with next step',
        },
      ];

      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);
      scenarioEventsRepository.save.mockResolvedValue(
        expectedScenarioEvents as any,
      );

      const result = await service.mapEventsToScenario(
        mockCreateDtoWithFeedback,
      );

      expect(result).toEqual({
        scenarioId: mockScenarioId,
        events: expectedScenarioEvents.map((event) => ({
          id: event.eventId,
          feedbackStatus: event.feedbackStatus,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          branchingStatus: event.branchingStatus,
          branchInstruction: event.branchInstruction,
        })),
      });
      expect(scenarioEventsRepository.save).toHaveBeenCalledWith(
        expectedScenarioEvents,
      );
    });

    it('should handle mixed scenarios with some events having feedback and others not', async () => {
      const mockCreateDtoMixed: CreateScenarioEventsDto = {
        scenarioId: mockScenarioId,
        events: [
          {
            id: 'event-1',
            feedbackStatus: true,
            score: 90,
            emoji: '🎉',
            message: 'Excellent work!',
            branchingStatus: true,
            branchInstruction: 'Move to advanced level',
          },
          {
            id: 'event-2',
            // No feedback or branching data
          },
          {
            id: 'event-3',
            feedbackStatus: false,
            branchingStatus: true,
            branchInstruction: 'Try a different approach',
          },
        ],
      };

      const validEvents = [
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'First event',
        } as SessionEvents,
        {
          id: 'event-2',
          name: 'Event 2',
          description: 'Second event',
        } as SessionEvents,
        {
          id: 'event-3',
          name: 'Event 3',
          description: 'Third event',
        } as SessionEvents,
      ];

      const expectedScenarioEvents = [
        {
          scenarioId: mockScenarioId,
          eventId: 'event-1',
          tenantId: mockTenantId,
          feedbackStatus: true,
          score: 90,
          emoji: '🎉',
          message: 'Excellent work!',
          branchingStatus: true,
          branchInstruction: 'Move to advanced level',
        },
        {
          scenarioId: mockScenarioId,
          eventId: 'event-2',
          tenantId: mockTenantId,
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: false,
          branchInstruction: undefined,
        },
        {
          scenarioId: mockScenarioId,
          eventId: 'event-3',
          tenantId: mockTenantId,
          feedbackStatus: false,
          score: undefined,
          emoji: undefined,
          message: undefined,
          branchingStatus: true,
          branchInstruction: 'Try a different approach',
        },
      ];

      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      sessionEventService.findByIds.mockResolvedValue(validEvents);
      scenarioEventsRepository.save.mockResolvedValue(
        expectedScenarioEvents as any,
      );

      const result = await service.mapEventsToScenario(mockCreateDtoMixed);

      expect(result).toEqual({
        scenarioId: mockScenarioId,
        events: expectedScenarioEvents.map((event) => ({
          id: event.eventId,
          feedbackStatus: event.feedbackStatus,
          score: event.score,
          emoji: event.emoji,
          message: event.message,
          branchingStatus: event.branchingStatus,
          branchInstruction: event.branchInstruction,
        })),
      });
      expect(scenarioEventsRepository.save).toHaveBeenCalledWith(
        expectedScenarioEvents,
      );
    });
  });

  describe('deleteScenarioEvents', () => {
    const mockDeleteDto: DeleteScenarioEventsDto = {
      scenarioId: mockScenarioId,
      eventIds: ['event-1', 'event-2'],
    };

    it('should throw BadRequestException when eventIds array is empty', async () => {
      const emptyDto = { ...mockDeleteDto, eventIds: [] };

      await expect(service.deleteScenarioEvents(emptyDto)).rejects.toThrow(
        new BadRequestException('Event IDs array cannot be empty'),
      );
    });

    it('should throw BadRequestException when no scenario events found to delete', async () => {
      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 0 } as any);

      await expect(service.deleteScenarioEvents(mockDeleteDto)).rejects.toThrow(
        new BadRequestException('No scenario events found to delete'),
      );
    });

    it('should successfully delete scenario events', async () => {
      jest.spyOn(service, 'getScenario').mockResolvedValue(mockScenario);
      scenarioEventsRepository.delete.mockResolvedValue({ affected: 2 } as any);

      const result = await service.deleteScenarioEvents(mockDeleteDto);

      expect(result).toBe(2);
      expect(scenarioEventsRepository.delete).toHaveBeenCalledWith({
        eventId: In(mockDeleteDto.eventIds),
        scenarioId: mockScenarioId,
      });
    });
  });

  describe('getScenarioVoices', () => {
    it('should return array of scenario voices', async () => {
      const mockPagination = { limit: 10, offset: 0 };
      const mockVoices = [
        {
          id: 'voice-1',
          name: 'Voice 1',
          voiceId: 'openai-voice-1',
          provider: 'openai',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'voice-2',
          name: 'Voice 2',
          voiceId: 'openai-voice-2',
          provider: 'openai',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioVoiceRepository.getScenarioVoices.mockResolvedValue(
        mockVoices as any,
      );

      const result = await service.getScenarioVoices(mockPagination);

      expect(result).toEqual(mockVoices);
      expect(scenarioVoiceRepository.getScenarioVoices).toHaveBeenCalledWith(
        mockPagination,
      );
    });
  });

  describe('getScenarioVoice', () => {
    const voiceId = 'voice-123';

    it('should throw NotFoundException when scenario voice not found', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      await expect(service.getScenarioVoice(voiceId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenarioVoice(voiceId)).rejects.toThrow(
        'Scenario voice not found',
      );
    });

    it('should return scenario voice when found', async () => {
      const mockVoice = {
        id: voiceId,
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);

      const result = await service.getScenarioVoice(voiceId);

      expect(result).toEqual(mockVoice);
      expect(scenarioVoiceRepository.findOne).toHaveBeenCalledWith({
        where: { id: voiceId },
      });
    });
  });

  describe('createScenarioVoices', () => {
    it('should create and return multiple scenario voices', async () => {
      const createDto = {
        voices: [
          {
            name: 'New Voice 1',
            provider: 'openai',
            config: { model: 'gpt-4', voiceId: 'voice-1' },
          },
          {
            name: 'New Voice 2',
            provider: 'deepgram',
            config: { voiceId: 'voice-2' },
          },
        ],
      };
      const createdVoices = [
        {
          id: 'new-voice-123',
          name: 'New Voice 1',
          provider: 'openai',
          config: { model: 'gpt-4', voiceId: 'voice-1' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'new-voice-456',
          name: 'New Voice 2',
          provider: 'deepgram',
          config: { voiceId: 'voice-2' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioVoiceRepository.create.mockReturnValue(createdVoices as any);
      scenarioVoiceRepository.save.mockResolvedValue(createdVoices as any);

      const result = await service.createScenarioVoices(createDto);

      expect(result).toEqual(createdVoices);
      expect(scenarioVoiceRepository.create).toHaveBeenCalledWith(
        createDto.voices,
      );
      expect(scenarioVoiceRepository.save).toHaveBeenCalledWith(createdVoices);
    });

    it('should handle empty voices array', async () => {
      const emptyDto = { voices: [] };
      const emptyVoices: any[] = [];

      scenarioVoiceRepository.create.mockReturnValue(emptyVoices as any);
      scenarioVoiceRepository.save.mockResolvedValue(emptyVoices as any);

      const result = await service.createScenarioVoices(emptyDto);

      expect(result).toEqual([]);
      expect(scenarioVoiceRepository.create).toHaveBeenCalledWith([]);
      expect(scenarioVoiceRepository.save).toHaveBeenCalledWith([]);
    });

    it('should handle single voice in array', async () => {
      const singleVoiceDto = {
        voices: [
          {
            name: 'Single Voice',
            provider: 'openai',
            config: { model: 'gpt-4', voiceId: 'voice-single' },
          },
        ],
      };
      const createdVoice = [
        {
          id: 'single-voice-123',
          name: 'Single Voice',
          provider: 'openai',
          config: { model: 'gpt-4', voiceId: 'voice-single' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      scenarioVoiceRepository.create.mockReturnValue(createdVoice as any);
      scenarioVoiceRepository.save.mockResolvedValue(createdVoice as any);

      const result = await service.createScenarioVoices(singleVoiceDto);

      expect(result).toEqual(createdVoice);
      expect(scenarioVoiceRepository.create).toHaveBeenCalledWith(
        singleVoiceDto.voices,
      );
      expect(scenarioVoiceRepository.save).toHaveBeenCalledWith(createdVoice);
    });
  });

  describe('updateScenarioVoice', () => {
    const voiceId = 'voice-123';
    const updateDto = {
      name: 'Updated Voice',
      voiceId: 'openai-updated-voice',
    };

    it('should throw NotFoundException when scenario voice not found', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenarioVoice(voiceId, updateDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateScenarioVoice(voiceId, updateDto),
      ).rejects.toThrow('Scenario voice not found');
    });

    it('should update scenario voice and return true when affected > 0', async () => {
      const mockVoice = {
        id: voiceId,
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenarioVoiceRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateScenarioVoice(voiceId, updateDto);

      expect(result).toBe(true);
      expect(scenarioVoiceRepository.update).toHaveBeenCalledWith(
        voiceId,
        updateDto,
      );
    });

    it('should update scenario voice and return false when affected = 0', async () => {
      const mockVoice = {
        id: voiceId,
        name: 'Test Voice',
        voiceId: 'openai-voice-id',
        provider: 'openai',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice as any);
      scenarioVoiceRepository.update.mockResolvedValue({ affected: 0 } as any);

      const result = await service.updateScenarioVoice(voiceId, updateDto);

      expect(result).toBe(false);
    });
  });

  describe('getPresignedUrlForScenarioCoverImage', () => {
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

    it('should generate presigned URL for valid image upload', async () => {
      const requestDto = {
        fileName: 'test-image.jpg',
        fileSize: 1024 * 1024, // 1 MB
        contentType: 'image/jpeg' as any,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result).toEqual({
        presignedUrl: 'https://presigned-url.com',
        coverImageUrl: expect.stringMatching(
          /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-images\/\d+-test-image\.jpg$/,
        ),
      });
      expect(mockS3Service.sanitizeFileName).toHaveBeenCalledWith(
        'test-image.jpg',
      );
      expect(mockS3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'test-bucket',
          operation: 'put',
          expiresIn: 600,
          contentType: 'image/jpeg',
        }),
      );
    });

    it('should throw error when S3 bucket is not defined', async () => {
      mockConfigService.s3.learnMediaPublicBucket = undefined;

      const requestDto = {
        fileName: 'test-image.jpg',
        fileSize: 1024,
        contentType: 'image/jpeg' as any,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    });

    it('should throw BadRequestException for invalid content type', async () => {
      const requestDto = {
        fileName: 'test-file.txt',
        fileSize: 1024,
        contentType: 'text/plain' as any,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('Invalid file type');
    });

    it('should throw BadRequestException when file size exceeds limit', async () => {
      const requestDto = {
        fileName: 'large-image.jpg',
        fileSize: 3 * 1024 * 1024, // 3 MB (exceeds 2 MB limit)
        contentType: 'image/jpeg' as any,
      };

      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getPresignedUrlForScenarioCoverImage(requestDto),
      ).rejects.toThrow('File size must be less than 2 MB');
    });

    it('should handle PNG content type', async () => {
      const requestDto = {
        fileName: 'test-image.png',
        fileSize: 1024 * 1024,
        contentType: 'image/png' as any,
      };

      const result =
        await service.getPresignedUrlForScenarioCoverImage(requestDto);

      expect(result).toEqual({
        presignedUrl: 'https://presigned-url.com',
        coverImageUrl: expect.stringMatching(
          /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/scenario-cover-images\/\d+-test-image\.png$/,
        ),
      });
      expect(mockS3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'image/png',
        }),
      );
    });
  });

  describe('validateUpdateScenario', () => {
    const scenarioId = 1;

    it('should throw NotFoundException when scenario not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.validateUpdateScenario(scenarioId, mockUpdateScenarioDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate status transition and throw error for invalid transition', async () => {
      const archivedScenario = {
        ...mockScenario,
        status: ScenarioStatus.ARCHIVED,
      };
      scenariosRepository.findOne.mockResolvedValue(archivedScenario);

      const updateDto = {
        status: ScenarioStatus.ACTIVE,
      };

      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(
        `Unable to update status from ${ScenarioStatus.ARCHIVED} to ${ScenarioStatus.ACTIVE}`,
      );
    });

    it('should validate voice ID when provided', async () => {
      scenariosRepository.findOne.mockResolvedValue(mockScenario);
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      const updateDto = {
        voiceId: 'invalid-voice-id',
      };

      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.validateUpdateScenario(scenarioId, updateDto),
      ).rejects.toThrow('Scenario voice not found');
    });

    it('should return scenario when no updates', async () => {
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.validateUpdateScenario(scenarioId, {});

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
    });
  });

  describe('deleteAdminScenario', () => {
    const scenarioId = 1;
    let mockTransaction: jest.Mock;
    let mockEntityManager: any;

    beforeEach(() => {
      mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      };

      const dataSource = (service as any).dataSource;
      mockTransaction = dataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        return await callback(mockEntityManager);
      });
    });

    it('should soft delete scenario and return true', async () => {
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.deleteAdminScenario(scenarioId);

      expect(result).toBe(true);
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioEvents,
      );
    });

    it('should throw NotFoundException when scenario not found', async () => {
      jest
        .spyOn(service, 'getScenario')
        .mockRejectedValue(new NotFoundException('Scenario not found'));

      await expect(service.deleteAdminScenario(scenarioId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAdminScenario', () => {
    const scenarioId = 1;

    it('should return scenario when found', async () => {
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getAdminScenario(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
    });

    it('should throw NotFoundException when scenario not found', async () => {
      scenariosRepository.findOne.mockResolvedValue(null);

      await expect(service.getAdminScenario(scenarioId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getAdminScenario(scenarioId)).rejects.toThrow(
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
});
