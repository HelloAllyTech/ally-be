import {
  BadRequestException,
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
  PLATFORM_WIDE_ONLY_MESSAGE,
  TenantScopeService,
} from 'src/authorization/service/tenant-scope.service';
import {
  FEATURE_TOGGLE_KEY,
  FeatureToggleOptions,
} from '../decorators/feature-toggle.decorator';
import {
  ORG_SCOPED_ROUTE_KEY,
  OrgScopedRouteOptions,
} from '../decorators/org-scoped-route.decorator';
import { CALLER_SCOPED_ROUTE_KEY } from '../decorators/caller-scoped-route.decorator';

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
    private readonly tenantScopeService: TenantScopeService,
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

    // Ahead of the org-level branch below too: a platform-only surface spans
    // every organization, so no tenant preference can open it to an admin
    // restricted to some.
    if (
      await this.featureToggleService.isWithheld(user.id, options.featureKey)
    ) {
      throw new ForbiddenException({
        message: PLATFORM_WIDE_ONLY_MESSAGE,
        error: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: ErrorCode.FEATURE_NOT_ENABLED,
        featureKey: options.featureKey,
      });
    }

    const hasToggle = await this.featureToggleService.hasToggle(
      user.id,
      options.featureKey,
    );
    if (hasToggle) {
      if (
        await this.featureToggleService.isLimitedToOrgScopedRoutes(
          user.id,
          options.featureKey,
        )
      ) {
        await this.assertOrgScopedRoute(context, request, user.id);
      }
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

  /**
   * An organization-restricted admin on an `orgScopedRoutesOnly` surface: the
   * route must be marked @OrgScopedRoute, and must name one organization on
   * their allowlist. Naming none is refused rather than defaulted — the route
   * would answer for every organization, and Express 5 re-parses the query on
   * each read, so a guard cannot fill the gap in for the handler.
   *
   * A route marked @CallerScopedRoute touches only the caller's own rows, so
   * it has no organization to name and passes as it is.
   */
  private async assertOrgScopedRoute(
    context: ExecutionContext,
    request: { query?: Record<string, unknown> },
    userId: number,
  ): Promise<void> {
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(
        CALLER_SCOPED_ROUTE_KEY,
        [context.getHandler(), context.getClass()],
      )
    ) {
      return;
    }

    const route = this.reflector.getAllAndOverride<
      Required<OrgScopedRouteOptions> | undefined
    >(ORG_SCOPED_ROUTE_KEY, [context.getHandler(), context.getClass()]);
    if (!route) {
      throw new ForbiddenException({
        message: PLATFORM_WIDE_ONLY_MESSAGE,
        error: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: ErrorCode.PERMISSION_DENIED,
      });
    }

    const named = request.query?.[route.queryParam];
    if (typeof named !== 'string' || named.trim() === '') {
      throw new BadRequestException(
        'Choose one of your organizations to see this chart',
      );
    }
    await this.tenantScopeService.assertTenantInScope(named.trim(), {
      userId,
    });
  }
}
