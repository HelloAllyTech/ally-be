import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformWideGuard } from '../platform-wide.guard';
import {
  PLATFORM_WIDE_ONLY_MESSAGE,
  TenantScopeService,
} from '../../../authorization/service/tenant-scope.service';

describe('PlatformWideGuard', () => {
  let tenantScopeService: { isRestricted: jest.Mock };
  let guard: PlatformWideGuard;

  const contextFor = (user?: { id: number | string }): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  beforeEach(() => {
    tenantScopeService = { isRestricted: jest.fn() };
    guard = new PlatformWideGuard(
      tenantScopeService as unknown as TenantScopeService,
    );
  });

  it('lets an unrestricted platform admin through', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(false);

    await expect(guard.canActivate(contextFor({ id: '7' }))).resolves.toBe(
      true,
    );
    expect(tenantScopeService.isRestricted).toHaveBeenCalledWith(7);
  });

  it('refuses a platform admin restricted to an organization allowlist', async () => {
    tenantScopeService.isRestricted.mockResolvedValue(true);

    await expect(guard.canActivate(contextFor({ id: 7 }))).rejects.toThrow(
      new ForbiddenException(PLATFORM_WIDE_ONLY_MESSAGE),
    );
  });

  it('refuses a request with no authenticated user', async () => {
    await expect(guard.canActivate(contextFor())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
