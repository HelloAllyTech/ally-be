import { Test, TestingModule } from '@nestjs/testing';
import { CallDetailsRepository } from '../call-details.repository';
import { DataSource } from 'typeorm';

describe('CallDetailsRepository', () => {
  let repository: CallDetailsRepository;
  let mockQueryBuilder: any;

  const mockTenantId = 'test-tenant';

  beforeEach(async () => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getCount: jest.fn(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      getRepository: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallDetailsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<CallDetailsRepository>(CallDetailsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllTags', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should get all tags with pagination', async () => {
      const mockTags = [{ tag: 'anxiety' }, { tag: 'support' }];
      mockQueryBuilder.getRawMany.mockResolvedValue(mockTags);
      mockQueryBuilder.getCount.mockResolvedValue(2);

      const result = await repository.getAllTags(mockTenantId, 10, 0);

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('details');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        "DISTINCT jsonb_array_elements(details.summary->'tags')->>'tag'",
        'tag',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "details.summary->'tags' IS NOT NULL",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_typeof(details.summary->'tags') = 'array'",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.tenant_id = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tag', 'ASC');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual({
        data: ['anxiety', 'support'],
        count: 2,
      });
    });

    it('should apply search filter when provided', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await repository.getAllTags(mockTenantId, 10, 0, 'anxiety');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        { search: '%anxiety%' },
      );
    });

    it('should trim search value', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await repository.getAllTags(mockTenantId, 10, 0, '  anxiety  ');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        { search: '%anxiety%' },
      );
    });

    it('should not apply search filter for empty string', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await repository.getAllTags(mockTenantId, 10, 0, '   ');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('should filter out empty tags', async () => {
      const mockTags = [
        { tag: 'anxiety' },
        { tag: '' },
        { tag: '  ' },
        { tag: 'support' },
        { tag: null },
      ];
      mockQueryBuilder.getRawMany.mockResolvedValue(mockTags);
      mockQueryBuilder.getCount.mockResolvedValue(5);

      const result = await repository.getAllTags(mockTenantId);

      expect(result.data).toEqual(['anxiety', 'support']);
    });

    it('should work without pagination parameters', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await repository.getAllTags(mockTenantId);

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should apply offset when provided', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await repository.getAllTags(mockTenantId, 10, 5);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });
  });
});
