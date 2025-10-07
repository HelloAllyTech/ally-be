import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../guards/roles.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserRole } from '../../../common/constants/user.constants';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;

  const makeContext = (user?: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    }) as any;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    mockPermissionsService = {
      getUserRoles: jest.fn(),
    } as any;

    guard = new RolesGuard(mockReflector, mockPermissionsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true when no roles are required (public route)', async () => {
    const ctx = makeContext({ id: 1 });
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockPermissionsService.getUserRoles).not.toHaveBeenCalled();
  });

  it('should return false when user is missing from request', async () => {
    const ctx = makeContext(undefined);
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.COUNSELOR]);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
    expect(mockPermissionsService.getUserRoles).not.toHaveBeenCalled();
  });

  it('should return true when user has one of the required roles', async () => {
    const ctx = makeContext({ id: 10 });
    mockReflector.getAllAndOverride.mockReturnValue([
      UserRole.COUNSELOR,
      UserRole.ADMIN,
    ]);
    mockPermissionsService.getUserRoles.mockResolvedValue([UserRole.COUNSELOR]);

    const result = await guard.canActivate(ctx);

    expect(mockPermissionsService.getUserRoles).toHaveBeenCalledWith(10);
    expect(result).toBe(true);
  });

  it('should return false when user does not have any of the required roles', async () => {
    const ctx = makeContext({ id: 20 });
    mockReflector.getAllAndOverride.mockReturnValue([
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
    mockPermissionsService.getUserRoles.mockResolvedValue([UserRole.CLIENT]);

    const result = await guard.canActivate(ctx);

    expect(mockPermissionsService.getUserRoles).toHaveBeenCalledWith(20);
    expect(result).toBe(false);
  });
});
