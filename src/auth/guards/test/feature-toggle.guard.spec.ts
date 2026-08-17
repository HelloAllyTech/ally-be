import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureToggleGuard } from '../feature-toggle.guard';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PreferenceName, UserRole } from 'src/common/constants/user.constants';

describe('FeatureToggleGuard', () => {
  let guard: FeatureToggleGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let featureToggleService: { hasToggle: jest.Mock };
  let permissionsService: { getUserRoles: jest.Mock };
  let tenantFeatureService: { isEnabledForTenant: jest.Mock };

  const contextFor = (user: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const platformAdmin = { id: 1, tenantId: undefined };
  const tenantAdmin = { id: 2, tenantId: 'tenant-a' };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    featureToggleService = { hasToggle: jest.fn().mockResolvedValue(false) };
    permissionsService = { getUserRoles: jest.fn().mockResolvedValue([]) };
    tenantFeatureService = {
      isEnabledForTenant: jest.fn().mockResolvedValue(false),
    };

    guard = new FeatureToggleGuard(
      reflector as unknown as Reflector,
      featureToggleService as any,
      permissionsService as any,
      tenantFeatureService as any,
    );
  });

  it('passes through when the route carries no @RequireFeatureToggle', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextFor(tenantAdmin))).resolves.toBe(
      true,
    );
    expect(featureToggleService.hasToggle).not.toHaveBeenCalled();
  });

  describe('per-user toggle (platform admins)', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue({
        featureKey: FeatureToggleKey.CHARACTER_LIBRARY,
      });
    });

    it('grants when the user holds the toggle', async () => {
      featureToggleService.hasToggle.mockResolvedValue(true);

      await expect(guard.canActivate(contextFor(platformAdmin))).resolves.toBe(
        true,
      );
    });

    it('denies on a missing toggle row', async () => {
      await expect(
        guard.canActivate(contextFor(platformAdmin)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('grants on a legacy role during the rollout window', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        featureKey: FeatureToggleKey.CHARACTER_LIBRARY,
        legacyRoles: [UserRole.SUPER_DUPER_ADMIN],
      });
      permissionsService.getUserRoles.mockResolvedValue([
        UserRole.SUPER_DUPER_ADMIN,
      ]);

      await expect(guard.canActivate(contextFor(platformAdmin))).resolves.toBe(
        true,
      );
    });
  });

  describe("org preference (a tenant's own admins)", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue({
        featureKey: FeatureToggleKey.CHARACTER_LIBRARY,
        tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
      });
    });

    it("grants when the caller's org has the preference on", async () => {
      tenantFeatureService.isEnabledForTenant.mockResolvedValue(true);

      await expect(guard.canActivate(contextFor(tenantAdmin))).resolves.toBe(
        true,
      );
      expect(tenantFeatureService.isEnabledForTenant).toHaveBeenCalledWith(
        PreferenceName.CHARACTER_LIBRARY_ENABLED,
        'tenant-a',
      );
    });

    it('denies when the org preference is off', async () => {
      await expect(guard.canActivate(contextFor(tenantAdmin))).rejects.toThrow(
        `Missing required feature access: ${FeatureToggleKey.CHARACTER_LIBRARY}`,
      );
    });

    it('never reaches the org branch when the per-user toggle already granted', async () => {
      featureToggleService.hasToggle.mockResolvedValue(true);

      await expect(guard.canActivate(contextFor(platformAdmin))).resolves.toBe(
        true,
      );
      expect(tenantFeatureService.isEnabledForTenant).not.toHaveBeenCalled();
    });

    it('is not consulted on routes that do not opt in', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        featureKey: FeatureToggleKey.AI_LAB,
      });

      await expect(guard.canActivate(contextFor(tenantAdmin))).rejects.toThrow(
        ForbiddenException,
      );
      expect(tenantFeatureService.isEnabledForTenant).not.toHaveBeenCalled();
    });
  });

  it('rejects an unauthenticated request', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      featureKey: FeatureToggleKey.CHARACTER_LIBRARY,
    });

    await expect(guard.canActivate(contextFor(undefined))).rejects.toThrow(
      'Authentication required',
    );
  });
});
