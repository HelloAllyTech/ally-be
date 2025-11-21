import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioPathRepository } from '../scenario-path.repository';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';
import {
  ScenarioPathFilterOptions,
  ScenarioPathStatus,
  ScenarioPathWithSessionFilterOptions,
} from '../../type/scenario-paths.type';

describe('ScenarioPathRepository', () => {
  let repository: ScenarioPathRepository;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioPath>>;

  const mockScenarioPath: ScenarioPath = {
    id: 'path-1',
    title: 'Test Scenario Path',
    description: 'Test description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: ScenarioPathStatus.ACTIVE,
    isGlobal: false,
    totalScenarios: 5,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    deletedAt: undefined,
  };

  const mockScenarioPathWithTenantMapping = {
    ...mockScenarioPath,
    tenantMapping: {
      id: 'mapping-1',
      scenarioPathId: 'path-1',
      tenantId: 'tenant-1',
    },
  };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
      getCount: jest.fn(),
      getMany: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenarioPathRepository>(ScenarioPathRepository);
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllScenarioPaths', () => {
    it('should return all scenario paths without filters', async () => {
      const entities = [mockScenarioPath];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioPath',
      );
      expect(queryBuilder.getManyAndCount).toHaveBeenCalled();
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply status filter', async () => {
      const entities = [mockScenarioPath];
      const filters: ScenarioPathFilterOptions = {
        status: ScenarioPathStatus.ACTIVE,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioPath.status = :status',
        { status: ScenarioPathStatus.ACTIVE },
      );
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply search filter', async () => {
      const entities = [mockScenarioPath];
      const filters: ScenarioPathFilterOptions = {
        search: 'Test',
      };
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(scenarioPath.title ILIKE :search)',
        { search: '%Test%' },
      );
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply pagination filters', async () => {
      const entities = [mockScenarioPath];
      const filters: ScenarioPathFilterOptions = {
        limit: 10,
        offset: 5,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths(filters);

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply tenant filter with leftJoinAndMapOne', async () => {
      const entities = [mockScenarioPathWithTenantMapping];
      const filters: ScenarioPathFilterOptions = {
        tenantId: 'tenant-1',
      };
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths(filters);

      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioPath.scenarioPathTenant',
        'scenario_path_tenants',
        'scenarioPathTenant',
        '"scenarioPathTenant"."scenarioPathId" = scenarioPath.id AND "scenarioPathTenant"."tenantId" = :tenantId',
        { tenantId: 'tenant-1' },
      );
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply all filters together', async () => {
      const entities = [mockScenarioPathWithTenantMapping];
      const filters: ScenarioPathFilterOptions = {
        status: ScenarioPathStatus.ACTIVE,
        search: 'Test',
        limit: 10,
        offset: 5,
        tenantId: 'tenant-1',
      };
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPaths(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'scenarioPath.status = :status',
        { status: ScenarioPathStatus.ACTIVE },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(scenarioPath.title ILIKE :search)',
        { search: '%Test%' },
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalled();
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });
  });

  describe('getAllScenarioPathsWithSession', () => {
    const mockSession: ScenarioPathSession = {
      id: 'session-1',
      scenarioPathId: 'path-1',
      userId: 123,
      completedScenarios: 2,
      startedAt: new Date(),
      completedAt: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: undefined,
    };

    const mockScenarioPathWithSession = {
      ...mockScenarioPath,
      session: mockSession,
    };

    it('should return scenario paths with session for user', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
      };
      const entities = [mockScenarioPathWithSession];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPathsWithSession(filters);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioPath',
      );
      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'scenarioPath.session',
        ScenarioPathSession,
        'scenarioPathSession',
        '"scenarioPathSession"."scenarioPathId" = scenarioPath.id AND scenarioPathSession.userId = :userId',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({ userId: 123 });
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply pagination', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant',
        limit: 10,
        offset: 5,
      };
      const entities = [mockScenarioPathWithSession];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPathsWithSession(filters);

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply tenant filter with innerJoin', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant-1',
      };
      const entities = [mockScenarioPathWithSession];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPathsWithSession(filters);

      expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
        'scenario_path_tenants',
        'scenarioPathTenant',
        '"scenarioPathTenant"."scenarioPathId" = scenarioPath.id AND scenarioPathTenant.tenantId = :tenantId',
        { tenantId: 'tenant-1' },
      );
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });

    it('should apply all filters together', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        tenantId: 'tenant-1',
        limit: 10,
        offset: 5,
      };
      const entities = [mockScenarioPathWithSession];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllScenarioPathsWithSession(filters);

      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalled();
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({ userId: 123 });
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(5);
      expect(queryBuilder.innerJoin).toHaveBeenCalled();
      expect(result).toEqual({
        data: entities,
        count: 1,
      });
    });
  });
});
