import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Scenarios } from '../../entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { Pagination } from 'src/common/type/common.type';
import { ScenariosRepository } from '../scenario.repository';

describe('ScenariosRepository', () => {
  let repository: ScenariosRepository;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<Scenarios>>;
  let mockSubQueryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioSessions>>;

  const mockAdminScenariosData = [
    {
      scenario_id: 1,
      scenario_title: 'Scenario 1',
      scenario_createdAt: new Date('2025-10-01'),
      scenario_updatedAt: new Date('2025-10-10'),
      scenario_scenario: 'Scenario text 1',
      scenario_description: 'Description 1',
      scenario_coverImageUrl: 'https://example.com/image1.jpg',
      scenario_status: 'ACTIVE',
      user_name: 'John Doe',
      usage: '5',
    },
    {
      scenario_id: 2,
      scenario_title: 'Scenario 2',
      scenario_createdAt: new Date('2025-09-15'),
      scenario_updatedAt: new Date('2025-10-05'),
      scenario_scenario: 'Scenario text 2',
      scenario_description: 'Description 2',
      scenario_coverImageUrl: 'https://example.com/image2.jpg',
      scenario_status: 'DRAFT',
      user_name: 'Jane Smith',
      usage: '3',
    },
  ];

  beforeEach(async () => {
    // Create mock subquery builder for the usage count
    mockSubQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    } as any;

    // Create mock query builder
    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn(function (callback) {
        if (typeof callback === 'function') {
          callback(mockSubQueryBuilder);
        }
        return this;
      }),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
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

    // Mock createQueryBuilder
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

    it('should build subquery for usage count', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios();

      expect(mockQueryBuilder.addSelect).toHaveBeenCalled();
      expect(mockSubQueryBuilder.select).toHaveBeenCalledWith(
        'COUNT(*)',
        'count',
      );
      expect(mockSubQueryBuilder.from).toHaveBeenCalledWith(
        ScenarioSessions,
        'scenarioSessions',
      );
      expect(mockSubQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioSessions.scenarioId = scenario.id',
      );
    });

    it('should apply status filter correctly', async () => {
      const status = 'ACTIVE';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE'] },
      );
    });

    it('should apply multiple status filters', async () => {
      const status = 'ACTIVE,DRAFT';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
    });

    it('should trim status values with spaces', async () => {
      const status = ' ACTIVE , DRAFT ';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
    });

    it('should not apply status filter when status is undefined', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should not apply status filter when status is empty string', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios('');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should filter empty strings from status array', async () => {
      const status = 'ACTIVE,,DRAFT,';
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
    });

    it('should apply pagination with limit', async () => {
      const options: Pagination = {
        limit: 20,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(20);
    });

    it('should apply pagination with offset', async () => {
      const options: Pagination = {
        offset: 10,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should apply both limit and offset', async () => {
      const options: Pagination = {
        limit: 15,
        offset: 5,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(15);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should apply sorting for usage field', async () => {
      const options: Pagination = {
        sortBy: 'usage',
        order: 'DESC',
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('usage', 'DESC');
    });

    it('should apply sorting for scenario fields with table prefix', async () => {
      const options: Pagination = {
        sortBy: 'createdAt',
        order: 'DESC',
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.createdAt',
        'DESC',
      );
    });

    it('should apply ascending order when specified', async () => {
      const options: Pagination = {
        sortBy: 'title',
        order: 'ASC',
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.title',
        'ASC',
      );
    });

    it('should not apply sorting when sortBy is missing', async () => {
      const options: Pagination = {
        order: 'ASC',
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
    });

    it('should apply sorting with undefined order when only sortBy provided', async () => {
      const options: Pagination = {
        sortBy: 'createdAt',
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.createdAt',
        undefined,
      );
    });

    it('should apply all filters and options together', async () => {
      const status = 'ACTIVE,DRAFT';
      const options: Pagination = {
        sortBy: 'updatedAt',
        order: 'DESC',
        limit: 10,
        offset: 5,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status, options);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'scenario.updatedAt',
        'DESC',
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should handle usage sorting with status filter', async () => {
      const status = 'ACTIVE';
      const options: Pagination = {
        sortBy: 'usage',
        order: 'ASC',
        limit: 5,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status, options);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE'] },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('usage', 'ASC');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(5);
    });

    it('should return empty array when no scenarios found', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await repository.getAdminScenarios();

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should return scenarios with correct structure', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      const result = await repository.getAdminScenarios();

      expect(result).toEqual(mockAdminScenariosData);
      expect(result[0]).toHaveProperty('scenario_id');
      expect(result[0]).toHaveProperty('scenario_title');
      expect(result[0]).toHaveProperty('scenario_status');
      expect(result[0]).toHaveProperty('user_name');
      expect(result[0]).toHaveProperty('usage');
    });

    it('should handle null/undefined options gracefully', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      const result = await repository.getAdminScenarios(undefined, undefined);

      expect(result).toEqual(mockAdminScenariosData);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should call getRawMany to execute the query', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios();

      expect(mockQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should verify all query builder methods are called', async () => {
      const status = 'ACTIVE';
      const options: Pagination = {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 10,
        offset: 5,
      };
      mockQueryBuilder.getRawMany.mockResolvedValue(mockAdminScenariosData);

      await repository.getAdminScenarios(status, options);

      // Verify all methods were called
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();
      expect(mockQueryBuilder.select).toHaveBeenCalled();
      expect(mockQueryBuilder.addSelect).toHaveBeenCalled();
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
      expect(mockQueryBuilder.orderBy).toHaveBeenCalled();
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
      expect(mockQueryBuilder.offset).toHaveBeenCalled();
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });
  });

  describe('parseStringArray (private method via status parsing)', () => {
    it('should handle single status value', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('ACTIVE');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE'] },
      );
    });

    it('should handle multiple comma-separated values', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('ACTIVE,DRAFT,INACTIVE');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT', 'INACTIVE'] },
      );
    });

    it('should trim whitespace from values', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('  ACTIVE  ,  DRAFT  ');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT'] },
      );
    });

    it('should filter out empty strings after split', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('ACTIVE,,DRAFT,,,INACTIVE');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'scenario.status IN (:...statuses)',
        { statuses: ['ACTIVE', 'DRAFT', 'INACTIVE'] },
      );
    });

    it('should return empty array for undefined', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios(undefined);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should return empty array for empty string', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should handle string with only commas', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios(',,,');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should handle string with only spaces', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await repository.getAdminScenarios('   ');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });
});
