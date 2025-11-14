import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserRepository } from '../user.repository';
import { User } from 'src/user/entity/user.entity';
import { UserSortBy, SortOrder } from 'src/user/enum/user.enum';
import { UserFilterOptions } from 'src/user/interface/user-filter-options.interface';

describe('UserRepository', () => {
  let repository: UserRepository;
  let dataSource: jest.Mocked<DataSource>;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    // Create mock query builder
    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getRawMany: jest.fn(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
    dataSource = module.get(DataSource);

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

  describe('getAllUsers', () => {
    it('should return all users without filters', async () => {
      const mockUsers = [
        {
          user_id: 1,
          user_name: 'User 1',
          user_email: 'user1@test.com',
          tenant_name: 'Tenant 1',
          simulation_credit_limit: 100,
          simulation_consumed_credits: 50,
        },
        {
          user_id: 2,
          user_name: 'User 2',
          user_email: 'user2@test.com',
          tenant_name: 'Tenant 2',
          simulation_credit_limit: 200,
          simulation_consumed_credits: 100,
        },
      ];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(2);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      const result = await repository.getAllUsers();

      expect(result).toEqual({
        users: mockUsers,
        count: 2,
      });
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.select).toHaveBeenCalled();
    });

    it('should return empty result when no users found', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(0);

      const result = await repository.getAllUsers();

      expect(result).toEqual({
        users: [],
        count: 0,
      });
      expect(mockQueryBuilder.getRawMany).not.toHaveBeenCalled();
    });

    it('should exclude super admin by default', async () => {
      const mockUsers = [{ user_id: 1, user_name: 'User 1' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers();

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.objectContaining({ superAdminRole: 'SUPER_ADMIN' }),
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('g_excl.name = :superAdminRole'),
        expect.objectContaining({ superAdminRole: 'SUPER_ADMIN' }),
      );
    });

    it('should include super admin when excludeSuperAdmin is false', async () => {
      const mockUsers = [{ user_id: 1, user_name: 'Admin' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(undefined, false);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should apply tenant ID filter', async () => {
      const filters: UserFilterOptions = {
        tenantIds: '1,2,3',
      };
      const mockUsers = [{ user_id: 1, tenant_id: '1' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'CAST(user.tenantId AS TEXT) IN (:...tenantIds)',
        { tenantIds: ['1', '2', '3'] },
      );
    });

    it('should apply roles filter', async () => {
      const filters: UserFilterOptions = {
        roles: 'ADMIN,USER',
      };
      const mockUsers = [{ user_id: 1, role: 'ADMIN' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('g.name IN (:...roles)'),
        expect.objectContaining({
          roles: ['ADMIN', 'USER'],
          superAdminRole: 'SUPER_ADMIN',
        }),
      );
    });

    it('should apply status filter', async () => {
      const filters: UserFilterOptions = {
        statuses: 'active,pending',
      };
      const mockUsers = [{ user_id: 1, status: 'active' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.status IN (:...statuses)',
        { statuses: ['active', 'pending'] },
      );
    });

    it('should apply search filter', async () => {
      const filters: UserFilterOptions = {
        search: 'John',
      };
      const mockUsers = [{ user_id: 1, user_name: 'John Doe' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(user.name ILIKE :search OR user.email ILIKE :search)',
        { search: '%John%' },
      );
    });

    it('should trim search term', async () => {
      const filters: UserFilterOptions = {
        search: '  John  ',
      };
      const mockUsers = [{ user_id: 1, user_name: 'John Doe' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(user.name ILIKE :search OR user.email ILIKE :search)',
        { search: '%John%' },
      );
    });

    it('should not apply search filter when search is empty', async () => {
      const filters: UserFilterOptions = {
        search: '',
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.objectContaining({ superAdminRole: 'SUPER_ADMIN' }),
      );
    });

    it('should apply sorting with ASC order', async () => {
      const filters: UserFilterOptions = {
        sortBy: UserSortBy.NAME,
        order: SortOrder.ASC,
      };
      const mockUsers = [{ user_id: 1, user_name: 'A User' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        `user.${UserSortBy.NAME}`,
        SortOrder.ASC,
      );
    });

    it('should apply DESC sorting', async () => {
      const filters: UserFilterOptions = {
        sortBy: UserSortBy.CREATED_AT,
        order: SortOrder.DESC,
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        `user.${UserSortBy.CREATED_AT}`,
        SortOrder.DESC,
      );
    });

    it('should apply limit', async () => {
      const filters: UserFilterOptions = {
        limit: 10,
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should apply offset', async () => {
      const filters: UserFilterOptions = {
        offset: 20,
      };
      const mockUsers = [{ user_id: 21 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(50);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(20);
    });

    it('should apply all filters together', async () => {
      const filters: UserFilterOptions = {
        tenantIds: '1,2',
        roles: 'ADMIN',
        statuses: 'active',
        search: 'John',
        sortBy: UserSortBy.NAME,
        order: SortOrder.ASC,
        limit: 10,
        offset: 10,
      };
      const mockUsers = [{ user_id: 1, user_name: 'John Admin' }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      const result = await repository.getAllUsers(filters);

      expect(result).toEqual({
        users: mockUsers,
        count: 1,
      });

      // Verify tenant filter was applied
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'CAST(user.tenantId AS TEXT) IN (:...tenantIds)',
        { tenantIds: ['1', '2'] },
      );

      // Verify roles filter and super admin exclusion were applied together
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.objectContaining({
          superAdminRole: 'SUPER_ADMIN',
          roles: ['ADMIN'],
        }),
      );

      // Verify status filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.status IN (:...statuses)',
        { statuses: ['active'] },
      );

      // Verify search filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(user.name ILIKE :search OR user.email ILIKE :search)',
        { search: '%John%' },
      );

      // Verify sorting
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        `user.${UserSortBy.NAME}`,
        SortOrder.ASC,
      );

      // Verify pagination
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });

    it('should handle empty tenant IDs string', async () => {
      const filters: UserFilterOptions = {
        tenantIds: '',
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'CAST(user.tenantId AS TEXT) IN (:...tenantIds)',
        expect.any(Object),
      );
    });

    it('should parse comma-separated values correctly', async () => {
      const filters: UserFilterOptions = {
        tenantIds: '1, 2 , 3',
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'CAST(user.tenantId AS TEXT) IN (:...tenantIds)',
        { tenantIds: ['1', '2', '3'] },
      );
    });

    it('should not apply limit when limit is 0', async () => {
      const filters: UserFilterOptions = {
        limit: 0,
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should not apply offset when offset is 0', async () => {
      const filters: UserFilterOptions = {
        offset: 0,
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle sorting without order specified', async () => {
      const filters: UserFilterOptions = {
        sortBy: UserSortBy.NAME,
      };
      const mockUsers = [{ user_id: 1 }];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(1);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockUsers);

      await repository.getAllUsers(filters);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        `user.${UserSortBy.NAME}`,
        undefined,
      );
    });
  });

  describe('getUserCountByTenantIds', () => {
    it('should return user counts for given tenant IDs', async () => {
      const tenantIds = ['1', '2', '3'];
      const expectedCounts = [
        { tenantId: '1', userCount: '10' },
        { tenantId: '2', userCount: '5' },
        { tenantId: '3', userCount: '15' },
      ];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(
        expectedCounts,
      );

      const result = await repository.getUserCountByTenantIds(tenantIds);

      expect(result).toEqual(expectedCounts);
      expect(dataSource.createQueryBuilder).toHaveBeenCalledWith(User, 'user');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.tenant_id',
        'tenantId',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'COUNT(*)',
        'userCount',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'user.tenant_id IN (:...tenantIds)',
        { tenantIds },
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.tenant_id');
    });

    it('should return empty array when no users found for tenant IDs', async () => {
      const tenantIds = ['999'];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getUserCountByTenantIds(tenantIds);

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should handle multiple tenant IDs', async () => {
      const tenantIds = ['1', '2', '3', '4', '5'];
      const expectedCounts = [
        { tenantId: '1', userCount: '10' },
        { tenantId: '2', userCount: '20' },
        { tenantId: '3', userCount: '30' },
        { tenantId: '4', userCount: '40' },
        { tenantId: '5', userCount: '50' },
      ];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(
        expectedCounts,
      );

      const result = await repository.getUserCountByTenantIds(tenantIds);

      expect(result).toEqual(expectedCounts);
      expect(result).toHaveLength(5);
    });

    it('should handle single tenant ID', async () => {
      const tenantIds = ['1'];
      const expectedCounts = [{ tenantId: '1', userCount: '10' }];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(
        expectedCounts,
      );

      const result = await repository.getUserCountByTenantIds(tenantIds);

      expect(result).toEqual(expectedCounts);
      expect(result).toHaveLength(1);
    });

    it('should handle empty tenant IDs array', async () => {
      const tenantIds: string[] = [];

      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getUserCountByTenantIds(tenantIds);

      expect(result).toEqual([]);
    });
  });
});
