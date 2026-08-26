import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  AUTHZ_MESSAGES,
  FAILURE_MESSAGES,
} from 'src/exception/failure-messages';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import {
  FEATURE_TOGGLE_KEY,
  FeatureToggleOptions,
} from '../decorators/feature-toggle.decorator';

/**
 * FeatureToggleGuard
 * ------------------
 * Enforces the per-admin-user feature toggle named by @RequireFeatureToggle.
 * Runs after PermissionsGuard has already confirmed the caller's coarse
 * permission (PLATFORM_ADMIN's group grant), so this guard only needs to
 * narrow further: does THIS SPECIFIC user hold THIS SPECIFIC toggle.
 *
 * Fails closed: a missing toggle row is treated as disabled, never enabled.
 *
 * The dual-gate rollout window has closed: the `legacyRoles` OR-fallback
 * (any caller holding a pre-collapse SUPER_ADMIN/SUPER_DUPER_ADMIN role also
 * passed, regardless of toggle state) has been removed from every call site.
 * `CreatePlatformAdminRole1895000000001` backfilled every legacy role holder
 * an equivalent toggle before this was safe to retire.
 */
@Injectable()
export class FeatureToggleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureToggleService: FeatureToggleService,
    private readonly tenantFeatureService: TenantFeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<FeatureToggleOptions>(
      FEATURE_TOGGLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      // No @RequireFeatureToggle on this route — nothing for this guard to check.
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      // 401, not the 403 this used to raise. No identity on the request is an
      // authentication failure, and answering 403 sent the client off to show a
      // permissions error for what is really an expired session.
      throw new UnauthorizedException({
        message: FAILURE_MESSAGES.UNAUTHENTICATED,
        error: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    }

    const hasToggle = await this.featureToggleService.hasToggle(
      user.id,
      options.featureKey,
    );
    if (hasToggle) {
      return true;
    }

    // Org-level branch: no per-user toggle row, but the caller's tenant has the
    // feature switched on. This is the only way a non-PLATFORM_ADMIN reaches a
    // toggle-gated surface — admin_feature_toggles has no rows for them.
    // PermissionsGuard already ran, so what they can DO here is still bounded by
    // their role's permissions.
    if (options.tenantPreference) {
      const enabledForTenant =
        await this.tenantFeatureService.isEnabledForTenant(
          options.tenantPreference,
          user.tenantId,
        );
      if (enabledForTenant) {
        return true;
      }
    }

    // Message unchanged (it already named the featureKey, which is why this
    // guard was the in-repo model for the others); what is new is the
    // machine-readable code. FEATURE_NOT_ENABLED is deliberately distinct from
    // PERMISSION_DENIED: the remedy is an admin flipping a toggle, not a
    // permission grant, and a client that can tell them apart can say so.
    throw new ForbiddenException({
      message: AUTHZ_MESSAGES.missingFeature(options.featureKey),
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      featureKey: options.featureKey,
    });
  }
}
