import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { TenantDashboardSharedService } from '../tenant-dashboard-shared';
import { Dashboard } from 'src/analytics/entity/dashboards.entity';
import { DashboardTenant } from 'src/analytics/entity/dashboard-tenant.entity';

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

describe('TenantDashboardSharedService', () => {
  let service: TenantDashboardSharedService;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockDashboardRepo: jest.Mocked<Repository<Dashboard>>;
  let mockDashboardTenantRepo: jest.Mocked<Repository<DashboardTenant>>;

  beforeEach(async () => {
    mockDashboardRepo = {
      find: jest.fn(),
    } as any;

    mockDashboardTenantRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softDelete: jest.fn(),
    } as any;

    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === Dashboard) {
          return mockDashboardRepo;
        }
        if (entity === DashboardTenant) {
          return mockDashboardTenantRepo;
        }
        return {} as any;
      }),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantDashboardSharedService],
    }).compile();

    service = module.get<TenantDashboardSharedService>(
      TenantDashboardSharedService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEnabledDashboardIdsForTenants', () => {
    it('should return dashboard IDs grouped by tenant', async () => {
      const tenantIds = ['tenant-1', 'tenant-2'];
      const expectedResults = [
        { tenantId: 'tenant-1', dashboardIds: ['dash-1', 'dash-2'] },
        { tenantId: 'tenant-2', dashboardIds: ['dash-3'] },
      ];

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(expectedResults),
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const result = await service.getEnabledDashboardIdsForTenants(
        tenantIds,
        mockEntityManager,
      );

      expect(mockEntityManager.createQueryBuilder).toHaveBeenCalledWith(
        DashboardTenant,
        'dt',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'dt.tenantId',
        'tenantId',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'ARRAY_AGG(dt.dashboardId)',
        'dashboardIds',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'dt.tenantId IN (:...tenantIds)',
        { tenantIds },
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('dt.tenantId');
      expect(result).toEqual(expectedResults);
    });
  });

  describe('assignDashboardsToTenant', () => {
    const tenantId = 'tenant-123';

    it('should add new dashboards that do not already exist', async () => {
      const enabledDashboardIds = ['dash-1', 'dash-2'];

      mockDashboardTenantRepo.find.mockResolvedValue([]);
      mockDashboardTenantRepo.create.mockImplementation(
        (entity) => entity as any,
      );
      mockDashboardTenantRepo.save.mockResolvedValue([] as any);

      await service.assignDashboardsToTenant(
        tenantId,
        enabledDashboardIds,
        mockEntityManager,
      );

      expect(mockDashboardTenantRepo.find).toHaveBeenCalledWith({
        where: { tenantId },
        select: ['dashboardId'],
      });
      expect(mockDashboardTenantRepo.create).toHaveBeenCalledTimes(2);
      expect(mockDashboardTenantRepo.create).toHaveBeenCalledWith({
        dashboardId: 'dash-1',
        tenantId,
      });
      expect(mockDashboardTenantRepo.create).toHaveBeenCalledWith({
        dashboardId: 'dash-2',
        tenantId,
      });
      expect(mockDashboardTenantRepo.save).toHaveBeenCalledTimes(1);
      expect(mockDashboardTenantRepo.softDelete).not.toHaveBeenCalled();
    });

    it('should soft-delete dashboards that are no longer in the requested set', async () => {
      const enabledDashboardIds: string[] = [];

      mockDashboardTenantRepo.find.mockResolvedValue([
        { dashboardId: 'dash-1' },
        { dashboardId: 'dash-2' },
      ] as DashboardTenant[]);
      mockDashboardTenantRepo.softDelete.mockResolvedValue({} as any);

      await service.assignDashboardsToTenant(
        tenantId,
        enabledDashboardIds,
        mockEntityManager,
      );

      expect(mockDashboardTenantRepo.softDelete).toHaveBeenCalledWith({
        tenantId,
        dashboardId: expect.anything(),
      });
      expect(mockDashboardTenantRepo.save).not.toHaveBeenCalled();
    });

    it('should add new and remove old dashboards simultaneously', async () => {
      const enabledDashboardIds = ['dash-2', 'dash-3'];

      mockDashboardTenantRepo.find.mockResolvedValue([
        { dashboardId: 'dash-1' },
        { dashboardId: 'dash-2' },
      ] as DashboardTenant[]);
      mockDashboardTenantRepo.create.mockImplementation(
        (entity) => entity as any,
      );
      mockDashboardTenantRepo.save.mockResolvedValue([] as any);
      mockDashboardTenantRepo.softDelete.mockResolvedValue({} as any);

      await service.assignDashboardsToTenant(
        tenantId,
        enabledDashboardIds,
        mockEntityManager,
      );

      // dash-1 should be removed (exists but not requested)
      expect(mockDashboardTenantRepo.softDelete).toHaveBeenCalledWith({
        tenantId,
        dashboardId: expect.anything(),
      });

      // dash-3 should be added (requested but doesn't exist)
      expect(mockDashboardTenantRepo.create).toHaveBeenCalledTimes(1);
      expect(mockDashboardTenantRepo.create).toHaveBeenCalledWith({
        dashboardId: 'dash-3',
        tenantId,
      });
      expect(mockDashboardTenantRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when requested and existing dashboards are identical', async () => {
      const enabledDashboardIds = ['dash-1', 'dash-2'];

      mockDashboardTenantRepo.find.mockResolvedValue([
        { dashboardId: 'dash-1' },
        { dashboardId: 'dash-2' },
      ] as DashboardTenant[]);

      await service.assignDashboardsToTenant(
        tenantId,
        enabledDashboardIds,
        mockEntityManager,
      );

      expect(mockDashboardTenantRepo.softDelete).not.toHaveBeenCalled();
      expect(mockDashboardTenantRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('validateDashboardIds', () => {
    it('should pass when all dashboard IDs are valid', async () => {
      const enabledDashboardIds = ['dash-1', 'dash-2', 'dash-3'];
      const dashboards = [
        { id: 'dash-1' },
        { id: 'dash-2' },
        { id: 'dash-3' },
      ] as Dashboard[];

      mockDashboardRepo.find.mockResolvedValue(dashboards);

      await expect(
        service.validateDashboardIds(enabledDashboardIds, mockEntityManager),
      ).resolves.not.toThrow();

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Dashboard);
      expect(mockDashboardRepo.find).toHaveBeenCalledWith({
        where: { id: expect.anything() },
      });
    });

    it('should throw NotFoundException when some dashboard IDs are not found', async () => {
      const enabledDashboardIds = ['dash-1', 'dash-2', 'dash-3'];
      const dashboards = [{ id: 'dash-1' }] as Dashboard[];

      mockDashboardRepo.find.mockResolvedValue(dashboards);

      await expect(
        service.validateDashboardIds(enabledDashboardIds, mockEntityManager),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.validateDashboardIds(enabledDashboardIds, mockEntityManager),
      ).rejects.toThrow('One or more dashboards not found');
    });

    it('should pass with a single valid dashboard ID', async () => {
      const enabledDashboardIds = ['dash-1'];
      const dashboards = [{ id: 'dash-1' }] as Dashboard[];

      mockDashboardRepo.find.mockResolvedValue(dashboards);

      await expect(
        service.validateDashboardIds(enabledDashboardIds, mockEntityManager),
      ).resolves.not.toThrow();
    });
  });
});
