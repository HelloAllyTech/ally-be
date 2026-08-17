import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * Who is asking, and what slice of the character library are they allowed to
 * see. Two scopes only:
 *
 * - **platform** (holds SYSTEM_ACCESS): every row — the Ally-owned global
 *   characters plus every tenant's. This is the same discriminator
 *   OwnTenantScopeGuard and SettingsService use, so a tenant-scoped caller is
 *   pinned to their JWT tenant everywhere in the codebase, not just here.
 * - **tenant**: only rows stamped with their own tenant. Never the global ones
 *   and never another org's.
 */
export interface CharacterLibraryScope {
  /** True when the caller sees (and may edit) the whole library. */
  isPlatform: boolean;
  /**
   * The tenant a non-platform caller is pinned to. Null for a platform caller,
   * meaning "do not filter" on read and "create as Ally-owned" on write.
   */
  tenantId: string | null;
}

@Injectable()
export class CharacterLibraryAccessService {
  constructor(private readonly permissionValidator: PermissionValidator) {}

  async resolveScope(): Promise<CharacterLibraryScope> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    const isPlatform = await this.permissionValidator.validatePermissions(
      Number(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    if (isPlatform) {
      return { isPlatform: true, tenantId: null };
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      // A non-platform caller with no tenant on their JWT has no slice to be
      // scoped to. Fail closed rather than falling through to the global pool.
      throw new UnauthorizedException('Tenant context is required');
    }
    return { isPlatform: false, tenantId };
  }
}
