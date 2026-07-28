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

  describe('mergeSummary', () => {
    let updateQueryBuilder: any;
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      updateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(updateQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('merges the patch into the stored summary instead of replacing it', async () => {
      const affected = await repository.mergeSummary(7, mockTenantId, {
        keyConcerns: 'edited',
      });

      // The whole point: `||` is a key-wise merge, so untouched keys survive.
      const setArg = updateQueryBuilder.set.mock.calls[0][0];
      expect(setArg.summary()).toBe(
        `COALESCE("summary", '{}'::jsonb) || :patch::jsonb`,
      );
      expect(updateQueryBuilder.setParameter).toHaveBeenCalledWith(
        'patch',
        JSON.stringify({ keyConcerns: 'edited' }),
      );
      expect(affected).toBe(1);
    });

    it('scopes the update to the chat and tenant', async () => {
      await repository.mergeSummary(7, mockTenantId, { homework: 'x' });

      expect(updateQueryBuilder.where).toHaveBeenCalledWith(
        '"chatId" = :chatId',
        { chatId: 7 },
      );
      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tenant_id = :tenantId',
        { tenantId: mockTenantId },
      );
    });

    it('serializes an explicit null so the key is cleared, not skipped', async () => {
      await repository.mergeSummary(7, mockTenantId, { homework: null });

      expect(updateQueryBuilder.setParameter).toHaveBeenCalledWith(
        'patch',
        '{"homework":null}',
      );
    });

    it('reports 0 when the chat has no call_details row', async () => {
      updateQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const affected = await repository.mergeSummary(7, mockTenantId, {
        homework: 'x',
      });

      expect(affected).toBe(0);
    });
  });

  describe('mergeSummaryOrCreate', () => {
    it('creates the row when the merge matched nothing', async () => {
      const insert = jest.fn().mockResolvedValue({});
      const entityManager = {
        getRepository: jest.fn().mockReturnValue({ insert }),
      };
      (repository as any).dataSource.transaction = jest
        .fn()
        .mockImplementation((cb: any) => cb(entityManager));
      const mergeSummary = jest
        .spyOn(repository, 'mergeSummary')
        .mockResolvedValue(0);

      const result = await repository.mergeSummaryOrCreate(7, mockTenantId, {
        keyConcerns: 'edited',
      });

      expect(mergeSummary).toHaveBeenCalledWith(
        7,
        mockTenantId,
        { keyConcerns: 'edited' },
        entityManager,
      );
      expect(insert).toHaveBeenCalledWith({
        chatId: 7,
        tenantId: mockTenantId,
        summary: { keyConcerns: 'edited' },
      });
      expect(result).toEqual({ created: true });
    });

    it('does not insert when the merge updated a row', async () => {
      const insert = jest.fn();
      const entityManager = {
        getRepository: jest.fn().mockReturnValue({ insert }),
      };
      (repository as any).dataSource.transaction = jest
        .fn()
        .mockImplementation((cb: any) => cb(entityManager));
      jest.spyOn(repository, 'mergeSummary').mockResolvedValue(1);

      const result = await repository.mergeSummaryOrCreate(7, mockTenantId, {
        keyConcerns: 'edited',
      });

      expect(insert).not.toHaveBeenCalled();
      expect(result).toEqual({ created: false });
    });
  });
});
