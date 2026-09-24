import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioSessionReviewController } from './review.controller';
import { ScenarioSessionReviewService } from '../service/review.service';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { PermissionsService } from 'src/authorization/service/permissions.service';

describe('ScenarioSessionReviewController', () => {
  let controller: ScenarioSessionReviewController;
  let reflector: Reflector;

  const mockReviewService = {
    getUnreadReviewCount: jest.fn(),
  };

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioSessionReviewController],
      providers: [
        {
          provide: ScenarioSessionReviewService,
          useValue: mockReviewService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        PermissionsGuard,
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 1 };
          return true;
        },
      })
      .compile();

    controller = module.get<ScenarioSessionReviewController>(
      ScenarioSessionReviewController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnreadReviewCount', () => {
    it('should pass if user has singular permission and controller requires singular', async () => {
      mockPermissionsService.getUserPermissions.mockResolvedValue([
        'view:simulation-review',
      ]);
      const guard = new PermissionsGuard(
        reflector,
        mockPermissionsService as any,
      );
      const context = {
        getHandler: () => controller.getUnreadReviewCount,
        getClass: () => ScenarioSessionReviewController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 1 } }),
        }),
      } as any;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
