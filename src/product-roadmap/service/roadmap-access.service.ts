import { Injectable } from '@nestjs/common';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

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
  constructor(private readonly permissionsService: PermissionsService) {}

  async canManage(userId: number): Promise<boolean> {
    const permissions =
      await this.permissionsService.getUserPermissions(userId);
    return permissions.includes(PERMISSIONS.EDIT_PRODUCT_ROADMAP);
  }
}
