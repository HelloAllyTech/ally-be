import { Injectable } from '@nestjs/common';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

/**
 * Answers "does this caller hold the roadmap MANAGE permission?" for endpoints that are gated
 * on a lower tier but behave differently for managers.
 *
 * Three places need this, and in all three the rule is genuinely row-level, so it cannot be a
 * decorator:
 *   - deleting a comment (author OR manager; editing is author-only);
 *   - editing/deleting an interview note (author OR manager);
 *   - editing/deleting a saved view (owner OR manager).
 *
 * getUserPermissions is Redis-cached with a 30-minute TTL (see PermissionsService), so this is
 * cheap. It also means a freshly granted permission takes up to 30 minutes to take effect
 * unless the cache is flushed — the same caveat the grant migration documents.
 */
@Injectable()
export class RoadmapAccessService {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly featureToggleService: FeatureToggleService,
  ) {}

  async canManage(userId: number): Promise<boolean> {
    const permissions =
      await this.permissionsService.getUserPermissions(userId);
    return permissions.includes(PERMISSIONS.EDIT_PRODUCT_ROADMAP);
  }

  /**
   * The FULL manage tier: the permission AND the `product_roadmap_manage` toggle — the same
   * pair every `@RequireFeatureToggle(PRODUCT_ROADMAP_MANAGE, { permissions: [...] })` endpoint
   * checks, and the same pair the admin bundle's `canManageRoadmap` mirrors.
   *
   * Separate from `canManage` above rather than a tightening of it, deliberately. That one
   * backs three row-level author-OR-manager rules (comment, interview note, saved view) and a
   * fourth caller (owner assignment on create); silently adding a condition would change all
   * four, and a permission change that broad does not belong in a drive-by.
   *
   * The distinction matters because the permission on its own separates NOBODY. Since the role
   * collapse (CreatePlatformAdminRole1895000000001) PLATFORM_ADMIN carries what
   * SUPER_DUPER_ADMIN used to, so EDIT_PRODUCT_ROADMAP sits on every platform admin and the
   * per-user toggle is the entire distinction between a curator and a read-only admin. Any rule
   * that means "the people who own this board" has to check both — the readiness override being
   * the first.
   *
   * Both halves are cached (permissions for 30 minutes in Redis, see PermissionsService), so
   * this stays cheap enough for a write path.
   */
  async canManageBoard(userId: number): Promise<boolean> {
    const [hasPermission, hasToggle] = await Promise.all([
      this.canManage(userId),
      this.featureToggleService.hasToggle(
        userId,
        FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
      ),
    ]);
    return hasPermission && hasToggle;
  }
}
