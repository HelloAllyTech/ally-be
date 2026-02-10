import { Test, TestingModule } from '@nestjs/testing';
import { TenantAnalyticsController } from '../tenant-analytics.controller';
import { AnalyticsService } from '../../service/analytics.service';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { UserService } from '../../../user/service/user.service';
import { EnableAnalyticsDto } from '../../dto/enable-analytics.dto';

describe('TenantAnalyticsController', () => {
  let controller: TenantAnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;

  beforeEach(async () => {
    const mockAnalyticsService = {
      updateTenantDashboards: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantAnalyticsController],
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
});
