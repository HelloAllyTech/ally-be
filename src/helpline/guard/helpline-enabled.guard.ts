import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import { FAILURE_MESSAGES } from 'src/exception/failure-messages';
import { HelplineTenantService } from '../service/helpline-tenant.service';
import { HelplineTenant } from '../type/helpline.types';
import { helplineDisabled } from '../util/helpline-errors';

/**
 * Invariant 4, "fail closed on the gate": the caller's tenant must have
 * TEXT_HELPLINE_ENABLED, on top of whatever permission the route asks for.
 *
 * Composes with `@AuthPermissions` and must sit ABOVE it: guard decorators
 * apply bottom-up, so the lower decorator's guards run first, and this guard
 * needs the `request.user` that AuthGuard('jwt') sets. Written the other way
 * round, every request answers 401 — loud, and pinned by
 * `helpline-controller-guards.spec.ts`.
 *
 * Reads TenantFeatureService, the raw-DataSource reader the global auth
 * module already exposes; it deliberately does NOT inject any settings-module
 * provider (that is a known boot-breaking DI cycle).
 *
 * On success it also resolves the tenant and leaves it on the request for
 * `@HelplineTenantParam()`, so no handler resolves it twice.
 */
@Injectable()
export class HelplineEnabledGuard implements CanActivate {
  constructor(
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly tenantService: HelplineTenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({
        message: FAILURE_MESSAGES.UNAUTHENTICATED,
        error: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    }
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    if (!enabled) throw helplineDisabled();
    const tenant = await this.tenantService.resolve(user.tenantId);
    if (!tenant) throw helplineDisabled();
    request.helplineTenant = tenant;
    return true;
  }
}

/** Place ABOVE `@AuthPermissions(...)` (see HelplineEnabledGuard). */
export const RequireHelplineEnabled = () =>
  applyDecorators(UseGuards(HelplineEnabledGuard));

/** The tenant HelplineEnabledGuard resolved for this request. */
export const HelplineTenantParam = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): HelplineTenant =>
    ctx.switchToHttp().getRequest().helplineTenant,
);
