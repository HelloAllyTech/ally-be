import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../guards/roles.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserRole } from '../../../common/constants/user.constants';
import { ErrorCode } from '../../../exception/error-code.enum';

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

  it('throws 401, not 403, when the request carries no user', async () => {
    // No identity on the request is an AUTHENTICATION failure. Returning false
    // gave it Nest's synthesised 403, so a client with an expired token was told
    // it lacked permissions and showed the wrong remedy.
    const ctx = makeContext(undefined);
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.COUNSELOR]);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockPermissionsService.getUserRoles).not.toHaveBeenCalled();
  });

  it('the 401 carries the UNAUTHENTICATED error code', async () => {
    const ctx = makeContext(undefined);
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.COUNSELOR]);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { errorCode: ErrorCode.UNAUTHENTICATED },
    });
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

  it('throws a 403 that NAMES the roles it required', async () => {
    // The whole point of the change: `return false` produced a bare "Forbidden
    // resource" and threw away the role list that was sitting in scope.
    const ctx = makeContext({ id: 20 });
    mockReflector.getAllAndOverride.mockReturnValue([
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
    mockPermissionsService.getUserRoles.mockResolvedValue([UserRole.CLIENT]);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockPermissionsService.getUserRoles).toHaveBeenCalledWith(20);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        errorCode: ErrorCode.ROLE_DENIED,
        requiredRoles: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
        message: expect.stringContaining(UserRole.ADMIN),
      },
    });
  });

  it('never leaks WHICH user was denied into the response', async () => {
    // The user id belongs in the log line, not in the body: a permission key is
    // public (the role editor lists them), the mapping from a person to what
    // they lack is not.
    const ctx = makeContext({ id: 77 });
    mockReflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    mockPermissionsService.getUserRoles.mockResolvedValue([UserRole.CLIENT]);

    const error = await guard.canActivate(ctx).then(
      () => {
        throw new Error('expected the guard to deny');
      },
      (rejection: ForbiddenException) => rejection,
    );
    expect(JSON.stringify(error.getResponse())).not.toContain('77');
  });
});
