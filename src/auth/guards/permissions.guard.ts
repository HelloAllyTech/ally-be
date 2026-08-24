import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  AUTHZ_MESSAGES,
  FAILURE_MESSAGES,
} from 'src/exception/failure-messages';
import { LoggerService } from 'src/logger/logger.service';

/**
 * PermissionsGuard
 * ----------------
 * Enforces the permissions named by @RequirePermissions.
 *
 * THROWS rather than returning false. `return false` makes Nest synthesise a
 * bare `ForbiddenException('Forbidden resource')`, which throws away the two
 * facts the caller needs and that are sitting right here in scope: WHICH
 * permission was required, and whether the request was even authenticated.
 * Debugging a 403 then means reading source to find out what the route wanted.
 * `FeatureToggleGuard` already gets this right by naming its featureKey; this
 * matches it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = LoggerService.getInstance(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<{
      permissions: string[];
      operator: 'AND' | 'OR';
    }>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    if (!user) {
      // 401, NOT 403. No `user` on the request means no valid identity was
      // presented — the token is missing, malformed or expired. Answering 403
      // told the client "you are signed in but not allowed", so instead of
      // re-authenticating it showed a permissions error to a user whose session
      // had simply lapsed. The two need different remedies and so need
      // different statuses.
      throw new UnauthorizedException({
        message: FAILURE_MESSAGES.UNAUTHENTICATED,
        error: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    }

    const userPermissions = await this.permissionsService.getUserPermissions(
      user.id,
    );

    const { permissions, operator } = requiredPermissions;
    const granted =
      operator === 'AND'
        ? permissions.every((permission) =>
            userPermissions.includes(permission),
          )
        : permissions.some((permission) => userPermissions.includes(permission));

    if (granted) return true;

    // WHICH user failed stays in the log; WHAT was required goes to the client.
    // A permission key is not a secret (the admin role editor lists them all),
    // but the mapping from a user to what they lack is not the client's
    // business.
    const missing = permissions.filter(
      (permission) => !userPermissions.includes(permission),
    );
    this.logger.warn(
      `Permission denied for user ${user.id} on ${request?.method} ` +
        `${request?.url}: required [${permissions.join(', ')}] (${operator}), ` +
        `missing [${missing.join(', ')}]`,
    );
    throw new ForbiddenException({
      message: AUTHZ_MESSAGES.missingPermissions(permissions, operator),
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.PERMISSION_DENIED,
      requiredPermissions: permissions,
      permissionOperator: operator,
    });
  }
}
