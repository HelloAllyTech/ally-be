import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  AUTHZ_MESSAGES,
  FAILURE_MESSAGES,
} from 'src/exception/failure-messages';
import { LoggerService } from 'src/logger/logger.service';

/**
 * RolesGuard
 * ----------
 * Enforces the roles named by @Roles.
 *
 * Throws instead of returning false, for the same reason as PermissionsGuard:
 * `return false` yields a bare "Forbidden resource" that discards the required
 * role list sitting in scope, and gives an unauthenticated request the same 403
 * as an under-privileged one.
 *
 * Note this checks ROLE NAMES, resolved through `groups`/`user_groups` — there
 * is no `role` column. Prefer @RequirePermissions on new routes; permissions
 * union across every group a user belongs to, which is what the platform's role
 * model actually means.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = LoggerService.getInstance(RolesGuard.name);

  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Only an ABSENT decorator opens the route. An empty `@Roles()` list keeps
    // denying, exactly as before — a decorator that matches nothing is a
    // mistake, and treating it as "public" would silently widen access on the
    // route someone forgot to finish.
    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    if (!user) {
      // 401, not 403 — see PermissionsGuard for why the distinction matters.
      throw new UnauthorizedException({
        message: FAILURE_MESSAGES.UNAUTHENTICATED,
        error: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    }

    const userRoles = await this.permissionsService.getUserRoles(user.id);
    if (requiredRoles.some((role) => userRoles.includes(role))) return true;

    this.logger.warn(
      `Role denied for user ${user.id} on ${request?.method} ${request?.url}: ` +
        `requires one of [${requiredRoles.join(', ')}]`,
    );
    throw new ForbiddenException({
      message: AUTHZ_MESSAGES.missingRoles(requiredRoles),
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.ROLE_DENIED,
      requiredRoles,
    });
  }
}
