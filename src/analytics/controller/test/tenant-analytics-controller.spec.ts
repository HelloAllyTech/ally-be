import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TenantAnalyticsController } from '../tenant-analytics.controller';
import { AnalyticsService } from '../../service/analytics.service';
import { TenantAnalyticsService } from '../../service/tenant-analytics.service';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { UserService } from '../../../user/service/user.service';
import { EnableAnalyticsDto } from '../../dto/enable-analytics.dto';
import { OrganizationMetricsResponseDto } from '../../dto/tenant-analytics.dto';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('TenantAnalyticsController', () => {
  let controller: TenantAnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;
  let tenantAnalyticsService: jest.Mocked<TenantAnalyticsService>;

  beforeEach(async () => {
    const mockAnalyticsService = {
      updateTenantDashboards: jest.fn(),
    };

    const mockTenantAnalyticsService = {
      getOrganizationMetrics: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantAnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
        {
          provide: TenantAnalyticsService,
          useValue: mockTenantAnalyticsService,
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
            getUserPermissions: jest
              .fn()
              .mockResolvedValue([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD]),
          },
        },
        {
          provide: UserService,
          useValue: {
            getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PermissionsGuard,
          useValue: {
            canActivate: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get(TenantAnalyticsController);
    analyticsService = module.get(AnalyticsService);
    tenantAnalyticsService = module.get(TenantAnalyticsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateTenantDashboards', () => {
    it('should update tenant dashboards successfully', async () => {
      const enableAnalyticsDto: EnableAnalyticsDto = {
        dashboardIds: ['550e8400-e29b-41d4-a716-446655440000'],
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
      };

      analyticsService.updateTenantDashboards.mockResolvedValue(true);

      const result =
        await controller.updateTenantDashboards(enableAnalyticsDto);

      expect(result).toBe(true);
      expect(analyticsService.updateTenantDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.updateTenantDashboards).toHaveBeenCalledWith(
        enableAnalyticsDto,
      );
    });

    it('should return false when update fails', async () => {
      const enableAnalyticsDto: EnableAnalyticsDto = {
        dashboardIds: [],
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
      };

      analyticsService.updateTenantDashboards.mockResolvedValue(false);

      const result =
        await controller.updateTenantDashboards(enableAnalyticsDto);

      expect(result).toBe(false);
      expect(analyticsService.updateTenantDashboards).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOrganizationMetrics', () => {
    const tenantId = '123e4567-e89b-12d3-a456-426614174000';

    const response: OrganizationMetricsResponseDto = {
      range: '30d',
      bucket: 'day',
      summary: {
        simulationsCompleted: 5,
        activeUsers: 2,
        newLearnersOnboarded: 1,
        totalRegisteredLearners: 10,
        avgSessionsPerActiveLearner: 2.5,
        avgPracticeMinutesPerLearner: 12.3,
        avgDaysToFirstSession: 1.5,
        learnersWithFirstSessionCount: 1,
      },
      simulationsCompletedTrend: [{ bucket: '2026-07-01', count: 5 }],
      activeUsersTrend: [{ bucket: '2026-07-01', count: 2 }],
      newLearnersOnboardedTrend: [{ bucket: '2026-07-01', count: 1 }],
      mostUsedSimulations: [
        { scenarioId: 1, title: 'Difficult Conversation', sessionCount: 3 },
      ],
    };

    it('resolves the tenant from the auth context and defaults range to 30d', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(tenantId);
      tenantAnalyticsService.getOrganizationMetrics.mockResolvedValue(response);

      const result = await controller.getOrganizationMetrics({});

      expect(result).toBe(response);
      expect(
        tenantAnalyticsService.getOrganizationMetrics,
      ).toHaveBeenCalledWith(tenantId, '30d');
    });

    it('passes the requested range through', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(tenantId);
      tenantAnalyticsService.getOrganizationMetrics.mockResolvedValue(response);

      await controller.getOrganizationMetrics({ range: '12m' });

      expect(
        tenantAnalyticsService.getOrganizationMetrics,
      ).toHaveBeenCalledWith(tenantId, '12m');
    });

    it('throws Forbidden when there is no tenant in the auth context', async () => {
      jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);

      await expect(controller.getOrganizationMetrics({})).rejects.toThrow(
        ForbiddenException,
      );
      expect(
        tenantAnalyticsService.getOrganizationMetrics,
      ).not.toHaveBeenCalled();
    });
  });
});
