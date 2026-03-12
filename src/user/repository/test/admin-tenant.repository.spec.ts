import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In, IsNull } from 'typeorm';
import { AdminTenantRepository } from '../admin-tenant.repository';
import { AdminTenant } from '../../entity/admin-tenant.entity';

describe('AdminTenantRepository', () => {
  let repository: AdminTenantRepository;

  const TENANT_A = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
  const TENANT_B = 'd56a4180-65aa-42ec-a945-5fd21dec0539';
  const USER_ID = 42;

  const makeMapping = (tenantId: string, deletedAt?: Date): AdminTenant =>
    ({
      id: 'uuid-1',
      userId: USER_ID,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: deletedAt ?? null,
    }) as unknown as AdminTenant;

  beforeEach(async () => {
    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTenantRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get<AdminTenantRepository>(AdminTenantRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  // =========================================================================
  // findByUserId
  // =========================================================================

  describe('findByUserId', () => {
    it('should call find with userId and deletedAt IsNull filter', async () => {
      const mockMappings = [makeMapping(TENANT_A)];
      jest.spyOn(repository, 'find').mockResolvedValue(mockMappings);

      const result = await repository.findByUserId(USER_ID);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: IsNull() },
      });
      expect(result).toEqual(mockMappings);
    });

    it('should return an empty array when user has no active mappings', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findByUserId(USER_ID);

      expect(result).toEqual([]);
    });

    it('should return multiple active mappings for the same user', async () => {
      const mockMappings = [makeMapping(TENANT_A), makeMapping(TENANT_B)];
      jest.spyOn(repository, 'find').mockResolvedValue(mockMappings);

      const result = await repository.findByUserId(USER_ID);

      expect(result).toHaveLength(2);
    });

    it('should NOT include soft-deleted records', async () => {
      // Soft-deleted row should be filtered by IsNull() in the query
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findByUserId(USER_ID);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: IsNull() }),
        }),
      );
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // findByUserIdAndTenantIds
  // =========================================================================

  describe('findByUserIdAndTenantIds', () => {
    it('should call find with userId, tenantId In filter, and deletedAt IsNull', async () => {
      const mockMappings = [makeMapping(TENANT_A)];
      jest.spyOn(repository, 'find').mockResolvedValue(mockMappings);

      const result = await repository.findByUserIdAndTenantIds(USER_ID, [
        TENANT_A,
      ]);

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          tenantId: In([TENANT_A]),
          deletedAt: IsNull(),
        },
      });
      expect(result).toEqual(mockMappings);
    });

    it('should return empty array when no active match exists', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findByUserIdAndTenantIds(USER_ID, [
        TENANT_A,
      ]);

      expect(result).toEqual([]);
    });

    it('should support multiple tenant IDs', async () => {
      const mockMappings = [makeMapping(TENANT_A), makeMapping(TENANT_B)];
      jest.spyOn(repository, 'find').mockResolvedValue(mockMappings);

      const result = await repository.findByUserIdAndTenantIds(USER_ID, [
        TENANT_A,
        TENANT_B,
      ]);

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          tenantId: In([TENANT_A, TENANT_B]),
          deletedAt: IsNull(),
        },
      });
      expect(result).toHaveLength(2);
    });

    it('should NOT return soft-deleted rows', async () => {
      // Soft-deleted mapping exists in DB but find with IsNull() filter returns []
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findByUserIdAndTenantIds(USER_ID, [
        TENANT_A,
      ]);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: IsNull() }),
        }),
      );
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // findByUserIdAndTenantIdsIncludingDeleted
  // =========================================================================

  describe('findByUserIdAndTenantIdsIncludingDeleted', () => {
    it('should call find with withDeleted: true', async () => {
      const mockMappings = [makeMapping(TENANT_A)];
      jest.spyOn(repository, 'find').mockResolvedValue(mockMappings);

      const result = await repository.findByUserIdAndTenantIdsIncludingDeleted(
        USER_ID,
        [TENANT_A],
      );

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: USER_ID, tenantId: In([TENANT_A]) },
        withDeleted: true,
      });
      expect(result).toEqual(mockMappings);
    });

    it('should return soft-deleted records alongside active ones', async () => {
      const active = makeMapping(TENANT_A);
      const deleted = makeMapping(TENANT_B, new Date());
      jest.spyOn(repository, 'find').mockResolvedValue([active, deleted]);

      const result = await repository.findByUserIdAndTenantIdsIncludingDeleted(
        USER_ID,
        [TENANT_A, TENANT_B],
      );

      expect(result).toHaveLength(2);
      expect(
        result.find((r) => r.tenantId === TENANT_B)?.deletedAt,
      ).toBeDefined();
    });

    it('should return empty array when no records exist at all', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result = await repository.findByUserIdAndTenantIdsIncludingDeleted(
        USER_ID,
        [TENANT_A],
      );

      expect(result).toEqual([]);
    });

    it('should support multiple tenant IDs including soft-deleted', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      await repository.findByUserIdAndTenantIdsIncludingDeleted(USER_ID, [
        TENANT_A,
        TENANT_B,
      ]);

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          tenantId: In([TENANT_A, TENANT_B]),
        },
        withDeleted: true,
      });
    });
  });
});
