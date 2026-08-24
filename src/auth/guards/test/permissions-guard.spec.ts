import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../guards/permissions.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { ErrorCode } from '../../../exception/error-code.enum';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
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
      getUserPermissions: jest.fn(),
    } as any;

    guard = new PermissionsGuard(mockReflector, mockPermissionsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true when no permissions are required (public route)', async () => {
    const ctx = makeContext({ id: 1 });
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockPermissionsService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('should return true when the required permission list is empty', async () => {
    const ctx = makeContext({ id: 1 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: [],
      operator: 'AND',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockPermissionsService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('throws 401, not 403, when the request carries no user', async () => {
    // No identity on the request is an AUTHENTICATION failure. Returning false
    // gave it Nest's synthesised 403, so a client with an expired token was told
    // it lacked permissions and shown the wrong remedy.
    const ctx = makeContext(undefined);
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['read:user'],
      operator: 'AND',
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockPermissionsService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('the 401 carries the UNAUTHENTICATED error code', async () => {
    const ctx = makeContext(undefined);
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['read:user'],
      operator: 'AND',
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { errorCode: ErrorCode.UNAUTHENTICATED },
    });
  });

  it('should return true (AND) when the user holds every required permission', async () => {
    const ctx = makeContext({ id: 10 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['read:user', 'write:user'],
      operator: 'AND',
    });
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      'read:user',
      'write:user',
      'read:org',
    ]);

    const result = await guard.canActivate(ctx);

    expect(mockPermissionsService.getUserPermissions).toHaveBeenCalledWith(10);
    expect(result).toBe(true);
  });

  it('should deny (AND) when the user is missing even one required permission', async () => {
    const ctx = makeContext({ id: 11 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['read:user', 'write:user'],
      operator: 'AND',
    });
    mockPermissionsService.getUserPermissions.mockResolvedValue(['read:user']);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should return true (OR) when the user holds at least one required permission', async () => {
    const ctx = makeContext({ id: 12 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['read:user', 'write:user'],
      operator: 'OR',
    });
    mockPermissionsService.getUserPermissions.mockResolvedValue(['write:user']);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('throws a 403 that NAMES the permissions it required', async () => {
    // The whole point of the change: `return false` produced a bare "Forbidden
    // resource" and threw away the permission list that was sitting in scope.
    const ctx = makeContext({ id: 20 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['manage:org', 'manage:billing'],
      operator: 'AND',
    });
    mockPermissionsService.getUserPermissions.mockResolvedValue([]);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        errorCode: ErrorCode.PERMISSION_DENIED,
        requiredPermissions: ['manage:org', 'manage:billing'],
        permissionOperator: 'AND',
        message: expect.stringContaining('manage:org'),
      },
    });
  });

  it('never leaks WHICH user was denied into the response', async () => {
    // The user id belongs in the log line, not in the body: a permission key is
    // public (the role editor lists them), the mapping from a person to what
    // they lack is not.
    const ctx = makeContext({ id: 77 });
    mockReflector.getAllAndOverride.mockReturnValue({
      permissions: ['manage:org'],
      operator: 'AND',
    });
    mockPermissionsService.getUserPermissions.mockResolvedValue([]);

    const error = await guard.canActivate(ctx).then(
      () => {
        throw new Error('expected the guard to deny');
      },
      (rejection: ForbiddenException) => rejection,
    );
    expect(JSON.stringify(error.getResponse())).not.toContain('77');
  });
});
