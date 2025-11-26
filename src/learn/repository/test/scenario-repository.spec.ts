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
