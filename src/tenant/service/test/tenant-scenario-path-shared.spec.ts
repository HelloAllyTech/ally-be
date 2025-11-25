import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, Repository } from 'typeorm';
import { TenantScenarioPathSharedService } from '../tenant-scenario-path-shared';
import { ScenarioPath } from 'src/scenario-path/entity/scenario-path.entity';
import { ScenarioPathTenant } from 'src/scenario-path/entity/scenario-path-tenant.entity';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

describe('TenantScenarioPathSharedService', () => {
  let service: TenantScenarioPathSharedService;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockScenarioPathRepo: jest.Mocked<Repository<ScenarioPath>>;
  let mockScenarioPathTenantRepo: jest.Mocked<Repository<ScenarioPathTenant>>;

  beforeEach(async () => {
    mockScenarioPathRepo = {
      find: jest.fn(),
    } as any;

    mockScenarioPathTenantRepo = {
      insert: jest.fn(),
    } as any;

    mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === ScenarioPath) {
          return mockScenarioPathRepo;
        }
        if (entity === ScenarioPathTenant) {
          return mockScenarioPathTenantRepo;
        }
        return {} as any;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantScenarioPathSharedService],
    }).compile();

    service = module.get<TenantScenarioPathSharedService>(
      TenantScenarioPathSharedService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignGlobalScenarioPathsToTenant', () => {
    it('should assign global scenario paths to tenant successfully', async () => {
      const tenantId = 'tenant-123';
      const globalScenarioPaths = [
        { id: 'path-1', isGlobal: true, title: 'Path 1' },
        { id: 'path-2', isGlobal: true, title: 'Path 2' },
        { id: 'path-3', isGlobal: true, title: 'Path 3' },
      ] as ScenarioPath[];

      mockScenarioPathRepo.find.mockResolvedValue(globalScenarioPaths);
      mockScenarioPathTenantRepo.insert.mockResolvedValue({} as any);

      await service.assignGlobalScenarioPathsToTenant(
        tenantId,
        mockEntityManager,
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioPath,
      );
      expect(mockScenarioPathRepo.find).toHaveBeenCalledWith({
        where: { isGlobal: true },
      });

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(
        ScenarioPathTenant,
      );
      expect(mockScenarioPathTenantRepo.insert).toHaveBeenCalledWith([
        { scenarioPathId: 'path-1', tenantId: 'tenant-123' },
        { scenarioPathId: 'path-2', tenantId: 'tenant-123' },
        { scenarioPathId: 'path-3', tenantId: 'tenant-123' },
      ]);
    });

    it('should handle empty global scenario paths with warning', async () => {
      const tenantId = 'tenant-123';

      mockScenarioPathRepo.find.mockResolvedValue([]);

      await service.assignGlobalScenarioPathsToTenant(
        tenantId,
        mockEntityManager,
      );

      expect(mockScenarioPathRepo.find).toHaveBeenCalledWith({
        where: { isGlobal: true },
      });
      expect(mockScenarioPathTenantRepo.insert).not.toHaveBeenCalled();
    });

    it('should handle single global scenario path', async () => {
      const tenantId = 'tenant-456';
      const singlePath = [
        { id: 'path-1', isGlobal: true, title: 'Single Path' },
      ] as ScenarioPath[];

      mockScenarioPathRepo.find.mockResolvedValue(singlePath);
      mockScenarioPathTenantRepo.insert.mockResolvedValue({} as any);

      await service.assignGlobalScenarioPathsToTenant(
        tenantId,
        mockEntityManager,
      );

      expect(mockScenarioPathTenantRepo.insert).toHaveBeenCalledWith([
        { scenarioPathId: 'path-1', tenantId: 'tenant-456' },
      ]);
    });

    it('should handle repository errors gracefully', async () => {
      const tenantId = 'tenant-789';
      const error = new Error('Database error');

      mockScenarioPathRepo.find.mockRejectedValue(error);

      await expect(
        service.assignGlobalScenarioPathsToTenant(tenantId, mockEntityManager),
      ).rejects.toThrow('Database error');

      expect(mockScenarioPathTenantRepo.insert).not.toHaveBeenCalled();
    });

    it('should handle insert errors', async () => {
      const tenantId = 'tenant-999';
      const globalScenarioPaths = [
        { id: 'path-1', isGlobal: true, title: 'Path 1' },
      ] as ScenarioPath[];
      const insertError = new Error('Insert failed');

      mockScenarioPathRepo.find.mockResolvedValue(globalScenarioPaths);
      mockScenarioPathTenantRepo.insert.mockRejectedValue(insertError);

      await expect(
        service.assignGlobalScenarioPathsToTenant(tenantId, mockEntityManager),
      ).rejects.toThrow('Insert failed');
    });
  });
});
