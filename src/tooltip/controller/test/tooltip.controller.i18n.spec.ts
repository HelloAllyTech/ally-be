import { Test, TestingModule } from '@nestjs/testing';

import { TooltipController } from '../tooltip.controller';
import { TooltipService } from '../../service/tooltip.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';

describe('TooltipController i18n', () => {
  let controller: TooltipController;
  let tooltipService: TooltipService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TooltipController],
      providers: [
        {
          provide: TooltipService,
          useValue: {
            getActiveTooltips: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: { checkPermission: jest.fn(), getUserRoles: jest.fn() },
        },
        {
          provide: UserService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: {},
        },
        {
          provide: FeatureToggleService,
          useValue: { hasToggle: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: TenantFeatureService,
          useValue: { isEnabledForTenant: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();

    controller = module.get<TooltipController>(TooltipController);
    tooltipService = module.get<TooltipService>(TooltipService);
  });

  it('should call service with language code', async () => {
    const lang = 'es';
    await controller.getActiveTooltips(lang);
    expect(tooltipService.getActiveTooltips).toHaveBeenCalledWith(lang);
  });
});
