import { Dashboard } from '../../entity/dashboards.entity';
import { AnalyticsService } from '../analytics.service';
import { AnalyticsInterface } from 'src/analytics/interface/analytics.interface';
import { GroupService } from 'src/authorization/service/group.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AnalyticsUtil } from 'src/analytics/util/analytics.util';
import { Test, TestingModule } from '@nestjs/testing';
import { CreateDashboardDto } from '../../dto/analytics.dto';
import { AnalyticsTypeEnum } from '../../constants/analytics.constants';
import { DashboardRepository } from '../../repository/dashboard.repository';
import { ChatSharedService } from '../../../chat/service/chat-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { DataSource } from 'typeorm';
import { DashboardTenant } from '../../entity/dashboard-tenant.entity';
import { DashboardGroup } from '../../entity/dashboard-group.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

// Mock the static classes at the top level
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

jest.mock('src/analytics/util/analytics.util', () => ({
  AnalyticsUtil: {
    generateParamList: jest.fn(),
  },
}));

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let dashboardRepository: jest.Mocked<DashboardRepository>;
  let chatSharedService: jest.Mocked<ChatSharedService>;
  let analyticsInterface: jest.Mocked<AnalyticsInterface>;
  let groupService: jest.Mocked<GroupService>;
  let tenantService: jest.Mocked<TenantService>;
  let dataSource: jest.Mocked<DataSource>;

  const mockTenantId = 'tenant-23';
  const mockUserId = 123;
  const mockDashboard: Dashboard = {
    id: 'uuid-dashboard-123',
    externalId: 'dashboard-123',
    name: 'Test Dashboard',
    metadata: {
      params: ['organization_id', 'user_id'],
    },
    analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
  } as Dashboard;

  beforeEach(async () => {
    const mockAnalyticsInterface = {
      getDashboardUrl: jest.fn(),
      refreshDashboardUrl: jest.fn(),
    };
    const mockDashboardRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findByExternalId: jest.fn(),
      findByExternalIdAndTenant: jest.fn(),
      findByGroupIdAndTenant: jest.fn(),
    };
    const mockChatSharedService = {
      getCounselorStatsRaw: jest.fn(),
    };
    const mockGroupService = {
      getUserGroups: jest.fn(),
      getUserRolesByUserId: jest.fn(),
      getGroupNames: jest.fn(),
    };
    const mockTenantService = {
      findById: jest.fn(),
    };
    const mockDashboardTenantRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const mockTransactionEntityManager = {
      getRepository: jest.fn(),
    };
    const mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(async (fn: (em: any) => any) => {
          const dashboardRepo = {
            create: jest
              .fn()
              .mockImplementation((dto: any) => ({ ...dto, id: 'new-uuid' })),
            save: jest
              .fn()
              .mockImplementation((entity: any) =>
                Promise.resolve({ ...entity, id: entity.id || 'new-uuid' }),
              ),
          };
          const dashboardTenantRepo = {
            create: jest.fn().mockImplementation((dto: any) => dto),
            save: jest.fn().mockResolvedValue(undefined),
          };
          const dashboardGroupRepo = {
            create: jest.fn().mockImplementation((dto: any) => dto),
            save: jest.fn().mockResolvedValue(undefined),
          };
          mockTransactionEntityManager.getRepository.mockImplementation(
            (entity: any) => {
              if (entity === Dashboard) return dashboardRepo;
              if (entity === DashboardTenant) return dashboardTenantRepo;
              if (entity === DashboardGroup) return dashboardGroupRepo;
              return {};
            },
          );
          return fn(mockTransactionEntityManager);
        }),
    };

    // Now you can use mockReturnValue since the classes are mocked
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
    (ExecutionManager.getExecutionId as jest.Mock).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: 'AnalyticsInterface',
          useValue: mockAnalyticsInterface,
        },
        {
          provide: DashboardRepository,
          useValue: mockDashboardRepo,
        },
        {
          provide: ChatSharedService,
          useValue: mockChatSharedService,
        },
        {
          provide: GroupService,
          useValue: mockGroupService,
        },
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(DashboardTenant),
          useValue: mockDashboardTenantRepo,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    analyticsInterface = module.get('AnalyticsInterface');
    dashboardRepository = module.get(DashboardRepository);
    chatSharedService = module.get(ChatSharedService);
    groupService = module.get(GroupService);
    tenantService = module.get(TenantService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Refresh dashboard url
  describe('refreshDashboardUrl', () => {
    it('should handle errors from analytics interface', async () => {
      const dashboardId = 'dashboard-123';
      const error = new Error('External service error');

      analyticsInterface.refreshDashboardUrl.mockRejectedValue(error);

      await expect(service.refreshDashboardUrl(dashboardId)).rejects.toThrow(
        'External service error',
      );
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
    it('should successfully refresh dashboard URL', async () => {
      // mock data
      const dashboardId = 'dashboard-123';
      const expectedUrl = 'https://analytics.com/refresh/dashboard-123';
      // mocking analyticsinterface to return expected url
      analyticsInterface.refreshDashboardUrl.mockResolvedValue(expectedUrl);
      const result = await service.refreshDashboardUrl(dashboardId);

      expect(result).toEqual({ url: expectedUrl });

      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
  });

  describe('getDashboardUrl', () => {
    it('should throw NotFoundException when dashboard not found', async () => {
      const dashboardId = 'nonexistent-dashboard';

      dashboardRepository.findByExternalIdAndTenant.mockResolvedValue(null);

      await expect(service.getDashboardUrl(dashboardId)).rejects.toThrow(
        'Dashboard not found',
      );

      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledTimes(1);
      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledWith(dashboardId, mockTenantId);
      expect(AnalyticsUtil.generateParamList).not.toHaveBeenCalled();
      expect(analyticsInterface.getDashboardUrl).not.toHaveBeenCalled();
    });
    it('should successfully get dashboard URL with parameters', async () => {
      const dashboardId = 'dashboard-123';
      const expectedUrl =
        'https://analytics.com/dashboard-123?organization_id=tenant-23&user_id=user-123';

      dashboardRepository.findByExternalIdAndTenant.mockResolvedValue(
        mockDashboard,
      );
      (AnalyticsUtil.generateParamList as jest.Mock).mockReturnValue({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      analyticsInterface.getDashboardUrl.mockResolvedValue(expectedUrl);

      const result = await service.getDashboardUrl(dashboardId);

      expect(result.url).toBe(expectedUrl);

      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledTimes(1);
      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledWith(dashboardId, mockTenantId);

      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledTimes(1);
      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledWith(
        mockDashboard.metadata?.params,
      );

      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
        { organization_id: 'tenant-23', user_id: 123 },
      );
    });
    it('should handle dashboard with no parameters', async () => {
      const dashboardWithNoParams: Dashboard = {
        ...mockDashboard,
        metadata: undefined,
      };

      dashboardRepository.findByExternalIdAndTenant.mockResolvedValue(
        dashboardWithNoParams,
      );
      (AnalyticsUtil.generateParamList as jest.Mock).mockReturnValue([]);
      analyticsInterface.getDashboardUrl.mockResolvedValue(
        'https://analytics.com/simple',
      );

      const result = await service.getDashboardUrl('dashboard-123');

      expect(result.url).toBe('https://analytics.com/simple');

      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledTimes(1);
      expect(
        dashboardRepository.findByExternalIdAndTenant,
      ).toHaveBeenCalledWith('dashboard-123', mockTenantId);

      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledTimes(1);
      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledWith([]);

      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledWith(
        'dashboard-123',
        [],
      );
    });
  });

  describe('createDashboard', () => {
    const mockDashboardDto: CreateDashboardDto = {
      name: 'New Dashboard',
      externalId: 'new-dashboard',
      description: 'Test dashboard',
      tenantIds: [mockTenantId],
      groupIds: [1, 2],
      analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
    };

    it('should create a dashboard when none exists', async () => {
      dashboardRepository.findByExternalId.mockResolvedValue(null);
      groupService.getGroupNames.mockResolvedValue(['COUNSELOR', 'ADMIN']);
      tenantService.findById.mockResolvedValue({ id: mockTenantId } as any);

      await service.createDashboard(mockDashboardDto);

      expect(dashboardRepository.findByExternalId).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findByExternalId).toHaveBeenCalledWith(
        mockDashboardDto.externalId,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException when dashboard already exists', async () => {
      const existingDashboard = {
        id: 'existing-uuid',
        ...mockDashboardDto,
      } as Dashboard;
      dashboardRepository.findByExternalId.mockResolvedValue(existingDashboard);

      await expect(service.createDashboard(mockDashboardDto)).rejects.toThrow(
        'Dashboard already exists',
      );

      expect(dashboardRepository.findByExternalId).toHaveBeenCalledWith(
        mockDashboardDto.externalId,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getDashboards', () => {
    it('should return when user has no groups', async () => {
      groupService.getUserRolesByUserId.mockResolvedValue([]);

      const result = await service.getDashboards(mockUserId);

      expect(result).toEqual(undefined);

      expect(groupService.getUserRolesByUserId).toHaveBeenCalledTimes(1);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(
        mockUserId,
      );

      expect(dashboardRepository.findByGroupIdAndTenant).not.toHaveBeenCalled();
    });
    it('should return dashboards when user has groups', async () => {
      const mockUserGroups = [
        {
          id: 1,
          name: 'COUNSELOR',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { id: 2, name: 'ADMIN', createdAt: new Date(), updatedAt: new Date() },
        {
          id: 3,
          name: 'LEARNER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      groupService.getUserRolesByUserId.mockResolvedValue(mockUserGroups);
      const mockDashboards = [
        {
          ...mockDashboard,
          groupId: 1,
          analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
        },
        {
          ...mockDashboard,
          groupId: 2,
          analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
        },
        {
          ...mockDashboard,
          groupId: 3,
          analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
        },
      ];
      dashboardRepository.findByGroupIdAndTenant.mockResolvedValue(
        mockDashboards,
      );

      const result = await service.getDashboards(mockUserId);

      expect(result).toEqual(mockDashboards);

      expect(groupService.getUserRolesByUserId).toHaveBeenCalledTimes(1);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(
        mockUserId,
      );

      expect(dashboardRepository.findByGroupIdAndTenant).toHaveBeenCalledTimes(
        1,
      );
      expect(dashboardRepository.findByGroupIdAndTenant).toHaveBeenCalledWith(
        mockTenantId,
        [1, 2, 3],
      );
    });
  });

  describe('getCounselorStats', () => {
    it('should calculate counselor stats from raw data', async () => {
      const queryParams = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };
      const userId = mockUserId;

      const mockRawResult = {
        counselorName: 'John Doe',
        counselorListeningDuration: '1800.50',
        counselorSharingDuration: '600.25',
      };

      chatSharedService.getCounselorStatsRaw.mockResolvedValue(mockRawResult);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'John Doe',
        counselorListeningDuration: 1800.5,
        counselorSharingDuration: 600.25,
        counselorSharingPercentage: 25,
      });
      expect(chatSharedService.getCounselorStatsRaw).toHaveBeenCalledTimes(1);
      expect(chatSharedService.getCounselorStatsRaw).toHaveBeenCalledWith(
        queryParams,
        userId,
      );
    });

    it('should pass through query params to ChatSharedService', async () => {
      const queryParams = { startDate: '2024-01-01' };
      const userId = mockUserId;

      const mockRawResult = {
        counselorName: 'Jane Doe',
        counselorListeningDuration: '1800.5',
        counselorSharingDuration: '600.25',
      };

      chatSharedService.getCounselorStatsRaw.mockResolvedValue(mockRawResult);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Jane Doe',
        counselorListeningDuration: 1800.5,
        counselorSharingDuration: 600.25,
        counselorSharingPercentage: 25,
      });
      expect(chatSharedService.getCounselorStatsRaw).toHaveBeenCalledWith(
        queryParams,
        userId,
      );
    });

    it('should handle null result from ChatSharedService', async () => {
      const queryParams = {};
      const userId = mockUserId;

      chatSharedService.getCounselorStatsRaw.mockResolvedValue(null);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: '',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });
      expect(chatSharedService.getCounselorStatsRaw).toHaveBeenCalledWith(
        queryParams,
        userId,
      );
    });

    it('should handle zero talking time (avoid division by zero)', async () => {
      const queryParams = {};
      const userId = mockUserId;

      const mockRawResult = {
        counselorName: 'Silent Counselor',
        counselorListeningDuration: '0',
        counselorSharingDuration: '0',
      };

      chatSharedService.getCounselorStatsRaw.mockResolvedValue(mockRawResult);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Silent Counselor',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });
    });

    it('should handle errors from ChatSharedService', async () => {
      const queryParams = {};
      const userId = mockUserId;
      const error = new Error('Database error');

      chatSharedService.getCounselorStatsRaw.mockRejectedValue(error);

      await expect(
        service.getCounselorStats(queryParams, userId),
      ).rejects.toThrow('Database error');

      expect(chatSharedService.getCounselorStatsRaw).toHaveBeenCalledWith(
        queryParams,
        userId,
      );
    });
  });
});
