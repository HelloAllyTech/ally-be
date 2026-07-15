import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { CaseRepository } from '../case.repository';
import { Case } from '../../entity/case.entity';
import { CaseFilterOptions, CaseStatus } from '../../type/cases.type';
import { AssignmentStatus } from 'src/common/type/common.type';

describe('CaseRepository', () => {
  let repository: CaseRepository;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<Case>>;

  const mockCase: Case = {
    id: 'case-1',
    title: 'Test Case',
    description: 'Test description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: CaseStatus.ACTIVE,
    isGlobal: false,
    totalScenarios: 3,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    deletedAt: undefined,
  } as Case;

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
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
        CaseRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<CaseRepository>(CaseRepository);
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllCases', () => {
    it('returns all cases without filters', async () => {
      const entities = [mockCase];
      queryBuilder.getManyAndCount.mockResolvedValue([entities, 1]);

      const result = await repository.getAllCases();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('case');
      expect(result).toEqual({ data: entities, count: 1 });
    });

    it('applies tenant filter with leftJoinAndMapOne', async () => {
      const filters: CaseFilterOptions = { tenantId: 'tenant-1' };
      queryBuilder.getManyAndCount.mockResolvedValue([[mockCase], 1]);

      await repository.getAllCases(filters);

      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'case.caseTenant',
        'case_tenants',
        'caseTenant',
        '"caseTenant"."caseId" = case.id AND "caseTenant"."tenantId" = :tenantId',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
      });
    });

    it('filters to assigned cases when assignmentStatus is ASSIGNED', async () => {
      const filters: CaseFilterOptions = {
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.ASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[mockCase], 1]);

      await repository.getAllCases(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '"caseTenant"."id" IS NOT NULL',
      );
    });

    it('filters to unassigned cases when assignmentStatus is UNASSIGNED', async () => {
      const filters: CaseFilterOptions = {
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.UNASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAllCases(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '"caseTenant"."id" IS NULL',
      );
    });

    it('ignores assignmentStatus when tenantId is not provided', async () => {
      const filters: CaseFilterOptions = {
        assignmentStatus: AssignmentStatus.ASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAllCases(filters);

      expect(queryBuilder.leftJoinAndMapOne).not.toHaveBeenCalled();
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        '"caseTenant"."id" IS NOT NULL',
      );
    });
  });
});
