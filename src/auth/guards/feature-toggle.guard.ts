import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
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
 * During the dual-gate rollout window, `legacyRoles` on the decorator is an
 * OR-fallback — a caller holding one of those role names also passes, so an
 * incomplete migration backfill can't lock out someone who was legitimately
 * SDA/SUPER_ADMIN-tier before. This branch is meant to be temporary; the
 * rollout plan calls for removing `legacyRoles` from every call site once the
 * backend migration is confirmed correct in production.
 */
@Injectable()
export class FeatureToggleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureToggleService: FeatureToggleService,
    private readonly permissionsService: PermissionsService,
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
      throw new ForbiddenException('Authentication required');
    }

    if (options.legacyRoles?.length) {
      const roles = await this.permissionsService.getUserRoles(user.id);
      const hasLegacyRole = options.legacyRoles.some((role) =>
        roles.includes(role),
      );
      if (hasLegacyRole) {
        return true;
      }
    }

    const hasToggle = await this.featureToggleService.hasToggle(
      user.id,
      options.featureKey,
    );
    if (!hasToggle) {
      throw new ForbiddenException(
        `Missing required feature access: ${options.featureKey}`,
      );
    }

    return true;
  }
}
