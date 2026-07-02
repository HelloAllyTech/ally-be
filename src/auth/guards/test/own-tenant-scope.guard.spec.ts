import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnTenantScopeGuard } from '../own-tenant-scope.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('OwnTenantScopeGuard', () => {
  let guard: OwnTenantScopeGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;

  const OWN_TENANT = 'tenant-own';
  const OTHER_TENANT = 'tenant-other';

  const makeContext = (
    { user, params, body }: { user?: any; params?: any; body?: any } = {},
  ): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest
          .fn()
          .mockReturnValue({ user, params: params ?? {}, body: body ?? {} }),
      }),
    }) as any;

  beforeEach(() => {
    mockReflector = { getAllAndOverride: jest.fn() } as any;
    mockPermissionsService = { getUserPermissions: jest.fn() } as any;
    guard = new OwnTenantScopeGuard(mockReflector, mockPermissionsService);

    // Default decorator options: no overrides.
    mockReflector.getAllAndOverride.mockReturnValue({});
    // Default caller tenant (the guard reads it from the JWT execution context).
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(OWN_TENANT);
  });

  afterEach(() => jest.restoreAllMocks());

  it('is defined', () => {
    expect(guard).toBeDefined();
  });

  it('throws when there is no authenticated user', async () => {
    const ctx = makeContext({ user: undefined });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(mockPermissionsService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('allows SYSTEM_ACCESS callers to target ANY tenant (super admin)', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.SYSTEM_ACCESS,
    ]);
    const ctx = makeContext({
      user: { id: 1 },
      params: { tenantId: OTHER_TENANT },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows a tenant admin targeting their OWN tenant (route param)', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_SCENARIO_TENANT,
    ]);
    const ctx = makeContext({
      user: { id: 2 },
      params: { tenantId: OWN_TENANT },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies a tenant admin targeting ANOTHER tenant (route param)', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_SCENARIO_TENANT,
    ]);
    const ctx = makeContext({
      user: { id: 3 },
      params: { tenantId: OTHER_TENANT },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows a tenant admin when body.tenantIds contains only their own tenant (badges)', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_BADGE_TENANT,
    ]);
    const ctx = makeContext({
      user: { id: 4 },
      body: { badgeId: 'b1', tenantIds: [OWN_TENANT] },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies a tenant admin when body.tenantIds includes another tenant (badges)', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_BADGE_TENANT,
    ]);
    const ctx = makeContext({
      user: { id: 5 },
      body: { badgeId: 'b1', tenantIds: [OWN_TENANT, OTHER_TENANT] },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequest when no target tenant is supplied by a tenant admin', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_SCENARIO_TENANT,
    ]);
    const ctx = makeContext({ user: { id: 6 }, params: {}, body: {} });

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });

  it('denies when the caller has no tenant context in the JWT', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(undefined);
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      PERMISSIONS.EDIT_SCENARIO_TENANT,
    ]);
    const ctx = makeContext({
      user: { id: 7 },
      params: { tenantId: OWN_TENANT },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
