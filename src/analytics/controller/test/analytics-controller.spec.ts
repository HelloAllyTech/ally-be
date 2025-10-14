import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService } from '../../service/analytics.service';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import {
  CreateDashboardDto,
  DashboardIdParamDto,
  CounselorStatsQueryDto,
} from '../../validation/analytics.validation';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;

  const mockDashboard = {
    id: 1,
    name: 'Test Dashboard',
    externalId: 'dashboard-123',
    groupId: '1',
    tenantId: 'tenant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    analyticsType: 'CALL_LOG_ANALYTICS',
  };

  const mockDashboardUrl = {
    url: 'https://metabase.example.com/embed/dashboard/token123',
  };

  const mockCounselorStats = {
    counselorName: 'John Doe',
    counselorListeningDuration: 1800.5,
    counselorSharingDuration: 600.25,
    counselorSharingPercentage: 25,
  };

  beforeEach(async () => {
    const mockAnalyticsService = {
      getDashboardUrl: jest.fn(),
      refreshDashboardUrl: jest.fn(),
      createDashboard: jest.fn(),
      getDashboards: jest.fn(),
      getCounselorStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
            getAllAndOverride: jest.fn(),
            getAllAndMerge: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getUserRoles: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
          },
        },
        {
          provide: RolesGuard,
          useValue: {
            canActivate: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: jest.fn().mockResolvedValue(true),
      })
      .compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    analyticsService = module.get(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDashboardUrl', () => {
    it('should return dashboard URL successfully', async () => {
      const dashboardId = 'dashboard-123';
      const params: DashboardIdParamDto = { dashboardId };

      analyticsService.getDashboardUrl.mockResolvedValue(mockDashboardUrl);

      const result = await controller.getDashboardUrl(params);

      expect(result).toEqual(mockDashboardUrl);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });

    it('should throw NotFoundException when dashboard not found', async () => {
      const dashboardId = 'nonexistent-dashboard';
      const params: DashboardIdParamDto = { dashboardId };

      analyticsService.getDashboardUrl.mockRejectedValue(
        new NotFoundException('Dashboard not found'),
      );

      await expect(controller.getDashboardUrl(params)).rejects.toThrow(
        new NotFoundException('Dashboard not found'),
      );

      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });

    it('should handle service errors gracefully', async () => {
      const dashboardId = 'dashboard-123';
      const params: DashboardIdParamDto = { dashboardId };
      const error = new Error('Service error');

      analyticsService.getDashboardUrl.mockRejectedValue(error);

      await expect(controller.getDashboardUrl(params)).rejects.toThrow(error);

      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
  });

  describe('refreshDashboardUrl', () => {
    it('should refresh dashboard URL successfully', async () => {
      const dashboardId = 'dashboard-123';
      const params: DashboardIdParamDto = { dashboardId };
      const refreshedUrl = {
        url: 'https://metabase.example.com/embed/dashboard/new-token',
      };

      analyticsService.refreshDashboardUrl.mockResolvedValue(refreshedUrl);

      const result = await controller.refreshDashboardUrl(params);

      expect(result).toEqual(refreshedUrl);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });

    it('should handle refresh errors', async () => {
      const dashboardId = 'dashboard-123';
      const params: DashboardIdParamDto = { dashboardId };
      const error = new Error('Refresh failed');

      analyticsService.refreshDashboardUrl.mockRejectedValue(error);

      await expect(controller.refreshDashboardUrl(params)).rejects.toThrow(
        error,
      );

      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
  });

  describe('createDashboard', () => {
    it('should create dashboard successfully', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'New Dashboard',
        externalId: 'new-dashboard',
        groupId: '2',
        description: 'Test dashboard',
        order: 1,
      };

      analyticsService.createDashboard.mockResolvedValue(mockDashboard);

      const result = await controller.createDashboard(createDashboardDto);

      expect(result).toEqual(mockDashboard);
      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });

    it('should handle dashboard creation errors', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'New Dashboard',
        externalId: 'new-dashboard',
        groupId: '2',
      };
      const error = new Error('Creation failed');

      analyticsService.createDashboard.mockRejectedValue(error);

      await expect(
        controller.createDashboard(createDashboardDto),
      ).rejects.toThrow(error);

      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });

    it('should create dashboard with minimal required fields', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'Minimal Dashboard',
        externalId: 'minimal-dashboard',
        groupId: '1',
      };

      const minimalDashboard = {
        id: 2,
        name: 'Minimal Dashboard',
        externalId: 'minimal-dashboard',
        groupId: '1',
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        analyticsType: 'CALL_LOG_ANALYTICS',
      };

      analyticsService.createDashboard.mockResolvedValue(minimalDashboard);

      const result = await controller.createDashboard(createDashboardDto);

      expect(result).toEqual(minimalDashboard);
      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });
  });

  describe('getDashboards', () => {
    it('should return user dashboards successfully', async () => {
      const mockUser = { id: 123 };
      const mockDashboards = [
        mockDashboard,
        {
          ...mockDashboard,
          id: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          analyticsType: 'ORG_ANALYTICS',
        },
      ];

      analyticsService.getDashboards.mockResolvedValue(mockDashboards);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toEqual(mockDashboards);
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should return empty array when user has no dashboards', async () => {
      const mockUser = { id: 123 };

      analyticsService.getDashboards.mockResolvedValue([]);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toEqual([]);
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should return empty array when user has no groups', async () => {
      const mockUser = { id: 123 };

      analyticsService.getDashboards.mockResolvedValue([]);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toEqual([]);
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should handle service errors', async () => {
      const mockUser = { id: 123 };
      const error = new Error('Service error');

      analyticsService.getDashboards.mockRejectedValue(error);

      await expect(
        controller.getDashboards({ user: mockUser }),
      ).rejects.toThrow(error);

      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('getCounselorStats', () => {
    it('should return counselor stats with date range', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats with only start date', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        startDate: '2024-01-01',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats with only end date', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        endDate: '2024-01-31',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats without date filters', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should handle counselor stats service errors', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};
      const error = new Error('Database error');

      analyticsService.getCounselorStats.mockRejectedValue(error);

      await expect(
        controller.getCounselorStats(queryParams, { user: mockUser }),
      ).rejects.toThrow(error);

      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should handle empty counselor stats result', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};
      const emptyStats = {
        counselorName: '',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      };

      analyticsService.getCounselorStats.mockResolvedValue(emptyStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(emptyStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });
  });
});
