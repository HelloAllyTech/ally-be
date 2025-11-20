import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioPathRepository } from '../scenario-path.repository';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import {
  ScenarioPathFilterOptions,
  ScenarioPathStatus,
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

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
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
      const expectedPaths = [mockScenarioPath];
      queryBuilder.getManyAndCount.mockResolvedValue([expectedPaths, 1]);

      const result = await repository.getAllScenarioPaths();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioPath',
      );
      expect(queryBuilder.getManyAndCount).toHaveBeenCalled();
      expect(result).toEqual({ data: expectedPaths, count: 1 });
    });

    it('should return filtered scenario paths with status, search, and pagination', async () => {
      const expectedPaths = [mockScenarioPath];
      const filters: ScenarioPathFilterOptions = {
        status: ScenarioPathStatus.ACTIVE,
        search: 'Test',
        limit: 10,
        offset: 5,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([expectedPaths, 1]);

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
      expect(result).toEqual({ data: expectedPaths, count: 1 });
    });
  });
});
