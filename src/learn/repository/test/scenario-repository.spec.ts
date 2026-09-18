import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Scenarios } from '../../entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';
import { ScenarioTriggerWarnings } from '../../entity/scenario-trigger-warnings.entity';
import { TriggerWarnings } from '../../entity/trigger-warnings.entity';
import { ScenarioTenants } from '../../entity/scenario-tenants.entity';
import { ScenarioEvents } from '../../entity/scenario-events.entity';
import { AssignmentStatus, Pagination } from 'src/common/type/common.type';
import { ScenariosRepository } from '../scenario.repository';
import { GetAdminScenarioDto } from '../../dto/get-scenario.dto';
import { ScenarioStatus } from '../../type/scenario.type';
import { GetScenarioByIdOptions } from 'src/learn/type/scenario-filter.type';

describe('ScenariosRepository', () => {
  let repository: ScenariosRepository;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<Scenarios>>;

  let mockDataSource: jest.Mocked<DataSource>;

  const mockAdminScenariosData = [
    {
      scenario_id: 1,
      scenario_title: 'Scenario 1',
      scenario_createdAt: new Date('2025-10-01'),
      scenario_usage: 5,
      user_name: 'John Doe',
      triggerWarnings: '[{"id":"1","name":"Violence"}]',
      isAssignedToTenant: true,
    },
  ];

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
      getOne: jest.fn(),
    } as any;

    mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      }),
      createEntityManager: jest.fn().mockReturnValue({
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        }),
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosRepository,
        { provide: DataSource, useValue: mockDataSource },
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

  describe('getScenarioWithTriggerWarningsByIds', () => {
    it('should return empty array when ids is empty', async () => {
      const result = await repository.getScenarioWithTriggerWarningsByIds([]);
      expect(result).toEqual([]);
    });

    it('should build query with trigger warnings join', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);
      await repository.getScenarioWithTriggerWarningsByIds([1, 2]);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('scenario');
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
        'scenario.id IN (:...ids)',
        { ids: [1, 2] },
      );
    });
  });

  describe('getScenarios', () => {
    it('should return empty result without filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await repository.getScenarios();

      expect(result).toEqual({ data: [], count: 0 });
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
        'scenario.scenario',
        'scenario.description',
        'scenario.coverImageUrl',
        'scenario.coverVideoUrl',
        'scenario.status',
        'scenario.isPublic',
        'scenario.metadata',
      ]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: [ScenarioStatus.ACTIVE] },
      );
    });

    it('should apply tenant filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await repository.getScenarios({ tenantId: 'tenant-1' });

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        ScenarioTenants,
        'scenarioTenant',
        'scenarioTenant.scenarioId = scenario.id AND scenarioTenant.tenantId = :tenantId',
        { tenantId: 'tenant-1' },
      );
    });

    it('should apply isPublic filter when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await repository.getScenarios({ isPublic: true });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.isPublic = :isPublic',
        { isPublic: true },
      );
    });

    it('should include translations in select fields when languageCode filter is provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await repository.getScenarios({ languageCode: 'mr' });

      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
        'scenario.scenario',
        'scenario.description',
        'scenario.coverImageUrl',
        'scenario.coverVideoUrl',
        'scenario.status',
        'scenario.isPublic',
        'scenario.metadata',
        'scenario.translations',
      ]);
    });
  });

  describe('getScenarioById', () => {
    it('should use DataSource repository when no options provided', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await repository.getScenarioById(1);

      expect(mockDataSource.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('scenario.id = :id', {
        id: 1,
      });
    });

    it('should use EntityManager when provided in options', async () => {
      const mockEmRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      };
      const mockEm = { getRepository: jest.fn().mockReturnValue(mockEmRepo) };
      const options: GetScenarioByIdOptions = { em: mockEm as any };

      mockQueryBuilder.getOne.mockResolvedValue(null);
      await repository.getScenarioById(1, options);

      expect(mockEm.getRepository).toHaveBeenCalledWith(Scenarios);
      expect(mockDataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should apply select fields when provided', async () => {
      const options: GetScenarioByIdOptions = {
        select: ['id', 'title'] as any,
      };
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await repository.getScenarioById(1, options);

      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
      ]);
    });

    it('should append translations to select fields when languageCode and select options are provided', async () => {
      const options: GetScenarioByIdOptions = {
        select: ['id', 'title'] as any,
        languageCode: 'mr',
      };
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await repository.getScenarioById(1, options);

      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario.id',
        'scenario.title',
        'scenario.translations',
      ]);
    });

    it('should apply isPublic filter when provided', async () => {
      const options: GetScenarioByIdOptions = { isPublic: true };
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await repository.getScenarioById(1, options);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.isPublic = :isPublic',
        { isPublic: true },
      );
    });
  });

  describe('getAdminScenarios', () => {
    it('should build base query with required joins', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);
      await repository.getAdminScenarios();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('scenario');
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        User,
        'user',
        'scenario."createdBy"=user.id',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioTriggerWarnings,
        'stw',
        'stw.scenarioId = scenario.id',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'scenario',
        'user.name',
      ]);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(3);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('scenario.id');
    });

    it('should apply tenant filter when provided', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);
      await repository.getAdminScenarios({ tenantId: 'tenant-1' });

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        'scenario_tenants',
        'scenarioTenants',
        expect.stringContaining('"scenarioTenants"."tenantId" = :tenantId'),
        { tenantId: 'tenant-1' },
      );
    });

    it('should filter to assigned scenarios when assignmentStatus is ASSIGNED', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);
      await repository.getAdminScenarios({
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.ASSIGNED,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"scenarioTenants"."id" IS NOT NULL',
      );
    });

    it('should filter to unassigned scenarios when assignmentStatus is UNASSIGNED', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      await repository.getAdminScenarios({
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.UNASSIGNED,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"scenarioTenants"."id" IS NULL',
      );
    });

    it('should ignore assignmentStatus when tenantId is not provided', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      await repository.getAdminScenarios({
        assignmentStatus: AssignmentStatus.ASSIGNED,
      });

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        '"scenarioTenants"."id" IS NOT NULL',
      );
    });

    it('should apply status filter', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      await repository.getAdminScenarios({ status: 'ACTIVE,DRAFT' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        expect.any(Object),
      );
    });

    it('should apply pagination', async () => {
      const options: Pagination = { limit: 10, offset: 5 };
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });
  });

  describe('getAdminScenarioById', () => {
    it('should build query with termination events and trigger warnings', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({} as GetAdminScenarioDto);
      await repository.getAdminScenarioById(1);

      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledWith(
        'scenario.terminationEvents',
        ScenarioEvents,
        'scenarioEvents',
        expect.stringContaining('autoTerminationStatus'),
        expect.any(Object),
      );
      expect(mockQueryBuilder.leftJoinAndMapMany).toHaveBeenCalledTimes(2); // terminationEvents + triggerWarnings
    });
  });

  describe('private methods', () => {
    describe('parseStringArray', () => {
      it('should handle empty/undefined input', () => {
        expect((repository as any).parseStringArray(undefined)).toEqual([]);
        expect((repository as any).parseStringArray('')).toEqual([]);
      });

      it('should parse comma-separated string', () => {
        expect(
          (repository as any).parseStringArray('ACTIVE, DRAFT ,  '),
        ).toEqual(['ACTIVE', 'DRAFT']);
      });
    });

    describe('applySearchFilter', () => {
      it('should add search filter', () => {
        const mockQuery = { andWhere: jest.fn().mockReturnThis() } as any;
        (repository as any).applySearchFilter(mockQuery, 'test');
        expect(mockQuery.andWhere).toHaveBeenCalledWith(
          '(scenario.title ILIKE :search OR scenario.partnerOrgName ILIKE :search)',
          { search: '%test%' },
        );
      });

      it('should skip empty search', () => {
        const mockQuery = { andWhere: jest.fn() } as any;
        (repository as any).applySearchFilter(mockQuery, '');
        expect(mockQuery.andWhere).not.toHaveBeenCalled();
      });
    });
  });
});
