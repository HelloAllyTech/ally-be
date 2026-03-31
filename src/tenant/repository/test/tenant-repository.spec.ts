import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { Pagination } from 'src/common/type/common.type';
import { TenantsRepository } from '../tenant.repository';

describe('TenantsRepository', () => {
  let repository: TenantsRepository;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    // Create mock query builder with proper Jest mock functions
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<TenantsRepository>(TenantsRepository);

    // Mock createQueryBuilder on repository instance
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('getallTenants', () => {
    it('should return all tenants without filters', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
        {
          id: 2,
          name: 'Tenant 2',
          code: 'T002',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants();

      expect(result).toEqual({
        tenants: mockTenants,
        count: 2,
      });
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('tenant');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(['tenant']);
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply search filter when search term is provided', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Test Tenant',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];
      const searchTerm = 'Test';

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants(searchTerm);

      expect(result).toEqual({
        tenants: mockTenants,
        count: 1,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(tenant.name ILIKE :search OR tenant.code ILIKE :search)',
        { search: '%Test%' },
      );
    });

    it('should trim search term before applying filter', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Test Tenant',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];
      const searchTerm = '  Test  ';

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(searchTerm);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(tenant.name ILIKE :search OR tenant.code ILIKE :search)',
        { search: '%Test%' },
      );
    });

    it('should not apply search filter when search term is empty', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants('');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should not apply search filter when search term is only whitespace', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants('   ');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should apply sorting when sortBy and order are provided', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant A',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
        {
          id: 2,
          name: 'Tenant B',
          code: 'T002',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        sortBy: 'name',
        order: 'ASC',
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants(undefined, options);

      expect(result).toEqual({
        tenants: mockTenants,
        count: 2,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'tenant.name',
        'ASC',
      );
    });

    it('should apply DESC sorting', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 2,
          name: 'Tenant B',
          code: 'T002',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
        {
          id: 1,
          name: 'Tenant A',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        sortBy: 'createdAt',
        order: 'DESC',
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'tenant.createdAt',
        'DESC',
      );
    });

    it('should apply limit when provided in options', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        limit: 10,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should apply offset when provided in options', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 11,
          name: 'Tenant 11',
          code: 'T011',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        offset: 10,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should apply both limit and offset for pagination', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 11,
          name: 'Tenant 11',
          code: 'T011',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
        {
          id: 12,
          name: 'Tenant 12',
          code: 'T012',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        limit: 10,
        offset: 10,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants(undefined, options);

      expect(result).toEqual({
        tenants: mockTenants,
        count: 50,
      });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should apply all options together - search, sort, limit, offset', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 21,
          name: 'Test Tenant 21',
          code: 'T021',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
        {
          id: 22,
          name: 'Test Tenant 22',
          code: 'T022',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const searchTerm = 'Test';
      const options: Pagination = {
        sortBy: 'name',
        order: 'ASC',
        limit: 10,
        offset: 20,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(100);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants(searchTerm, options);

      expect(result).toEqual({
        tenants: mockTenants,
        count: 100,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(tenant.name ILIKE :search OR tenant.code ILIKE :search)',
        { search: '%Test%' },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'tenant.name',
        'ASC',
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(20);
    });

    it('should return empty array when no tenants found', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getAllTenants();

      expect(result).toEqual({
        tenants: [],
        count: 0,
      });
    });

    it('should handle options with only sortBy without order', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        sortBy: 'name',
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'tenant.name',
        undefined,
      );
    });

    it('should not apply limit when limit is 0', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        limit: 0,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should not apply offset when offset is 0', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      const options: Pagination = {
        offset: 0,
      };

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(undefined, options);

      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle undefined options', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Tenant 1',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      const result = await repository.getAllTenants(undefined, undefined);

      expect(result).toEqual({
        tenants: mockTenants,
        count: 1,
      });
      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle search with special characters', async () => {
      const mockTenants: Tenant[] = [
        {
          id: 1,
          name: 'Test & Tenant',
          code: 'T001',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Tenant,
      ];
      const searchTerm = 'Test & ';

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTenants);

      await repository.getAllTenants(searchTerm);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(tenant.name ILIKE :search OR tenant.code ILIKE :search)',
        { search: '%Test &%' },
      );
    });
  });
});
