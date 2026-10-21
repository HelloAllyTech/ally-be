import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureToggleGuard } from '../feature-toggle.guard';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PreferenceName } from 'src/common/constants/user.constants';
import { FEATURE_TOGGLE_KEY } from '../../decorators/feature-toggle.decorator';
import { ORG_SCOPED_ROUTE_KEY } from '../../decorators/org-scoped-route.decorator';
import { CALLER_SCOPED_ROUTE_KEY } from '../../decorators/caller-scoped-route.decorator';

describe('FeatureToggleGuard', () => {
  let guard: FeatureToggleGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let featureToggleService: {
    hasToggle: jest.Mock;
    isWithheld: jest.Mock;
    isLimitedToOrgScopedRoutes: jest.Mock;
  };
  let tenantScopeService: { assertTenantInScope: jest.Mock };
  let tenantFeatureService: { isEnabledForTenant: jest.Mock };

  const contextFor = (
    user: any,
    query: Record<string, unknown> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user, query }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const platformAdmin = { id: 1, tenantId: undefined };
  const tenantAdmin = { id: 2, tenantId: 'tenant-a' };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    featureToggleService = {
      hasToggle: jest.fn().mockResolvedValue(false),
      isWithheld: jest.fn().mockResolvedValue(false),
      isLimitedToOrgScopedRoutes: jest.fn().mockResolvedValue(false),
    };
    tenantScopeService = {
      assertTenantInScope: jest.fn(async (tenantId: string) => {
        if (tenantId !== 'allowed-tenant') {
          throw new ForbiddenException('out of scope');
        }
      }),
    };
    tenantFeatureService = {
      isEnabledForTenant: jest.fn().mockResolvedValue(false),
    };

    guard = new FeatureToggleGuard(
      reflector as unknown as Reflector,
      featureToggleService as any,
      tenantFeatureService as any,
      tenantScopeService as any,
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
      'Please sign in to continue.',
    );
  });

  describe('platform-only toggles (organization-restricted admins)', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue({
        featureKey: FeatureToggleKey.ANALYTICS_AGENT,
        tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
      });
    });

    it('refuses a restricted admin with a reason, even holding the toggle', async () => {
      featureToggleService.isWithheld.mockResolvedValue(true);
      featureToggleService.hasToggle.mockResolvedValue(true);
      tenantFeatureService.isEnabledForTenant.mockResolvedValue(true);

      await expect(
        guard.canActivate(contextFor(platformAdmin)),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: expect.stringContaining('access to every organization'),
          featureKey: FeatureToggleKey.ANALYTICS_AGENT,
        }),
      });
      // Not even the org-level escape hatch is consulted.
      expect(tenantFeatureService.isEnabledForTenant).not.toHaveBeenCalled();
    });

    it('grants an unrestricted admin holding the toggle', async () => {
      featureToggleService.hasToggle.mockResolvedValue(true);

      await expect(guard.canActivate(contextFor(platformAdmin))).resolves.toBe(
        true,
      );
      expect(featureToggleService.isWithheld).toHaveBeenCalledWith(
        platformAdmin.id,
        FeatureToggleKey.ANALYTICS_AGENT,
      );
    });
  });

  describe('org-scoped routes only (Analytics, organization-restricted admins)', () => {
    /** Route metadata by key, as the reflector would read it. */
    const routeWith = (
      orgScoped?: { queryParam: string },
      callerScoped?: boolean,
    ) =>
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === FEATURE_TOGGLE_KEY) {
          return { featureKey: FeatureToggleKey.ANALYTICS };
        }
        if (key === ORG_SCOPED_ROUTE_KEY) {
          return orgScoped;
        }
        if (key === CALLER_SCOPED_ROUTE_KEY) {
          return callerScoped;
        }
        return undefined;
      });

    beforeEach(() => {
      featureToggleService.hasToggle.mockResolvedValue(true);
      featureToggleService.isLimitedToOrgScopedRoutes.mockResolvedValue(true);
    });

    it('passes a marked route naming an allowlisted organization', async () => {
      routeWith({ queryParam: 'tenantId' });

      await expect(
        guard.canActivate(
          contextFor(platformAdmin, { tenantId: 'allowed-tenant' }),
        ),
      ).resolves.toBe(true);
      expect(tenantScopeService.assertTenantInScope).toHaveBeenCalledWith(
        'allowed-tenant',
        { userId: platformAdmin.id },
      );
    });

    it('refuses a marked route naming another organization', async () => {
      routeWith({ queryParam: 'tenantId' });

      await expect(
        guard.canActivate(contextFor(platformAdmin, { tenantId: 'other' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a marked route naming no organization — it would answer for all of them', async () => {
      routeWith({ queryParam: 'tenantId' });

      await expect(
        guard.canActivate(contextFor(platformAdmin, {})),
      ).rejects.toThrow(BadRequestException);
      await expect(
        guard.canActivate(
          contextFor(platformAdmin, { tenantId: ['allowed-tenant', 'other'] }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('reads the organization from the parameter the route names', async () => {
      routeWith({ queryParam: 'orgId' });

      await expect(
        guard.canActivate(
          contextFor(platformAdmin, {
            tenantId: 'allowed-tenant',
            orgId: 'other',
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses an unmarked route outright, whatever it names', async () => {
      routeWith(undefined);

      await expect(
        guard.canActivate(
          contextFor(platformAdmin, { tenantId: 'allowed-tenant' }),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: expect.stringContaining('access to every organization'),
        }),
      });
      expect(tenantScopeService.assertTenantInScope).not.toHaveBeenCalled();
    });

    it("passes a caller-scoped route with no organization named — it holds only the caller's own rows", async () => {
      routeWith(undefined, true);

      await expect(
        guard.canActivate(contextFor(platformAdmin, {})),
      ).resolves.toBe(true);
      expect(tenantScopeService.assertTenantInScope).not.toHaveBeenCalled();
    });

    it('still refuses an unmarked route when the caller-scoped marker is absent', async () => {
      routeWith(undefined, false);

      await expect(
        guard.canActivate(contextFor(platformAdmin, {})),
      ).rejects.toThrow(ForbiddenException);
    });

    it('leaves an unrestricted admin free on every route', async () => {
      featureToggleService.isLimitedToOrgScopedRoutes.mockResolvedValue(false);
      routeWith(undefined);

      await expect(guard.canActivate(contextFor(platformAdmin))).resolves.toBe(
        true,
      );
    });
  });
});
