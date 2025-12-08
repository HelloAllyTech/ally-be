import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Scenarios } from '../../entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { Pagination } from 'src/common/type/common.type';
import { ScenariosRepository } from '../scenario.repository';
import { GetScenarioDto } from '../../dto/get-scenario.dto';
import { GetAdminScenarioDto } from '../../dto/get-scenario.dto';
import { TriggerWarnings } from '../../entity/trigger-warnings.entity';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { ScenarioTriggerWarnings } from '../../entity/scenario-trigger-warnings.entity';
import { ScenarioEvents } from '../../entity/scenario-events.entity';
import { ScenarioTenants } from '../../entity/scenario-tenants.entity';

describe('ScenariosRepository', () => {
  let repository: ScenariosRepository;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<Scenarios>>;
  let mockSubQueryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioSessions>>;
  let mockDataSource: any;

  const mockAdminScenariosData = [
    {
      scenario_id: 1,
      scenario_title: 'Scenario 1',
      scenario_createdAt: new Date('2025-10-01'),
      scenario_updatedAt: new Date('2025-10-10'),
      scenario_scenario: 'Scenario text 1',
      scenario_description: 'Description 1',
      scenario_coverImageUrl: 'https://example.com/image1.jpg',
      scenario_coverVideoUrl: 'https://example.com/video1.mp4',
      scenario_status: 'ACTIVE',
      user_name: 'John Doe',
      usage: '5',
      isAssignedToTenant: true,
    },
    {
      scenario_id: 2,
      scenario_title: 'Scenario 2',
      scenario_createdAt: new Date('2025-09-15'),
      scenario_updatedAt: new Date('2025-10-05'),
      scenario_scenario: 'Scenario text 2',
      scenario_description: 'Description 2',
      scenario_coverImageUrl: 'https://example.com/image2.jpg',
      scenario_coverVideoUrl: 'https://example.com/video2.mp4',
      scenario_status: 'DRAFT',
      user_name: 'Jane Smith',
      usage: '3',
      isAssignedToTenant: false,
    },
  ];

  beforeEach(async () => {
    mockSubQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    } as any;

    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn(function (callback) {
        if (typeof callback === 'function') {
          callback(mockSubQueryBuilder);
        }
        return this;
      }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
      getOne: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      getRepository: jest.fn().mockReturnValue(mockRepository),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenariosRepository>(ScenariosRepository);

    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAdminScenarios', () => {
    it('should build query with correct joins and selections', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('scenario');
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        User,
        'user',
        'scenario."createdBy"=user.id',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario',
        'user.name',
      ]);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalled();
    });

    it('should apply tenantId filter when provided', async () => {
      const tenantId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios({ tenantId }, undefined);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        'scenario_tenants',
        'scenarioTenants',
        '"scenarioTenants"."scenarioId" = scenario.id AND "scenarioTenants"."tenantId" = :tenantId',
        { tenantId },
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'CASE WHEN "scenarioTenants".id IS NOT NULL THEN true ELSE false END',
        'isAssignedToTenant',
      );
    });

    it('should not apply tenantId filter when not provided', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios();

      // Should only have the User join, not the scenario_tenants join
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        User,
        'user',
        'scenario."createdBy"=user.id',
      );
    });

    it('should include isAssignedToTenant in results when tenantId is provided', async () => {
      const tenantId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      const result = await repository.getAdminScenarios(
        { tenantId },
        undefined,
      );

      expect(result[0]).toHaveProperty('isAssignedToTenant');
      expect(result[0].isAssignedToTenant).toBe(true);
      expect(result[1].isAssignedToTenant).toBe(false);
    });

    it('should apply status filter', async () => {
      const status = 'ACTIVE,DRAFT';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios({ status });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
    });

    it('should apply sorting and pagination', async () => {
      const options: Pagination = {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 10,
        offset: 5,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.createdAt',
        'DESC',
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should not apply tenant join if tenantId is empty', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, undefined);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        User,
        'user',
        'scenario."createdBy"=user.id',
      );
    });
  });

  describe('getScenarios', () => {
    const mockTriggerWarning1: TriggerWarnings = {
      id: 'uuid-1',
      name: 'Violence',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as TriggerWarnings;

    const mockTriggerWarning2: TriggerWarnings = {
      id: 'uuid-2',
      name: 'Substance Abuse',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as TriggerWarnings;

    const mockScenarioWithTriggerWarnings: GetScenarioDto = {
      id: 1,
      title: 'Test Scenario 1',
      scenario: 'Test scenario content',
      description: 'Test description',
      coverImageUrl: 'https://example.com/image.jpg',
      coverVideoUrl: undefined,
      status: ScenarioStatus.ACTIVE,
      isGlobal: false,
      triggerWarnings: [mockTriggerWarning1, mockTriggerWarning2],
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as GetScenarioDto;

    const mockScenarioWithoutTriggerWarnings: GetScenarioDto = {
      id: 2,
      title: 'Test Scenario 2',
      scenario: 'Test scenario content 2',
      description: 'Test description 2',
      coverImageUrl: 'https://example.com/image2.jpg',
      coverVideoUrl: undefined,
      status: ScenarioStatus.ACTIVE,
      isGlobal: false,
      triggerWarnings: [],
      createdAt: new Date('2025-01-02'),
      updatedAt: new Date('2025-01-02'),
    } as GetScenarioDto;

    it('should return empty array when no scenarios found', async () => {
      mockQueryBuilder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);

      const result = await repository.getScenarios();

      expect(result).toEqual({ data: [], count: 0 });
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('scenario');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
        'scenario.scenario',
        'scenario.description',
        'scenario.coverImageUrl',
        'scenario.coverVideoUrl',
        'scenario.status',
      ]);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioTriggerWarnings,
        'stw',
        'stw.scenarioId = scenario.id',
      );
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: [ScenarioStatus.ACTIVE] },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.createdAt',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'scenario.id',
        'DESC',
      );
    });

    it('should return scenarios with trigger warnings when data exists', async () => {
      mockQueryBuilder.getManyAndCount = jest
        .fn()
        .mockResolvedValue([
          [mockScenarioWithTriggerWarnings, mockScenarioWithoutTriggerWarnings],
          2,
        ]);

      const result = await repository.getScenarios();

      expect(result.data).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.data[0]).toEqual(mockScenarioWithTriggerWarnings);
      expect(result.data[0].triggerWarnings).toHaveLength(2);
      expect(result.data[0].triggerWarnings?.[0]).toEqual(mockTriggerWarning1);
      expect(result.data[0].triggerWarnings?.[1]).toEqual(mockTriggerWarning2);
      expect(result.data[1]).toEqual(mockScenarioWithoutTriggerWarnings);
      expect(result.data[1].triggerWarnings).toHaveLength(0);
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
    });

    it('should apply tenantId filter when provided', async () => {
      const tenantId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
      mockQueryBuilder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      mockQueryBuilder.innerJoin = jest.fn().mockReturnThis();

      await repository.getScenarios({ tenantId });

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        ScenarioTenants,
        'scenarioTenant',
        'scenarioTenant.scenarioId = scenario.id AND scenarioTenant.tenantId = :tenantId',
        { tenantId },
      );
    });

    it('should not apply tenantId filter when not provided', async () => {
      mockQueryBuilder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      mockQueryBuilder.innerJoin = jest.fn().mockReturnThis();

      await repository.getScenarios();

      expect(mockQueryBuilder.innerJoin).not.toHaveBeenCalled();
    });
  });

  describe('getAdminScenarioById', () => {
    const mockTriggerWarning1: TriggerWarnings = {
      id: 'uuid-1',
      name: 'Violence',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as TriggerWarnings;

    const mockTriggerWarning2: TriggerWarnings = {
      id: 'uuid-2',
      name: 'Substance Abuse',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as TriggerWarnings;

    const mockTerminationEvent = {
      eventId: 'event-1',
      name: 'Termination Event',
      autoTerminationStatus: true,
      message: 'Session terminated',
    };

    const mockScenarioWithTriggerWarnings: GetAdminScenarioDto = {
      id: 1,
      title: 'Test Scenario 1',
      scenario: 'Test scenario content',
      description: 'Test description',
      coverImageUrl: 'https://example.com/image.jpg',
      coverVideoUrl: undefined,
      status: ScenarioStatus.ACTIVE,
      isGlobal: false,
      terminationEvent: mockTerminationEvent,
      triggerWarnings: [mockTriggerWarning1, mockTriggerWarning2],
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as GetAdminScenarioDto;

    const mockScenarioWithoutTriggerWarnings: GetAdminScenarioDto = {
      id: 2,
      title: 'Test Scenario 2',
      scenario: 'Test scenario content 2',
      description: 'Test description 2',
      coverImageUrl: 'https://example.com/image2.jpg',
      coverVideoUrl: undefined,
      status: ScenarioStatus.ACTIVE,
      isGlobal: false,
      terminationEvent: undefined,
      triggerWarnings: [],
      createdAt: new Date('2025-01-02'),
      updatedAt: new Date('2025-01-02'),
    } as GetAdminScenarioDto;

    it('should return scenario with trigger warnings when found', async () => {
      const scenarioId = 1;
      mockQueryBuilder.getOne.mockResolvedValue(
        mockScenarioWithTriggerWarnings,
      );

      const result = await repository.getAdminScenarioById(scenarioId);

      expect(result).toEqual(mockScenarioWithTriggerWarnings);
      expect(result?.triggerWarnings).toHaveLength(2);
      expect(result?.triggerWarnings?.[0]).toEqual(mockTriggerWarning1);
      expect(result?.triggerWarnings?.[1]).toEqual(mockTriggerWarning2);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('scenario');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenario.terminationEvent',
        ScenarioEvents,
        'scenarioEvent',
        'scenarioEvent.scenarioId = scenario.id AND scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: true },
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioTriggerWarnings,
        'stw',
        'stw.scenarioId = scenario.id',
      );
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('scenario.id = :id', {
        id: scenarioId,
      });
    });

    it('should return scenario without trigger warnings when found', async () => {
      const scenarioId = 2;
      mockQueryBuilder.getOne.mockResolvedValue(
        mockScenarioWithoutTriggerWarnings,
      );

      const result = await repository.getAdminScenarioById(scenarioId);

      expect(result).toEqual(mockScenarioWithoutTriggerWarnings);
      expect(result?.triggerWarnings).toHaveLength(0);
      expect(result?.triggerWarnings).toEqual([]);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
      );
    });

    it('should return null when scenario is not found', async () => {
      const scenarioId = 999;
      mockQueryBuilder.getOne.mockResolvedValue(null);

      const result = await repository.getAdminScenarioById(scenarioId);

      expect(result).toBeNull();
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('scenario.id = :id', {
        id: scenarioId,
      });
    });
  });

  describe('getScenarioById', () => {
    const mockScenario: Scenarios = {
      id: 1,
      title: 'Test Scenario',
      scenario: 'Test scenario content',
      description: 'Test description',
      coverImageUrl: 'https://example.com/image.jpg',
      coverVideoUrl: undefined,
      status: ScenarioStatus.ACTIVE,
      prompt: 'Test prompt',
      isGlobal: false,
      metadata: {},
      triggerWarnings: [],
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
      createdBy: 1,
      updatedBy: 1,
    } as Scenarios;

    const mockScenarioWithTriggerWarnings: Scenarios = {
      ...mockScenario,
      triggerWarnings: [
        {
          id: 'uuid-1',
          name: 'Violence',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        } as TriggerWarnings,
      ],
    } as Scenarios;

    it('should return scenario when found', async () => {
      const scenarioId = 1;
      mockQueryBuilder.getOne.mockResolvedValue(mockScenario);

      const result = await repository.getScenarioById(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
      expect(mockDataSource.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioTriggerWarnings,
        'stw',
        'stw.scenarioId = scenario.id',
      );
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('scenario.id = :id', {
        id: scenarioId,
      });
    });

    it('should return null when scenario is not found', async () => {
      const scenarioId = 999;
      mockQueryBuilder.getOne.mockResolvedValue(null);

      const result = await repository.getScenarioById(scenarioId);

      expect(result).toBeNull();
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('scenario.id = :id', {
        id: scenarioId,
      });
    });

    it('should apply select with prefixed fields when select parameter is provided', async () => {
      const scenarioId = 1;
      const selectFields: (keyof Scenarios)[] = ['id', 'title', 'metadata'];
      mockQueryBuilder.getOne.mockResolvedValue(mockScenario);

      const result = await repository.getScenarioById(scenarioId, selectFields);

      expect(result).toEqual(mockScenario);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
        'scenario.metadata',
      ]);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should use EntityManager repository when em is provided', async () => {
      const scenarioId = 1;
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        }),
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockScenario);
      const getRepositorySpy = jest.spyOn(mockDataSource, 'getRepository');

      const result = await repository.getScenarioById(
        scenarioId,
        undefined,
        mockEntityManager as any,
      );

      expect(result).toEqual(mockScenario);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(getRepositorySpy).not.toHaveBeenCalled();
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should use default repository when em is not provided', async () => {
      const scenarioId = 1;
      mockQueryBuilder.getOne.mockResolvedValue(mockScenario);

      const result = await repository.getScenarioById(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(mockDataSource.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should return scenario with trigger warnings when found', async () => {
      const scenarioId = 1;
      mockQueryBuilder.getOne.mockResolvedValue(
        mockScenarioWithTriggerWarnings,
      );

      const result = await repository.getScenarioById(scenarioId);

      expect(result).toEqual(mockScenarioWithTriggerWarnings);
      expect((result as any)?.triggerWarnings).toHaveLength(1);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should combine select and EntityManager correctly', async () => {
      const scenarioId = 1;
      const selectFields: (keyof Scenarios)[] = ['id', 'metadata'];
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        }),
      };
      mockQueryBuilder.getOne.mockResolvedValue(mockScenario);

      const result = await repository.getScenarioById(
        scenarioId,
        selectFields,
        mockEntityManager as any,
      );

      expect(result).toEqual(mockScenario);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.metadata',
      ]);
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });
  });

  describe('parseStringArray', () => {
    it('should return empty array if value is undefined', () => {
      expect((repository as any).parseStringArray(undefined)).toEqual([]);
    });

    it('should split, trim and filter empty strings', () => {
      const input = 'ACTIVE, ,DRAFT, , , ';
      expect((repository as any).parseStringArray(input)).toEqual([
        'ACTIVE',
        'DRAFT',
      ]);
    });
  });

  describe('applySearchFilter', () => {
    it('should add where clause for search', () => {
      const search = 'test';
      const andWhereMock = jest.fn().mockReturnThis();
      const fakeQuery = { andWhere: andWhereMock } as any;

      (repository as any).applySearchFilter(fakeQuery, search);

      expect(andWhereMock).toHaveBeenCalledWith(
        '(scenario.title ILIKE :search)',
        { search: `%${search}%` },
      );
    });

    it('should not add where clause for empty or blank search', () => {
      const andWhereMock = jest.fn();
      const fakeQuery = { andWhere: andWhereMock } as any;

      (repository as any).applySearchFilter(fakeQuery, '');
      (repository as any).applySearchFilter(fakeQuery, '    ');
      (repository as any).applySearchFilter(fakeQuery, undefined);

      expect(andWhereMock).not.toHaveBeenCalled();
    });
  });
});
